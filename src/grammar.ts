/**
 * 声のコマンドの文法 (本家の Command.Voice の書き方) を読み、聞き取った文と照らし合わせる。
 *
 * ブラウザの音声認識 (Web Speech API) は、決まった言葉だけを聞くことができず、自由な文を返す。
 * そこで、聞き取った文が文法に合うかを、ここで確かめる。
 *
 * | 書き方 | 意味 |
 * | --- | --- |
 * | `[ ]` | 省いてよい言葉 (`hello [there]`) |
 * | `( \| )` | どれか 1 つ (`(hello \| hi)`) |
 * | `*` / `+` | 直前の言葉・まとまりの 0 回以上 / 1 回以上の繰り返し (`(New York)+`) |
 * | `...` | 何を言ってもよいところ (`[...] check mail [...]`) |
 * | `表示\読み` | 表示と読み。どちらで聞き取っても合う (`1st\first`、日本語の `かな\漢字`)。`#` で始まる読み (IPA) は使わない |
 *
 * 照らし合わせるときは、大文字小文字・全角半角・カタカナとひらがな・記号・空白の違いを気にしない
 */

type GrammarNode =
  | { kind: "seq"; items: GrammarNode[] }
  | { kind: "alt"; options: GrammarNode[] }
  | { kind: "opt"; node: GrammarNode }
  | { kind: "rep"; node: GrammarNode; min: 0 | 1 }
  | { kind: "word"; forms: string[] }
  | { kind: "any" };

/** Thrown by {@link compileVoiceGrammar} for a malformed grammar, such as unbalanced brackets. */
export class GrammarError extends Error {
  constructor(
    message: string,
    /** The grammar that failed to compile. */
    readonly grammar: string,
  ) {
    super(`${message}: ${grammar}`);
    this.name = "GrammarError";
  }
}

/** カタカナをひらがなにする */
const toHiragana = (s: string) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * Normalizes text for matching voice commands: applies NFKC (unifying full-width and half-width forms), lowercases,
 * turns katakana into hiragana, removes punctuation and collapses whitespace.
 *
 * ```js
 * normalizeSpeech("Hello, World!"); // → "hello world"
 * ```
 */
export function normalizeSpeech(text: string): string {
  return toHiragana(text.normalize("NFKC").toLowerCase())
    .replace(/[\u200b']/g, "") // ゼロ幅スペースとアポストロフィ
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(grammar: string): string[] {
  const tokens: string[] = [];
  const re = /\.\.\.|[()[\]|*+]|[^\s()[\]|*+]+/g;
  for (const m of grammar.replace(/\u200b/g, " ").matchAll(re)) {
    // 言葉の途中の ... (例: "wait...") は、言葉と ... に分ける
    const t = m[0];
    const dots = t.indexOf("...");
    if (dots > 0) tokens.push(t.slice(0, dots), ...(t.length > dots + 3 ? ["...", t.slice(dots + 3)] : ["..."]));
    else tokens.push(t);
  }
  return tokens;
}

/** 文法を読む。書き方が誤っていれば GrammarError */
function parse(grammar: string): GrammarNode {
  const tokens = tokenize(grammar);
  let i = 0;
  const alt = (): GrammarNode => {
    const options = [seq()];
    while (tokens[i] === "|") {
      i++;
      options.push(seq());
    }
    return options.length === 1 ? options[0]! : { kind: "alt", options };
  };
  const seq = (): GrammarNode => {
    const items: GrammarNode[] = [];
    while (i < tokens.length && ![")", "]", "|"].includes(tokens[i]!)) {
      let node = primary();
      while (tokens[i] === "*" || tokens[i] === "+") node = { kind: "rep", node, min: tokens[i++] === "+" ? 1 : 0 };
      items.push(node);
    }
    return { kind: "seq", items };
  };
  const primary = (): GrammarNode => {
    const t = tokens[i++]!;
    if (t === "(" || t === "[") {
      const node = alt();
      const close = t === "(" ? ")" : "]";
      if (tokens[i++] !== close) throw new GrammarError(`Missing ${close}`, grammar);
      return t === "[" ? { kind: "opt", node } : node;
    }
    if (t === "*" || t === "+") throw new GrammarError(`Nothing to repeat before ${t}`, grammar);
    if (t === "...") return { kind: "any" };
    // 表示\読み (# で始まる読みは IPA なので使わない)
    const forms = t
      .split("\\")
      .filter((f, k) => f && !(k > 0 && f.startsWith("#")))
      .map(normalizeSpeech)
      .filter(Boolean);
    return { kind: "word", forms };
  };
  const node = alt();
  if (i < tokens.length) throw new GrammarError(`Unmatched ${tokens[i]}`, grammar);
  return node;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 空白で区切って書く文字 (英字・数字)。この文字どうしの間では、言葉の途中で切らない */
const LATIN = "[\\p{Script=Latin}\\p{N}]";

function toRegex(node: GrammarNode): string {
  switch (node.kind) {
    case "seq":
      return node.items.map(toRegex).filter(Boolean).join("\\s*");
    case "alt":
      return `(?:${node.options.map(toRegex).join("|")})`;
    case "opt":
      return `(?:${toRegex(node.node)})?`;
    case "rep": {
      const one = toRegex(node.node);
      return `(?:${one}(?:\\s*${one})*)${node.min === 0 ? "?" : ""}`;
    }
    case "any":
      return ".*?";
    case "word": {
      if (node.forms.length === 0) return "";
      const forms = node.forms.map((f) => {
        const body = f.split(" ").map(escape).join("\\s*");
        const before = new RegExp(`^${LATIN}`, "u").test(f) ? `(?<!${LATIN})` : "";
        const after = new RegExp(`${LATIN}$`, "u").test(f) ? `(?!${LATIN})` : "";
        return `${before}${body}${after}`;
      });
      return `(?:${forms.join("|")})`;
    }
  }
}

/**
 * Compiles a voice command grammar (the syntax of Microsoft Agent's `Command.Voice`) into a function that tests
 * whether recognized text matches it. The browser's speech recognition returns free text rather than listening for
 * fixed phrases, so matching is done here.
 *
 * | Syntax | Meaning |
 * | --- | --- |
 * | `[ ]` | optional words (`hello [there]`) |
 * | `( \| )` | one of the alternatives (`(hello \| hi)`) |
 * | `*` / `+` | zero or more / one or more repetitions of the previous word or group (`(New York)+`) |
 * | `...` | any words (`[...] check mail [...]`) |
 * | `display\spoken` | display and spoken forms; either one matches (`1st\first`). Pronunciations starting with `#` (IPA) are ignored |
 *
 * Case, full-width / half-width forms, katakana / hiragana, punctuation and whitespace are ignored when matching
 * (see {@link normalizeSpeech}).
 *
 * ```js
 * const match = compileVoiceGrammar("[please] (search | find) [...]");
 * match("Please find my file"); // → true
 * ```
 *
 * @throws {@link GrammarError} if the grammar is malformed.
 */
export function compileVoiceGrammar(grammar: string): (heard: string) => boolean {
  const re = new RegExp(`^\\s*${toRegex(parse(grammar))}\\s*$`, "su");
  return (heard) => re.test(normalizeSpeech(heard));
}
