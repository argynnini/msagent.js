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

/** ACS の声の設定から、ブラウザの読み上げの速さ (rate) と高さ (pitch) を決める。設定が無い項目は標準 (1) */
export function voiceParams(voice: { speed?: number; pitch?: number } | undefined): { rate: number; pitch: number } {
  return {
    rate: voice?.speed ? clamp(wordsPerMinuteToRate(voice.speed), 0.5, 2) : 1,
    pitch: voice?.pitch ? clamp(hertzToPitch(voice.pitch), 0.1, 2) : 1,
  };
}

/** 読み上げの設定 (速さ・高さはブラウザの値。標準 = 1) */
export interface SpeakParams {
  rate: number;
  pitch: number;
  /** 読み上げの言語 (BCP 47)。省略時は文から推測する (かな・漢字があれば日本語、無ければ英語) */
  lang?: string;
  /** 声の性別の希望 (合う声があれば、それを選ぶ) */
  gender?: "neutral" | "female" | "male";
  /**
   * 使う声 (voiceURI か名前。本家の TTSModeID)。見つかれば、言語・性別から選ぶ代わりにこの声で読む
   * (制御タグで言語・性別を変えた部分は除く)。見つからなければ、言語・性別から選ぶ
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
const FEMALE_VOICE = /\b(female|woman|haruka|ayumi|sayaka|nanami|mayu|kyoko|o-ren|zira|hazel|susan|aria|jenny|michelle|samantha|victoria|karen|moira|tessa|fiona|allison|ava|serena|kathy|heera|huihui|yaoyao|hanhan|tracy|yating|heami|sunhi|katja|hedda|hortense|julie|elsa|helena|laura|paulina|sabina|irina|maria|zuzana|helle)\b|\u5973\u6027/i; // 女性
const MALE_VOICE = /\b(male|man|ichiro|keita|otoya|hattori|david|mark|george|guy|james|richard|daniel|alex|fred|ralph|bruce|tom|aaron|arthur|oliver|kangkang|zhiwei|danny|hyunsu|stefan|paul|claude|pablo|raul|pavel|filip)\b|\u7537\u6027/i; // 男性

function voiceGender(voice: SpeechSynthesisVoice): "female" | "male" | undefined {
  if (FEMALE_VOICE.test(voice.name)) return "female";
  if (MALE_VOICE.test(voice.name)) return "male";
  return undefined;
}

/**
 * 声を選ぶ (本家と同じく、言語 → 性別の順に合わせる)。同じ言語の声が無ければ undefined (ブラウザ任せ)。
 * 地域まで同じ声 (ja-JP) → 言語だけ同じ声 (ja) の順に探し、その中で性別が合う声 → 既定の声 → 最初の声
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
