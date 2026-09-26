/**
 * 読み上げの声: ACS の声の設定 (SAPI 4 の値) をブラウザの読み上げの値に直すことと、ブラウザの声から合うものを選ぶこと
 */

/**
 * ACS の声の設定を、ブラウザの読み上げの速さ・高さ (どちらも標準 = 1) に直すときの基準。
 * どちらも近似: 速さはブラウザの標準の声がおよそ 170 語/分、高さは成人の声の基準をおよそ 100 Hz とみなす
 */
const BASE_WORDS_PER_MINUTE = 170;
const BASE_PITCH_HZ = 100;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** 語/分 → ブラウザの読み上げの速さ (標準 = 1)。範囲には収めない */
export const wordsPerMinuteToRate = (wpm: number) => wpm / BASE_WORDS_PER_MINUTE;

/** Hz → ブラウザの読み上げの高さ (標準 = 1)。範囲には収めない */
export const hertzToPitch = (hz: number) => hz / BASE_PITCH_HZ;

/**
 * Converts a character's voice settings (words per minute and Hz) to browser speech `rate` and `pitch`
 * (normal = 1), approximately. Missing settings become `1`.
 *
 * ```js
 * voiceParams({ speed: 180, pitch: 130 }); // → { rate: 1.058..., pitch: 1.3 }
 * ```
 */
export function voiceParams(voice: { speed?: number; pitch?: number } | undefined): { rate: number; pitch: number } {
  return {
    rate: voice?.speed ? clamp(wordsPerMinuteToRate(voice.speed), 0.5, 2) : 1,
    pitch: voice?.pitch ? clamp(hertzToPitch(voice.pitch), 0.1, 2) : 1,
  };
}

/** Speech settings for {@link Speaker}. */
export interface SpeakParams {
  /** Speaking rate (browser value, normal = 1). */
  rate: number;
  /** Pitch (browser value, normal = 1). */
  pitch: number;
  /** Language as a BCP 47 tag. Default: Japanese if the text contains kana or kanji, otherwise English. */
  lang?: string;
  /** Preferred voice gender, used if a matching voice is found. */
  gender?: "neutral" | "female" | "male";
  /**
   * Voice to use: a `voiceURI` or name (like Microsoft Agent's `TTSModeID`). Used instead of choosing by language and
   * gender, except in parts whose language or gender is changed with tags. If not found, a voice is chosen as usual.
   */
  voice?: string;
}

/** voiceURI か名前 (大文字小文字は問わない) で声を探す */
export function findVoice(voices: readonly SpeechSynthesisVoice[], id: string): SpeechSynthesisVoice | undefined {
  const lower = id.toLowerCase();
  return voices.find((v) => v.voiceURI === id) ?? voices.find((v) => v.name.toLowerCase() === lower);
}

/**
 * 声の名前から性別を推測する。ブラウザの声には性別の情報が無いので、よく使われる声の名前で見分ける
 * (Windows・macOS・Chrome の声など。分からなければ undefined)
 */
const FEMALE_VOICE =
  /\b(female|woman|haruka|ayumi|sayaka|nanami|mayu|kyoko|o-ren|zira|hazel|susan|aria|jenny|michelle|samantha|victoria|karen|moira|tessa|fiona|allison|ava|serena|kathy|heera|huihui|yaoyao|hanhan|tracy|yating|heami|sunhi|katja|hedda|hortense|julie|elsa|helena|laura|paulina|sabina|irina|maria|zuzana|helle)\b|\u5973\u6027/i; // 女性
const MALE_VOICE =
  /\b(male|man|ichiro|keita|otoya|hattori|david|mark|george|guy|james|richard|daniel|alex|fred|ralph|bruce|tom|aaron|arthur|oliver|kangkang|zhiwei|danny|hyunsu|stefan|paul|claude|pablo|raul|pavel|filip)\b|\u7537\u6027/i; // 男性

function voiceGender(voice: SpeechSynthesisVoice): "female" | "male" | undefined {
  if (FEMALE_VOICE.test(voice.name)) return "female";
  if (MALE_VOICE.test(voice.name)) return "male";
  return undefined;
}

/**
 * Chooses a browser voice by language, then gender, like Microsoft Agent.
 *
 * Voices with the same region (`ja-JP`) are preferred over those with only the same language (`ja`); among them, a
 * voice of the wanted gender (guessed from well-known voice names), then the default voice, then the first one.
 *
 * @param voices - Usually `speechSynthesis.getVoices()`.
 * @param lang - BCP 47 language tag.
 * @returns `undefined` if no voice has the language (the browser then chooses).
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  lang: string,
  gender?: "neutral" | "female" | "male",
): SpeechSynthesisVoice | undefined {
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  const exact = voices.filter((v) => norm(v.lang) === norm(lang));
  const primary = voices.filter((v) => norm(v.lang).split("-")[0] === norm(lang).split("-")[0]);
  const pool = exact.length > 0 ? exact : primary;
  if (pool.length === 0) return undefined;
  if (gender === "female" || gender === "male") {
    const matched = pool.filter((v) => voiceGender(v) === gender);
    if (matched.length > 0) return matched.find((v) => v.default) ?? matched[0];
  }
  return pool.find((v) => v.default) ?? pool[0];
}
