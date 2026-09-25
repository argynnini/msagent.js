/**
 * Microsoft Agent の読み上げの制御タグ (\Pau=500\ など) を読み、読み上げる部分の並びにする。
 *
 * - タグは \ で始まり \ で終わる。大文字小文字は問わない。\\ は \ という文字
 * - \Spd=語/分\ \Pit=Hz\ \Vol=0〜65535\: 速さ・高さ・音量 (次の \Rst\ か、文の終わりまで)
 * - \Pau=ms\: 間を空ける / \Mrk=番号\: 目印 (Bookmark イベント) / \Rst\: 速さなどを元に戻す
 * - \Map="読み"="表示"\: 読み上げる文と、吹き出しに出す文を変える
 * - \Emp\ \Chr=\ \Ctx=\: 強調・声色・文脈。ブラウザの読み上げではできないので、タグだけ取り除く
 * - \Lst\ (直前の発言を繰り返す) は、発言を覚えている Agent の側で扱う
 */

/** 読み上げる部分 (spoken を読み、吹き出しには shown を出す) */
export interface SpeechText {
  kind: "text";
  spoken: string;
  shown: string;
  /** ブラウザの読み上げの速さ・高さ (標準 = 1) と音量 (0〜1) */
  rate: number;
  pitch: number;
  volume: number;
}

export type SpeechPart =
  | SpeechText
  | { kind: "pause"; ms: number }
  | { kind: "bookmark"; id: number };

/** 速さ・高さを、ブラウザの値に直すときの基準 (speak.ts の voiceParams と同じ) */
const BASE_WORDS_PER_MINUTE = 170;
const BASE_PITCH_HZ = 100;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** タグの名前 (大文字小文字は問わない) */
const KNOWN_TAGS = new Set(["chr", "ctx", "emp", "lst", "map", "mrk", "pau", "pit", "rst", "spd", "vol"]);

/**
 * 文をタグで区切り、読み上げる部分・間・目印の並びにする。
 * base は、タグで変えていないときの速さ・高さ (キャラクターの声の設定から)。
 * onlyBookmarks なら \Mrk\ だけを使い、ほかのタグは取り除く (think() と同じ)
 */
export function parseSpeechTags(
  text: string,
  base: { rate: number; pitch: number } = { rate: 1, pitch: 1 },
  onlyBookmarks = false,
): SpeechPart[] {
  const parts: SpeechPart[] = [];
  let settings = { rate: base.rate, pitch: base.pitch, volume: 1 };
  let buffer = "";
  const flush = () => {
    if (buffer) parts.push({ kind: "text", spoken: buffer, shown: buffer, ...settings });
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c !== "\\") {
      buffer += c;
      i++;
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
          parts.push({ kind: "bookmark", id });
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
        if (name === "spd" && n > 0) settings = { ...settings, rate: clamp(n / BASE_WORDS_PER_MINUTE, 0.1, 10) };
        if (name === "pit" && n > 0) settings = { ...settings, pitch: clamp(n / BASE_PITCH_HZ, 0, 2) };
        if (name === "vol") settings = { ...settings, volume: clamp(n / 65535, 0, 1) };
        break;
      }
      case "rst":
        flush();
        settings = { rate: base.rate, pitch: base.pitch, volume: 1 };
        break;
      case "map": {
        const m = /^"([^"]*)"="([^"]*)"$/.exec(value);
        if (!m) break;
        flush();
        parts.push({ kind: "text", spoken: m[1]!, shown: m[2]!, ...settings });
        break;
      }
      // \Emp\ \Chr=…\ \Ctx=…\ はブラウザの読み上げではできない。\Lst\ は Agent の側で扱う
      default:
        break;
    }
  }
  flush();
  return parts;
}

/** 吹き出しに出す文 (タグを除いたもの) */
export function shownText(parts: readonly SpeechPart[]): string {
  return parts.map((p) => (p.kind === "text" ? p.shown : "")).join("");
}

/** \Lst\ (直前の発言を繰り返す) だけの文か */
export const isRepeatTag = (text: string) => /^\s*\\lst\\\s*$/i.test(text);

/** \Mrk\ を取り除く (\Lst\ で繰り返すときは、目印は繰り返さない。本家と同じ) */
export const removeBookmarks = (text: string) => text.replace(/\\mrk=[^\\]*\\/gi, "");
