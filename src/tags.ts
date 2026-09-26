import { languageTag } from "./language.js";
import { clamp, hertzToPitch, wordsPerMinuteToRate } from "./voice.js";

/**
 * Microsoft Agent の読み上げの制御タグ (\Pau=500\ など) を読み、読み上げる部分の並びにする。
 *
 * - タグは \ で始まり \ で終わる。大文字小文字は問わない。\\ は \ という文字
 * - \Spd=語/分\ \Pit=Hz\ \Vol=0〜65535\: 速さ・高さ・音量 (次の \Rst\ か、文の終わりまで)
 * - \Pau=ms\: 間を空ける / \Mrk=番号\: 目印 (Bookmark イベント) / \Rst\: 速さなどを元に戻す
 * - \Map="読み"="表示"\: 読み上げる文と、吹き出しに出す文を変える
 * - \Emp\: 次の言葉を強調する (ブラウザでは本物の強調ができないので、少しゆっくり・少し高く読む)
 * - \Chr=Whisper\: ささやき声 (ブラウザではできないので、小さい声で読む)。Normal で戻す。Monotone はブラウザではできないので何もしない
 * - \Ctx=\: 文脈 (記号の読み方)。ブラウザ任せなので、タグだけ取り除く
 * - \Lst\ (直前の発言を繰り返す) は、発言を覚えている Agent の側で扱う
 *
 * SAPI 5 の XML のタグも読む (msagent.js で足したもの)。<rate> <pitch> <volume> <emph> <spell> <lang> <voice> は
 * 中身だけに効き、閉じたら元に戻る (<rate speed="5"/> のように閉じた形なら、囲んでいるタグが閉じるか、文の終わりまで)。
 * - <rate absspeed="-10〜10"> / <rate speed="…">: 速さ (元の速さから / いまの速さから。10 で 3 倍、-10 で 1/3)
 * - <pitch absmiddle="-10〜10"> / <pitch middle="…">: 高さ (10 で 2 倍、-10 で 1/2)
 * - <volume level="0〜100">: 音量
 * - <emph>: 強調 (\Emp\ と同じく、少しゆっくり・少し高く読む) / <spell>: 1 文字ずつ区切って読む
 * - <silence msec="…"/>: 間を空ける / <bookmark mark="…"/>: 目印 (数字でなくてもよい)
 * - <lang langid="411">: 言語 (Windows の言語 ID。16 進) / <voice required="Gender=Female;Language=411">: 声の性別・言語
 * - <sub alias="読み">表示</sub> / <map alias="読み">表示</map>: 読み上げる文と、吹き出しに出す文を変える (\Map\ と同じ。<sub> は SSML のタグ)
 * - <!-- コメント -->: 取り除く (読まず、吹き出しにも出さない)
 * - <pron> <context> <partofsp> <sapi> <p> <s>: ブラウザ任せなので、タグだけ取り除く (中の文は読む)
 * - 知らないタグは文字のまま。SAPI 5 のタグがある文だけ、&lt; などの文字参照を文字に戻す
 */

/** A run of text to speak with the same settings. */
export interface SpeechText {
  kind: "text";
  /** Text to read aloud. */
  spoken: string;
  /** Text to show in the balloon (differs from `spoken` with `\Map\` / `<sub>`). */
  shown: string;
  /** Speaking rate (browser value, normal = 1). */
  rate: number;
  /** Pitch (browser value, normal = 1). */
  pitch: number;
  /** Volume, 0–1. */
  volume: number;
  /** Language from SAPI 5 `<lang>` / `<voice>`. If missing, the language of the whole speech is used. */
  lang?: string;
  /** Voice gender from SAPI 5 `<voice>`. If missing, the character's voice gender is used. */
  gender?: "neutral" | "female" | "male";
}

/** A bookmark in speech text (`\Mrk=number\` or SAPI 5 `<bookmark mark="..."/>`). */
export interface Bookmark {
  /** The bookmark number (`NaN` for a non-numeric SAPI 5 mark). */
  id: number;
  /** The mark as written. */
  mark: string;
}

/** A part of parsed speech text: text to speak, a pause in milliseconds, or a bookmark. */
export type SpeechPart = SpeechText | { kind: "pause"; ms: number } | ({ kind: "bookmark" } & Bookmark);

/** \Emp\ で強調した言葉の、速さと高さの倍率 */
const EMPHASIS_RATE = 0.8;
const EMPHASIS_PITCH = 1.2;
/** \Chr=Whisper\ の音量の倍率 */
const WHISPER_VOLUME = 0.35;
/** \Emp\ で強調する言葉の終わり (空白と句読点。タグの始まりの \ は除く) */
const WORD_END = /[\s\p{P}]/u;

/** タグの名前 (大文字小文字は問わない) */
const KNOWN_TAGS = new Set(["chr", "ctx", "emp", "lst", "map", "mrk", "pau", "pit", "rst", "spd", "vol"]);

/** SAPI 5 のタグの名前 (大文字小文字は問わない) */
const SAPI_TAGS = new Set([
  "bookmark",
  "context",
  "emph",
  "lang",
  "p",
  "partofsp",
  "pitch",
  "pron",
  "rate",
  "s",
  "sapi",
  "map",
  "silence",
  "spell",
  "sub",
  "voice",
  "volume",
]);
const SAPI_TAG = /<(\/?)([a-z]+)((?:\s+[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/iy;
const SAPI_ATTRIBUTE = /([a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const ENTITY = /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/iy;
const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

interface SapiTag {
  name: string;
  closing: boolean;
  /** <silence/> のように、その場で閉じている */
  empty: boolean;
  attributes: Record<string, string>;
  length: number;
}

/** at から SAPI 5 のタグが始まっていれば読む */
function readSapiTag(text: string, at: number): SapiTag | undefined {
  SAPI_TAG.lastIndex = at;
  const m = SAPI_TAG.exec(text);
  const name = m?.[2]!.toLowerCase();
  if (!m || !name || !SAPI_TAGS.has(name)) return undefined;
  const attributes: Record<string, string> = {};
  for (const a of m[3]!.matchAll(SAPI_ATTRIBUTE)) attributes[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? "";
  return { name, closing: m[1] === "/", empty: m[4] === "/", attributes, length: m[0].length };
}

/** SAPI 5 のタグかコメント (<!-- … -->) を含む文か */
function hasSapiTags(text: string): boolean {
  if (/<!--[\s\S]*?-->/.test(text)) return true;
  for (let i = text.indexOf("<"); i >= 0; i = text.indexOf("<", i + 1)) if (readSapiTag(text, i)) return true;
  return false;
}

/** at から文字参照 (&lt; &#60; など) が始まっていれば、その文字と長さ */
function readEntity(text: string, at: number): [string, number] | undefined {
  ENTITY.lastIndex = at;
  const m = ENTITY.exec(text);
  if (!m) return undefined;
  const name = m[1]!.toLowerCase();
  const code = name.startsWith("#x")
    ? parseInt(name.slice(2), 16)
    : name.startsWith("#")
      ? Number(name.slice(1))
      : undefined;
  if (code !== undefined && !(code >= 0 && code <= 0x10ffff)) return undefined;
  return [code === undefined ? ENTITIES[name]! : String.fromCodePoint(code), m[0].length];
}

/** -10〜10 の数 (無い・数でなければ undefined) */
function sapiLevel(value: string | undefined): number | undefined {
  const n = value === undefined || value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) ? clamp(n, -10, 10) : undefined;
}

/** 16 進の言語 ID ("411") を言語の名前 ("ja-JP") にする */
function sapiLanguage(value: string | undefined): string | undefined {
  const id = parseInt(value ?? "", 16);
  return Number.isFinite(id) && id > 0 ? languageTag(id) : undefined;
}

/** <voice required="Gender=Female;Language=411"> の Gender と Language (required を優先し、無ければ optional) */
function sapiVoice(attributes: Record<string, string>): { gender?: SpeechText["gender"]; lang?: string } {
  const out: { gender?: SpeechText["gender"]; lang?: string } = {};
  for (const list of [attributes.optional, attributes.required]) {
    for (const item of (list ?? "").split(";")) {
      const [key, value] = item.split("=").map((s) => s.trim().toLowerCase());
      if (key === "gender" && (value === "female" || value === "male" || value === "neutral")) out.gender = value;
      const lang = key === "language" ? sapiLanguage(value) : undefined;
      if (lang) out.lang = lang;
    }
  }
  return out;
}

/** 読み上げの設定 (タグで変わる) */
interface Settings {
  rate: number;
  pitch: number;
  volume: number;
  /** <emph> の中 */
  emph?: boolean;
  /** <spell> の中 */
  spell?: boolean;
  /** <sub alias="…"> の中なら、中身の代わりに読む文 (読んだら "") */
  sub?: string;
  lang?: string;
  gender?: SpeechText["gender"];
}

/** <spell> の中身: 1 文字ずつ区切って読む */
const spellOut = (text: string) => [...text].filter((c) => /\S/.test(c)).join(" ");

/**
 * Parses speech output tags in text into parts to speak, pauses and bookmarks.
 *
 * Microsoft Agent tags start and end with `\` and are case-insensitive (`\\` is a literal backslash):
 *
 * - `\Spd=words per minute\`, `\Pit=Hz\`, `\Vol=0–65535\`: speed, pitch, volume (until `\Rst\` or the end)
 * - `\Pau=ms\`: pause; `\Mrk=number\`: bookmark (fires the `bookmark` event); `\Rst\`: reset to defaults
 * - `\Map="spoken"="shown"\`: speak one text and show another in the balloon
 * - `\Emp\`: emphasize the next word (approximated by speaking a little slower and higher)
 * - `\Chr=Whisper\`: whisper (approximated by a lower volume); `\Chr=Normal\` to go back.
 *   `Monotone` is not supported by browsers and is ignored
 * - `\Ctx=...\`: context; left to the browser, so the tag is removed
 * - `\Lst\` (repeat the last speech) is handled by `agent.speak()`
 *
 * SAPI 5 XML tags are supported too (msagent.js extension). `<rate>` `<pitch>` `<volume>` `<emph>` `<spell>`
 * `<lang>` `<voice>` apply to their content; the self-closing form (`<rate speed="5"/>`) applies until the
 * enclosing tag closes or the text ends.
 *
 * - `<rate absspeed="-10..10">` / `<rate speed="...">`: speed, absolute or relative (10 = 3×, -10 = 1/3)
 * - `<pitch absmiddle="-10..10">` / `<pitch middle="...">`: pitch (10 = 2×, -10 = 1/2)
 * - `<volume level="0..100">`: volume
 * - `<emph>`: emphasis (like `\Emp\`); `<spell>`: read letter by letter
 * - `<silence msec="..."/>`: pause; `<bookmark mark="..."/>`: bookmark (need not be a number)
 * - `<lang langid="411">`: language (hexadecimal Windows language ID);
 *   `<voice required="Gender=Female;Language=411">`: voice gender and language
 * - `<sub alias="spoken">shown</sub>` / `<map alias="spoken">shown</map>`: like `\Map\`
 * - `<!-- comment -->`: removed
 * - `<pron>` `<context>` `<partofsp>` `<sapi>` `<p>` `<s>`: left to the browser; the tags are removed but
 *   their text is spoken
 *
 * Unknown tags are kept as text. Character references such as `&lt;` are decoded only in text with SAPI 5 tags.
 *
 * ```js
 * parseSpeechTags("Hello\\Pau=500\\world");
 * // → [{ kind: "text", spoken: "Hello", ... }, { kind: "pause", ms: 500 }, { kind: "text", spoken: "world", ... }]
 * ```
 *
 * @param base - Rate and pitch when no tag changes them (from the character's voice settings).
 * @param onlyBookmarks - Use only `\Mrk\` and remove the other tags (as `think()` does).
 */
export function parseSpeechTags(
  text: string,
  base: { rate: number; pitch: number } = { rate: 1, pitch: 1 },
  onlyBookmarks = false,
): SpeechPart[] {
  const parts: SpeechPart[] = [];
  /** 速さ・高さ・音量と、SAPI 5 のタグで変えたもの (<emph> <spell> の中か、言語・性別) */
  let settings: Settings = { rate: base.rate, pitch: base.pitch, volume: 1 };
  /** 開いている SAPI 5 のタグと、開く前の settings (閉じたら戻す) */
  const opened: { name: string; saved: Settings }[] = [];
  const xml = hasSapiTags(text);
  /** \Emp\ の後、次の言葉を読み終えるまで */
  let emphasize = false;
  /** \Chr=Whisper\ */
  let whisper = false;
  /** いまの速さ・高さ・音量 (強調・ささやきを含む) と、言語・性別 */
  const tone = () => {
    const emph = emphasize || settings.emph;
    return {
      rate: emph ? settings.rate * EMPHASIS_RATE : settings.rate,
      pitch: emph ? clamp(settings.pitch * EMPHASIS_PITCH, 0, 2) : settings.pitch,
      volume: whisper ? settings.volume * WHISPER_VOLUME : settings.volume,
      ...(settings.lang ? { lang: settings.lang } : {}),
      ...(settings.gender ? { gender: settings.gender } : {}),
    };
  };
  let buffer = "";
  const flush = () => {
    const sub = settings.sub;
    if (!buffer && !sub) return;
    // <sub> の中は、中身の代わりに alias を 1 回だけ読む (中身は吹き出しに出す)
    const spoken = sub !== undefined ? sub : settings.spell ? spellOut(buffer) : buffer;
    parts.push({ kind: "text", spoken, shown: buffer, ...tone() });
    if (sub) settings = { ...settings, sub: "" };
    buffer = "";
  };

  /** SAPI 5 のタグ 1 つ */
  const applySapi = (tag: SapiTag) => {
    const a = tag.attributes;
    if (tag.closing) {
      const at = opened.map((o) => o.name).lastIndexOf(tag.name);
      if (at < 0) return;
      flush();
      settings = opened[at]!.saved;
      opened.length = at;
      return;
    }
    // 中身だけに効くもの: 開く前を覚えておき、閉じたら戻す (閉じた形 <rate …/> なら覚えない)
    const change = (next: Partial<Settings>) => {
      flush();
      if (!tag.empty) opened.push({ name: tag.name, saved: settings });
      settings = { ...settings, ...next };
    };
    switch (tag.name) {
      case "silence": {
        const ms = Number(a.msec);
        if (ms > 0) {
          flush();
          parts.push({ kind: "pause", ms });
        }
        break;
      }
      case "bookmark": {
        const mark = (a.mark ?? "").trim();
        if (!mark) break;
        flush();
        parts.push({ kind: "bookmark", id: /^-?\d+$/.test(mark) ? Number(mark) : NaN, mark });
        break;
      }
      case "rate": {
        const abs = sapiLevel(a.absspeed);
        const level = abs ?? sapiLevel(a.speed);
        const from = abs !== undefined ? base.rate : settings.rate;
        change(level === undefined ? {} : { rate: clamp(from * 3 ** (level / 10), 0.1, 10) });
        break;
      }
      case "pitch": {
        const abs = sapiLevel(a.absmiddle);
        const level = abs ?? sapiLevel(a.middle);
        const from = abs !== undefined ? base.pitch : settings.pitch;
        change(level === undefined ? {} : { pitch: clamp(from * 2 ** (level / 10), 0, 2) });
        break;
      }
      case "volume": {
        const level = a.level === undefined || a.level.trim() === "" ? NaN : Number(a.level);
        change(Number.isFinite(level) ? { volume: clamp(level / 100, 0, 1) } : {});
        break;
      }
      case "emph":
        if (!tag.empty) change({ emph: true });
        break;
      case "spell":
        if (!tag.empty) change({ spell: true });
        break;
      case "lang": {
        const lang = sapiLanguage(a.langid);
        change(lang ? { lang } : {});
        break;
      }
      case "voice":
        change(sapiVoice(a));
        break;
      case "sub":
      case "map":
        if (!tag.empty) change(a.alias === undefined ? {} : { sub: a.alias });
        break;
      // <pron> <context> <partofsp> <sapi> <p> <s> はブラウザ任せ (タグだけ取り除き、文は区切らない)
      default:
        break;
    }
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (xml && c === "<") {
      // <!-- コメント --> は取り除く (閉じていなければ文字のまま)
      const commentEnd = text.startsWith("<!--", i) ? text.indexOf("-->", i + 4) : -1;
      if (commentEnd >= 0) {
        i = commentEnd + 3;
        continue;
      }
      const tag = readSapiTag(text, i);
      if (tag) {
        i += tag.length;
        if (!onlyBookmarks || tag.name === "bookmark") applySapi(tag);
        continue;
      }
    }
    if (xml && c === "&") {
      const entity = readEntity(text, i);
      if (entity) {
        buffer += entity[0];
        i += entity[1];
        continue;
      }
    }
    if (c !== "\\") {
      buffer += c;
      i++;
      // 強調している言葉が終わったら、そこで区切る
      const next = text[i];
      if (emphasize && /\S/.test(buffer) && (next === undefined || (next !== "\\" && WORD_END.test(next)))) {
        flush();
        emphasize = false;
      }
      continue;
    }
    // \\ は \ という文字
    if (text[i + 1] === "\\") {
      buffer += "\\";
      i += 2;
      continue;
    }
    const end = text.indexOf("\\", i + 1);
    const body = end < 0 ? "" : text.slice(i + 1, end);
    const eq = body.indexOf("=");
    const name = (eq < 0 ? body : body.slice(0, eq)).toLowerCase();
    const value = eq < 0 ? "" : body.slice(eq + 1);
    // タグでなければ、そのまま文字として扱う
    if (end < 0 || !KNOWN_TAGS.has(name)) {
      buffer += c;
      i++;
      continue;
    }
    i = end + 1;
    if (onlyBookmarks && name !== "mrk") continue;

    switch (name) {
      case "mrk": {
        const id = Number(value);
        if (Number.isFinite(id)) {
          flush();
          parts.push({ kind: "bookmark", id, mark: value.trim() });
        }
        break;
      }
      case "pau": {
        const ms = Number(value);
        if (ms > 0) {
          flush();
          parts.push({ kind: "pause", ms });
        }
        break;
      }
      case "spd":
      case "pit":
      case "vol": {
        const n = Number(value);
        if (!Number.isFinite(n)) break;
        flush();
        if (name === "spd" && n > 0) settings = { ...settings, rate: clamp(wordsPerMinuteToRate(n), 0.1, 10) };
        if (name === "pit" && n > 0) settings = { ...settings, pitch: clamp(hertzToPitch(n), 0, 2) };
        if (name === "vol") settings = { ...settings, volume: clamp(n / 65535, 0, 1) };
        break;
      }
      case "rst":
        flush();
        settings = { ...settings, rate: base.rate, pitch: base.pitch, volume: 1 };
        emphasize = whisper = false;
        break;
      case "emp":
        flush();
        emphasize = true;
        break;
      case "chr":
        flush();
        whisper = value.trim().replace(/^"|"$/g, "").toLowerCase() === "whisper";
        break;
      case "map": {
        const m = /^"([^"]*)"="([^"]*)"$/.exec(value);
        if (!m) break;
        flush();
        parts.push({ kind: "text", spoken: m[1]!, shown: m[2]!, ...tone() });
        break;
      }
      // \Ctx=…\ はブラウザ任せ。\Lst\ は Agent の側で扱う
      default:
        break;
    }
  }
  flush();
  return parts;
}

/** タグを使わないとき: 文をそのまま読み、そのまま吹き出しに出す (agent.tags = false) */
export function plainSpeech(text: string, base: { rate: number; pitch: number } = { rate: 1, pitch: 1 }): SpeechPart[] {
  return text ? [{ kind: "text", spoken: text, shown: text, rate: base.rate, pitch: base.pitch, volume: 1 }] : [];
}

/** The text shown in the balloon for parsed speech (the text without tags). */
export function shownText(parts: readonly SpeechPart[]): string {
  return parts.map((p) => (p.kind === "text" ? p.shown : "")).join("");
}

/**
 * 目印 (\Mrk\) を、吹き出しに文字を出していくのに合わせて知らせるための関数を作る。
 * 返した関数に、出した文字数を渡すと、そこまでに通り過ぎた目印を fire に渡す (Infinity なら残り全部)
 */
export function bookmarkNotifier(
  parts: readonly SpeechPart[],
  fire: (bookmark: Bookmark) => void,
): (shownCount: number) => void {
  const bookmarks: { at: number; bookmark: Bookmark }[] = [];
  let offset = 0;
  for (const p of parts) {
    if (p.kind === "text") offset += [...p.shown].length;
    else if (p.kind === "bookmark") bookmarks.push({ at: offset, bookmark: { id: p.id, mark: p.mark } });
  }
  return (shownCount) => {
    while (bookmarks.length > 0 && bookmarks[0]!.at <= shownCount) fire(bookmarks.shift()!.bookmark);
  };
}

/** \Lst\ (直前の発言を繰り返す) だけの文か */
export const isRepeatTag = (text: string) => /^\s*\\lst\\\s*$/i.test(text);

/** \Mrk\ と <bookmark/> を取り除く (\Lst\ で繰り返すときは、目印は繰り返さない。本家と同じ) */
export const removeBookmarks = (text: string) =>
  text.replace(/\\mrk=[^\\]*\\/gi, "").replace(/<bookmark\b[^>]*>/gi, "");
