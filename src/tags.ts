import { clamp, hertzToPitch, wordsPerMinuteToRate } from "./voice";

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


/** \Emp\ で強調した言葉の、速さと高さの倍率 */
const EMPHASIS_RATE = 0.8;
const EMPHASIS_PITCH = 1.2;
/** \Chr=Whisper\ の音量の倍率 */
const WHISPER_VOLUME = 0.35;
/** \Emp\ で強調する言葉の終わり (空白と句読点。タグの始まりの \ は除く) */
const WORD_END = /[\s\p{P}]/u;

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
  /** \Emp\ の後、次の言葉を読み終えるまで */
  let emphasize = false;
  /** \Chr=Whisper\ */
  let whisper = false;
  /** いまの速さ・高さ・音量 (強調・ささやきを含む) */
  const tone = () => ({
    rate: emphasize ? settings.rate * EMPHASIS_RATE : settings.rate,
    pitch: emphasize ? clamp(settings.pitch * EMPHASIS_PITCH, 0, 2) : settings.pitch,
    volume: whisper ? settings.volume * WHISPER_VOLUME : settings.volume,
  });
  let buffer = "";
  const flush = () => {
    if (buffer) parts.push({ kind: "text", spoken: buffer, shown: buffer, ...tone() });
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
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
        if (name === "spd" && n > 0) settings = { ...settings, rate: clamp(wordsPerMinuteToRate(n), 0.1, 10) };
        if (name === "pit" && n > 0) settings = { ...settings, pitch: clamp(hertzToPitch(n), 0, 2) };
        if (name === "vol") settings = { ...settings, volume: clamp(n / 65535, 0, 1) };
        break;
      }
      case "rst":
        flush();
        settings = { rate: base.rate, pitch: base.pitch, volume: 1 };
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

/** 吹き出しに出す文 (タグを除いたもの) */
export function shownText(parts: readonly SpeechPart[]): string {
  return parts.map((p) => (p.kind === "text" ? p.shown : "")).join("");
}

/**
 * 目印 (\Mrk\) を、吹き出しに文字を出していくのに合わせて知らせるための関数を作る。
 * 返した関数に、出した文字数を渡すと、そこまでに通り過ぎた目印を fire に渡す (Infinity なら残り全部)
 */
export function bookmarkNotifier(parts: readonly SpeechPart[], fire: (id: number) => void): (shownCount: number) => void {
  const bookmarks: { at: number; id: number }[] = [];
  let offset = 0;
  for (const p of parts) {
    if (p.kind === "text") offset += [...p.shown].length;
    else if (p.kind === "bookmark") bookmarks.push({ at: offset, id: p.id });
  }
  return (shownCount) => {
    while (bookmarks.length > 0 && bookmarks[0]!.at <= shownCount) fire(bookmarks.shift()!.id);
  };
}

/** \Lst\ (直前の発言を繰り返す) だけの文か */
export const isRepeatTag = (text: string) => /^\s*\\lst\\\s*$/i.test(text);

/** \Mrk\ を取り除く (\Lst\ で繰り返すときは、目印は繰り返さない。本家と同じ) */
export const removeBookmarks = (text: string) => text.replace(/\\mrk=[^\\]*\\/gi, "");
