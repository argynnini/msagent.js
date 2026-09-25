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

/** 文法の書き方の誤り (括弧の対応など。本家もこれだけはエラーにする) */
export class GrammarError extends Error {
  constructor(
    message: string,
    readonly grammar: string,
  ) {
    super(`${message}: ${grammar}`);
    this.name = "GrammarError";
  }
}

/** カタカナをひらがなにする */
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * 照らし合わせるための形にする: 全角半角をそろえ (NFKC)、小文字・ひらがなにし、記号を除いて、空白を 1 つにする
 */
export function normalizeSpeech(text: string): string {
  return toHiragana(text.normalize("NFKC").toLowerCase())
    .replace(/[​']/g, "")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(grammar: string): string[] {
  const tokens: string[] = [];
  const re = /\.\.\.|[()[\]|*+]|[^\s()[\]|*+]+/g;
  for (const m of grammar.replace(/​/g, " ").matchAll(re)) {
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
      if (tokens[i++] !== close) throw new GrammarError(`${close} がありません`, grammar);
      return t === "[" ? { kind: "opt", node } : node;
    }
    if (t === "*" || t === "+") throw new GrammarError(`${t} の前に言葉がありません`, grammar);
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
  if (i < tokens.length) throw new GrammarError(`${tokens[i]} の対応する括弧がありません`, grammar);
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
 * 声のコマンドの文法を、照らし合わせる関数にする。書き方が誤っていれば GrammarError。
 *
 * ```js
 * const match = compileVoiceGrammar("[please] (search | find) [...]");
 * match("Please find my file"); // → true
 * ```
 */
export function compileVoiceGrammar(grammar: string): (heard: string) => boolean {
  const re = new RegExp(`^\\s*${toRegex(parse(grammar))}\\s*$`, "su");
  return (heard) => re.test(normalizeSpeech(heard));
}
