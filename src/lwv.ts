/**
 * 言語情報つきの音声ファイル (.lwv。Linguistic Information Sound Editing Tool で作るもの) を読む。
 *
 * 公式の資料は無いので、Sound Editing Tool (liset.exe) の書き出しと、Microsoft Agent の読み込み (mslwvtts.dll) から調べた形:
 *
 * ```
 * RIFF 'WAVE' { 'fmt ', 'data' }   普通の WAV
 * LIST 'WPMK' {                    WAV の後ろに足してある
 *   'LCID'  言語 ID (4 バイト)
 *   'WMRK'  単語の並び
 *   'PMRK'  音素の並び
 * }
 * 単語・音素 1 つ: 開始 (u64), 終わり (u64), 文字の長さ (u32, 4 の倍数), 文字 (\0 で終わる)
 * ```
 *
 * 開始・終わりは data の中のバイトの位置 (時間 = 位置 / 1 秒あたりのバイト数)。
 * 単語は LCID の言語の文字コード、音素は IPA のコードポイントを 16 進で書いたもの ("0x0251")。
 * 2 つの音でできた音素は "0x0074+0x0283" のように + でつなぐ
 */

/** A word in a .lwv file. */
export interface LwvWord {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** The word. */
  text: string;
}

/** A phoneme in a .lwv file. */
export interface LwvPhoneme {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** IPA code points (two for a phoneme made of two sounds). */
  ipa: number[];
}

/** Linguistic information read from a .lwv file. */
export interface LwvInfo {
  /** Windows language ID (LCID, e.g. `0x0409`), or `undefined` if missing. */
  language: number | undefined;
  /** The words, in order. */
  words: LwvWord[];
  /** The phonemes, in order. */
  phonemes: LwvPhoneme[];
}

/** 2 つの音をつないだ IPA の文字 (ʣ ʤ ʥ ʦ ʧ ʨ) は、分けて扱う (本家と同じ) */
const LIGATURES: Record<number, number[]> = {
  0x2a3: [0x64, 0x7a],
  0x2a4: [0x64, 0x292],
  0x2a5: [0x64, 0x293],
  0x2a6: [0x74, 0x73],
  0x2a7: [0x74, 0x283],
  0x2a8: [0x74, 0x255],
};

/** 言語 ID (の主言語) から、ANSI の文字コード */
function encodingFor(lcid: number | undefined): string {
  const primary = (lcid ?? 0) & 0x3ff;
  const sub = (lcid ?? 0) >> 10;
  switch (primary) {
    case 0x11:
      return "shift_jis";
    case 0x12:
      return "euc-kr";
    case 0x04:
      return sub === 2 || sub === 4 ? "gbk" : "big5";
    case 0x1e:
      return "windows-874";
    case 0x05:
    case 0x0e:
    case 0x15:
    case 0x18:
    case 0x1a:
    case 0x1b:
    case 0x24:
      return "windows-1250";
    case 0x02:
    case 0x19:
    case 0x22:
    case 0x23:
      return "windows-1251";
    case 0x08:
      return "windows-1253";
    case 0x1f:
      return "windows-1254";
    case 0x0d:
      return "windows-1255";
    case 0x01:
      return "windows-1256";
    case 0x25:
    case 0x26:
    case 0x27:
      return "windows-1257";
    default:
      return "windows-1252";
  }
}

const fourcc = (v: DataView, at: number) =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

/** [from, to) にあるチャンクを順に返す (id, 中身の始まり, 大きさ) */
function* chunks(v: DataView, from: number, to: number): Generator<[string, number, number]> {
  let at = from;
  while (at + 8 <= to) {
    const size = v.getUint32(at + 4, true);
    yield [fourcc(v, at), at + 8, Math.min(size, to - at - 8)];
    at += 8 + size + (size & 1);
  }
}

/** "0x0074+0x0283" → [0x74, 0x283] (C の strtoul と同じく、0x なら 16 進、0 で始まれば 8 進、ほかは 10 進) */
function parseIpa(label: string): number[] {
  const codes: number[] = [];
  for (const piece of label.split("+")) {
    const s = piece.trim();
    const code = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : /^0[0-7]/.test(s) ? parseInt(s, 8) : parseInt(s, 10);
    if (!Number.isFinite(code)) continue;
    codes.push(...(LIGATURES[code] ?? [code]));
  }
  return codes;
}

/**
 * Reads the words and phonemes of a .lwv file (a WAV file with linguistic information, made with the Microsoft
 * Linguistic Information Sound Editing Tool). `data` is not modified, so it can be passed to `decodeAudioData()`.
 *
 * @returns `undefined` if the file has no linguistic information (e.g. a plain WAV file).
 */
export function readLwv(data: ArrayBuffer): LwvInfo | undefined {
  const v = new DataView(data);
  if (v.byteLength < 12 || fourcc(v, 0) !== "RIFF" || fourcc(v, 8) !== "WAVE") return undefined;
  // 1 秒あたりのバイト数 (fmt の nAvgBytesPerSec)
  const riffEnd = Math.min(v.byteLength, 8 + v.getUint32(4, true));
  let bytesPerSec = 0;
  let list: [number, number] | undefined;
  for (const [id, at, size] of chunks(v, 12, riffEnd)) {
    if (id === "fmt " && size >= 12) bytesPerSec = v.getUint32(at + 8, true);
    if (id === "LIST" && size >= 4 && fourcc(v, at) === "WPMK") list = [at + 4, at + size];
  }
  // 本家は RIFF の後ろに足す (RIFF の中にあっても読む)
  if (!list) {
    for (const [id, at, size] of chunks(v, riffEnd + (riffEnd & 1), v.byteLength)) {
      if (id === "LIST" && size >= 4 && fourcc(v, at) === "WPMK") list = [at + 4, at + size];
    }
  }
  if (!list || !bytesPerSec) return undefined;

  let language: number | undefined;
  const marks: Record<string, { start: number; end: number; bytes: Uint8Array }[]> = { WMRK: [], PMRK: [] };
  for (const [id, at, size] of chunks(v, list[0], list[1])) {
    if (id === "LCID" && size >= 4) language = v.getUint32(at, true);
    const into = marks[id];
    if (!into) continue;
    let p = at;
    while (p + 20 <= at + size) {
      const start = Number(v.getBigUint64(p, true));
      const end = Number(v.getBigUint64(p + 8, true));
      const length = v.getUint32(p + 16, true);
      p += 20;
      if (p + length > at + size) break;
      const bytes = new Uint8Array(data, p, length);
      const nul = bytes.indexOf(0);
      into.push({
        start: start / bytesPerSec,
        end: end / bytesPerSec,
        bytes: nul < 0 ? bytes : bytes.subarray(0, nul),
      });
      p += length;
    }
  }
  const words = new TextDecoder(encodingFor(language));
  const ascii = new TextDecoder("windows-1252");
  return {
    language,
    words: marks.WMRK!.map(({ start, end, bytes }) => ({ start, end, text: words.decode(bytes) })),
    phonemes: marks
      .PMRK!.map(({ start, end, bytes }) => ({ start, end, ipa: parseIpa(ascii.decode(bytes)) }))
      .filter((p) => p.ipa.length > 0),
  };
}

/** 音素が 1 秒あたりに変わる回数 (本家と同じ) */
export const LWV_MOUTH_RATE = 30;

/**
 * The IPA character (code point) being pronounced at time `t` in seconds; `"_"` (silence) between phonemes.
 * A phoneme made of two sounds is split evenly between them, like Microsoft Agent.
 */
export function ipaAt(phonemes: readonly LwvPhoneme[], t: number): number {
  const p = phonemes.find((x) => t >= x.start && t < x.end);
  if (!p) return 0x5f;
  const i = Math.floor(((t - p.start) / (p.end - p.start)) * p.ipa.length);
  return p.ipa[Math.min(i, p.ipa.length - 1)]!;
}
