/**
 * 口の形 (ACS の口の画像の種類) を、文や音から見積もる
 */

/** 口の形: 0 閉じる, 1〜4 大きく開く (段階), 5 中くらい, 6 すぼめる */
export const MOUTH_CLOSED = 0;
/** 母音ごとの口の形 (あ: 大きく, い: 少し, う: すぼめる, え: やや大きく, お: 中くらい) */
const VOWEL_MOUTH: Record<string, number> = { a: 4, i: 1, u: 6, e: 2, o: 5 };
const VOWELS = Object.keys(VOWEL_MOUTH);
/** 読みが分からない文字 (漢字・数字など) は、1 文字をこの拍数とみなす */
const UNKNOWN_MORAE = 2;
/** 1 拍の長さ (標準の速さ。日本語の読み上げはおよそ 1 秒に 7〜8 拍) */
export const MORA_MS = 130;
/** 句読点での間 (全文を見積もるとき) */
export const PAUSE_MS = 250;

/**
 * One step of mouth movement: a mouth shape (`0` closed, `1`–`4` wide open, `5` medium, `6` narrow) and its
 * duration in milliseconds.
 */
export type MouthStep = [shape: number, ms: number];

const KANA_VOWELS: [string, string][] = [
  ["a", "あかさたなはまやらわがざだばぱぁゃゎ"],
  ["i", "いきしちにひみりぎじぢびぴぃ"],
  ["u", "うくすつぬふむゆるぐずづぶぷぅゅゔ"],
  ["e", "えけせてねへめれげぜでべぺぇ"],
  ["o", "おこそとのほもよろをごぞどぼぽぉょ"],
];
const KANA_VOWEL = new Map<string, string>(
  KANA_VOWELS.flatMap(([v, chars]) => [...chars].map((c): [string, string] => [c, v])),
);
/** 前の拍と合わさって 1 拍になる小さい文字 (きゃ・しゅ など) */
const SMALL_KANA = "ゃゅょぁぃぅぇぉゎ";
const PAUSE_CHAR = /[\s\u3001\u3002\uff0c\uff0e,.!?\uff01\uff1f\u2026\u30fb\u300c\u300d\u300e\u300f\uff08\uff09()]/; // 空白・句読点・かっこ (、。！？…・「」『』（） など)

/** カタカナをひらがなに (口の形を決めるだけなので、細かい違いは気にしない) */
const toHiragana = (c: string) => {
  const code = c.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c;
};

/** 母音の口の形から、1 つを適当に選ぶ */
export const randomVowelMouth = () => VOWEL_MOUTH[VOWELS[Math.floor(Math.random() * VOWELS.length)]!]!;

/**
 * Estimates mouth movement for text, one step per mora. Kana use their vowel, Latin letters use vowel letters
 * (with `m` / `b` / `p` closing the mouth), and other characters (kanji, digits, other scripts) get random shapes.
 *
 * @param moraMs - Duration of one mora in milliseconds.
 * @param pauseMs - Closed-mouth pause for whitespace and punctuation, or `0` for none.
 */
export function mouthSteps(text: string, moraMs: number, pauseMs = 0): MouthStep[] {
  const steps: MouthStep[] = [];
  const push = (shape: number, ms = moraMs) => steps.push([shape, ms]);
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const c = toHiragana(chars[i]!);
    const lower = c.toLowerCase();
    if (PAUSE_CHAR.test(c)) {
      if (pauseMs > 0) push(MOUTH_CLOSED, pauseMs);
    } else if (SMALL_KANA.includes(c) && steps.length > 0) {
      // きゃ → 「あ」の口に直す (拍は増やさない)
      steps[steps.length - 1]![0] = VOWEL_MOUTH[KANA_VOWEL.get(c)!]!;
    } else if (KANA_VOWEL.has(c)) {
      push(VOWEL_MOUTH[KANA_VOWEL.get(c)!]!);
    } else if (c === "ん" || c === "っ") {
      push(MOUTH_CLOSED);
    } else if (c === "ー") {
      push(steps.at(-1)?.[0] ?? VOWEL_MOUTH.a!);
    } else if (/[a-z]/.test(lower)) {
      // 英字: 母音字ごとに 1 拍 (続く母音字はまとめる)。m / b / p は口を閉じる
      if (VOWEL_MOUTH[lower] !== undefined) {
        if (!/[aeiou]/.test(chars[i - 1]?.toLowerCase() ?? "")) push(VOWEL_MOUTH[lower]!);
      } else if ("mbp".includes(lower)) {
        push(MOUTH_CLOSED, moraMs / 2);
      }
    } else {
      for (let k = 0; k < UNKNOWN_MORAE; k++) push(randomVowelMouth());
    }
  }
  return steps;
}

/** 口の動きの並びの長さ (ms) */
export const stepsDuration = (steps: readonly MouthStep[]) => steps.reduce((sum, [, ms]) => sum + ms, 0);

/**
 * 音の大きさ (RMS、0〜1) から口の形を決める (音声ファイルでしゃべるとき)。
 * 本家 (mslwvtts.dll) と同じく、大きいほど 0 → 1 → 2 → 3 → 4 と開く
 */
export function mouthForLevel(rms: number): number {
  if (rms < 0.02) return MOUTH_CLOSED;
  if (rms < 0.05) return 1;
  if (rms < 0.1) return 2;
  if (rms < 0.18) return 3;
  return 4;
}

/**
 * IPA (国際音声記号) の 1 文字ごとの口の形。本家の Microsoft Agent 2.0 (AgentDpv.dll) の表と同じ (空白と _ は無音)。
 * 0 閉じる, 1〜4 大きく開く (段階), 5 中くらい, 6 すぼめる
 */
const IPA_MOUTH_GROUPS: readonly string[] = [
  " _bmpɓɸʘβ",
  "finvɨɩɪɯɱʇʋ",
  "cdeklqstzðŋɖɗɘɟɡɢɬɭɮɲɳɺɽɾɿʂʈʐʔʗʣʥʦʨθ",
  "jxçɑəɛɠɣɥɧɰɴʀʁʆʌʎʓχ",
  "ahæħɜɦʕʖ",
  "œɒɔɕɚɝɞɤɫɶɹɻʃʄʅʑʒʤʧ",
  "oruwyøɵɷɼʉʊʍʏ",
];
const IPA_MOUTH = new Map<number, number>(
  IPA_MOUTH_GROUPS.flatMap((chars, shape) => [...chars].map((c): [number, number] => [c.codePointAt(0)!, shape])),
);

/**
 * Mouth shape for one IPA character (a code point), using the same table as Microsoft Agent 2.0.
 * Returns `undefined` for characters not in the table.
 */
export const mouthForIpa = (code: number): number | undefined => IPA_MOUTH.get(code);
