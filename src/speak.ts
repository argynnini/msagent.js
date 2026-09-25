import type { AcsPlayer } from "./acs/player";
import { parseSpeechTags, shownText, type SpeechPart } from "./tags";

/**
 * キャラクターにしゃべらせる: ブラウザの音声合成 (Web Speech API) で読み上げ、その間は口の形 (ACS の口の画像) を切り替える。
 *
 * 音声合成は、音声そのものも、いま出している音 (口の形) も教えてくれない。分かるのは読み上げの開始・終了と、
 * 単語の区切り (boundary) の位置だけなので、次のように近似して合わせる。
 * - 声が出始めた (onstart) ときから口を動かし、終わったら閉じる
 * - 単語の区切りが来るたびに、その単語を拍 (モーラ) に分け、母音に合う口の形を拍ごとに出す。言い終えたら閉じて、次の区切りを待つ
 *   (区切りのたびに合わせ直すので、見積もりの誤差がたまらない。句読点の間は口が閉じる)
 * - 区切りが来ない音声では、全文を拍に分けて、時間を見積もって出す
 * 音声合成が使えない環境では、声なしで、見積もった時間だけ口を動かす
 */

/** 口の形: 0 閉じる, 1〜4 大きく開く (段階), 5 中くらい, 6 すぼめる */
const MOUTH_CLOSED = 0;
/** 母音ごとの口の形 (あ: 大きく, い: 少し, う: すぼめる, え: やや大きく, お: 中くらい) */
const VOWEL_MOUTH: Record<string, number> = { a: 4, i: 1, u: 6, e: 2, o: 5 };
const VOWELS = Object.keys(VOWEL_MOUTH);
/** 読みが分からない文字 (漢字・数字など) は、1 文字をこの拍数とみなす */
const UNKNOWN_MORAE = 2;
/** 1 拍の長さ (標準の速さ。日本語の読み上げはおよそ 1 秒に 7〜8 拍) */
const MORA_MS = 130;
/** 句読点での間 (区切りの通知が来ない音声で、全文を見積もるとき) */
const PAUSE_MS = 250;
/** 単語の区切りの通知 (boundary) が来ない音声とみなすまでの時間 (過ぎたら、全文を見積もって口を動かし、吹き出しにも全文を出す) */
const BOUNDARY_WAIT_MS = 400;

/**
 * ACS の声の設定 (SAPI 4 の値) を、ブラウザの読み上げの速さ・高さ (どちらも標準 = 1) に直すときの基準。
 * どちらも近似: 速さはブラウザの標準の声がおよそ 170 語/分、高さは成人の声の基準をおよそ 100 Hz とみなす
 */
const BASE_WORDS_PER_MINUTE = 170;
const BASE_PITCH_HZ = 100;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** ACS の声の設定から、ブラウザの読み上げの速さ (rate) と高さ (pitch) を決める。設定が無い項目は標準 (1) */
export function voiceParams(voice: { speed?: number; pitch?: number } | undefined): { rate: number; pitch: number } {
  return {
    rate: voice?.speed ? clamp(voice.speed / BASE_WORDS_PER_MINUTE, 0.5, 2) : 1,
    pitch: voice?.pitch ? clamp(voice.pitch / BASE_PITCH_HZ, 0.1, 2) : 1,
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
}

/**
 * 声の名前から性別を推測する。ブラウザの声には性別の情報が無いので、よく使われる声の名前で見分ける
 * (Windows・macOS・Chrome の声など。分からなければ undefined)
 */
const FEMALE_VOICE = /\b(female|woman|haruka|ayumi|sayaka|nanami|mayu|kyoko|o-ren|zira|hazel|susan|aria|jenny|michelle|samantha|victoria|karen|moira|tessa|fiona|allison|ava|serena|kathy|heera|huihui|yaoyao|hanhan|tracy|yating|heami|sunhi|katja|hedda|hortense|julie|elsa|helena|laura|paulina|sabina|irina|maria|zuzana|helle)\b|女性/i;
const MALE_VOICE = /\b(male|man|ichiro|keita|otoya|hattori|david|mark|george|guy|james|richard|daniel|alex|fred|ralph|bruce|tom|aaron|arthur|oliver|kangkang|zhiwei|danny|hyunsu|stefan|paul|claude|pablo|raul|pavel|filip)\b|男性/i;

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

/** 口の動きの 1 コマ: 口の形と、その長さ (ms) */
type MouthStep = [shape: number, ms: number];

const KANA_VOWELS: [string, string][] = [
  ["a", "あかさたなはまやらわがざだばぱぁゃゎ"],
  ["i", "いきしちにひみりぎじぢびぴぃ"],
  ["u", "うくすつぬふむゆるぐずづぶぷぅゅゔ"],
  ["e", "えけせてねへめれげぜでべぺぇ"],
  ["o", "おこそとのほもよろをごぞどぼぽぉょ"],
];
const KANA_VOWEL = new Map<string, string>(KANA_VOWELS.flatMap(([v, chars]) => [...chars].map((c): [string, string] => [c, v])));
/** 前の拍と合わさって 1 拍になる小さい文字 (きゃ・しゅ など) */
const SMALL_KANA = "ゃゅょぁぃぅぇぉゎ";
const PAUSE_CHAR = /[\s、。，．,.!?！？…・「」『』（）()]/;

/** カタカナをひらがなに (口の形を決めるだけなので、細かい違いは気にしない) */
const toHiragana = (c: string) => {
  const code = c.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c;
};

const randomVowelMouth = () => VOWEL_MOUTH[VOWELS[Math.floor(Math.random() * VOWELS.length)]!]!;

/**
 * 文を、口の形の並びにする (1 拍 = moraMs)。句読点や空白は、閉じた口の間 (pauseMs。0 なら入れない) にする。
 * かなは母音から、英字は母音字から口の形を決める。読みが分からない文字 (漢字など) は、形を適当に選ぶ
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

export interface SpeakHandlers {
  /** 吹き出しに出す、読み上げ済みの部分 (最後は全文) */
  onProgress(shown: string): void;
  /** 読み上げが終わった (cancel() でも呼ばれる) */
  onEnd(): void;
  /** 目印 (\Mrk=番号\) まで読んだ */
  onBookmark?(id: number): void;
}

/** ひらがな・カタカナ・漢字・半角カナを含めば日本語として読む */
const hasJapanese = (text: string) => /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(text);

/** charIndex から始まる単語の長さ (charLength を教えてくれない音声のため) */
function wordLength(text: string, start: number): number {
  const rest = text.slice(start);
  const end = rest.search(/[\s、。，．,.!?！？]/);
  return end < 0 ? rest.length : end + 1;
}

/** 声を出さないとき、読み上げる部分 1 つにかける最短の時間 */
const SILENT_PART_MIN_MS = 300;

/** 1 回の speak() で、部分をまたいで使うもの */
interface Run {
  handlers: SpeakHandlers;
  synth: SpeechSynthesis | undefined;
  lang: string;
  gender: SpeakParams["gender"];
}

export class Speaker {
  private mouthTimer: number | undefined;
  private fallbackTimer: number | undefined;
  /** 間 (\Pau\) や、声を出さないときの部分の長さのタイマー */
  private partTimer: number | undefined;
  /** 声を出さないときに、吹き出しの文を少しずつ出すタイマー */
  private paceTimer: number | undefined;
  /** 口の動きの並びを出すたびに増やし、古い並びを止める */
  private mouthToken = 0;
  /** 読み上げ中の発話 (Chrome では参照を持っていないと、途中で GC されてイベントが来なくなることがある) */
  private utterance: SpeechSynthesisUtterance | undefined;
  private run: Run | undefined;
  /** 吹き出しに出す全文 (途中で止めても、吹き出しには全文を残すため) */
  private text = "";
  /** 音声ファイルでしゃべっているときの、再生している音 */
  private source: AudioBufferSourceNode | undefined;

  constructor(private readonly player: () => AcsPlayer | undefined) {}

  get speaking(): boolean {
    return this.run !== undefined;
  }

  /**
   * 読み上げる。input は文 (読み上げの制御タグ \Pau=500\ などを含んでよい) か、parseSpeechTags() で作った部分の並び。
   * params: 読み上げの速さ・高さ (ブラウザの値。標準 = 1。voiceParams() で ACS の設定から作る)・言語・声の性別。
   * aloud が false なら声を出さず、見積もった時間だけ口を動かし、吹き出しの文も少しずつ出す
   */
  speak(
    input: string | readonly SpeechPart[],
    handlers: SpeakHandlers,
    params: SpeakParams = { rate: 1, pitch: 1 },
    aloud = true,
  ) {
    this.cancel();
    const parts = typeof input === "string" ? parseSpeechTags(input, params) : input;
    this.text = shownText(parts);
    const spoken = parts.map((p) => (p.kind === "text" ? p.spoken : "")).join("");
    const run: Run = {
      handlers,
      synth: !aloud || typeof speechSynthesis === "undefined" ? undefined : speechSynthesis,
      lang: params.lang ?? (hasJapanese(spoken) ? "ja-JP" : "en-US"),
      gender: params.gender,
    };
    this.run = run;
    handlers.onProgress("");
    this.speakPart(run, parts, 0, "");
  }

  /**
   * 音声ファイル (デコード済み) でしゃべる (本家の Speak の Url と同じ)。音の大きさに合わせて口を動かし、
   * 吹き出しの文 (parts。目印も含めてよい) は、音の長さに合わせて少しずつ出す。volume が 0 なら音は出さず、口だけ動かす
   */
  speakAudio(
    audio: AudioBuffer,
    context: AudioContext,
    parts: readonly SpeechPart[],
    handlers: SpeakHandlers,
    volume = 1,
  ) {
    this.cancel();
    this.text = shownText(parts);
    const run: Run = { handlers, synth: undefined, lang: "", gender: undefined };
    this.run = run;
    handlers.onProgress("");
    if (context.state === "suspended") void context.resume().catch(() => undefined);

    const source = context.createBufferSource();
    source.buffer = audio;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(context.destination);
    this.source = source;

    // 吹き出しの文と目印の位置 (その前までの文字数)
    const chars = [...this.text];
    const bookmarks: { at: number; id: number }[] = [];
    let offset = 0;
    for (const p of parts) {
      if (p.kind === "text") offset += [...p.shown].length;
      else if (p.kind === "bookmark") bookmarks.push({ at: offset, id: p.id });
    }
    const total = Math.max(1, audio.duration * 1000);
    const started = performance.now();
    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (this.run !== run) return;
      // 口: 音の大きさ (RMS) で開き方を決める
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const rms = Math.sqrt(sum / samples.length);
      this.player()?.setMouth(rms < 0.02 ? MOUTH_CLOSED : rms < 0.05 ? 1 : rms < 0.1 ? 5 : rms < 0.18 ? 2 : 4);
      // 吹き出し: 音の長さに合わせて文字を出し、通り過ぎた目印を知らせる
      const n = Math.min(chars.length, Math.ceil((chars.length * (performance.now() - started)) / total));
      run.handlers.onProgress(chars.slice(0, n).join(""));
      while (bookmarks.length > 0 && bookmarks[0]!.at <= n) run.handlers.onBookmark?.(bookmarks.shift()!.id);
      this.mouthTimer = window.setTimeout(tick, 60);
    };
    source.onended = () => {
      if (this.run !== run) return;
      for (const b of bookmarks) run.handlers.onBookmark?.(b.id);
      this.finish();
    };
    source.start();
    tick();
  }

  /** 読み上げを途中でやめる (読み上げ中でなければ何もしない) */
  cancel() {
    if (!this.speaking) return;
    if (this.utterance) {
      this.utterance = undefined;
      speechSynthesis.cancel();
    }
    this.finish();
  }

  /** i 番目の部分を読む。読み終えたら次へ (shownBefore: それまでに吹き出しに出した文) */
  private speakPart(run: Run, parts: readonly SpeechPart[], i: number, shownBefore: string): void {
    if (this.run !== run) return;
    const part = parts[i];
    if (!part) return this.finish();
    const next = (shown: string): void => this.speakPart(run, parts, i + 1, shown);

    if (part.kind === "bookmark") {
      run.handlers.onBookmark?.(part.id);
      return next(shownBefore);
    }
    if (part.kind === "pause") {
      this.mouthToken++;
      this.player()?.setMouth(MOUTH_CLOSED);
      this.partTimer = window.setTimeout(() => next(shownBefore), part.ms);
      return;
    }

    const after = shownBefore + part.shown;
    if (!part.spoken.trim()) {
      run.handlers.onProgress(after);
      return next(after);
    }
    // \Map\ で読みと表示を変えたときは、読み始めに表示の文を全部出す
    const mapped = part.spoken !== part.shown;
    const progress = (shown: string) => {
      if (this.run === run) run.handlers.onProgress(shownBefore + (mapped ? part.shown : shown));
    };

    if (!run.synth) {
      const steps = mouthSteps(part.spoken, MORA_MS / part.rate, PAUSE_MS / part.rate);
      this.playMouth(steps);
      const total = Math.max(SILENT_PART_MIN_MS, steps.reduce((sum, [, ms]) => sum + ms, 0));
      if (mapped) progress(part.shown);
      else this.pace(run, part.spoken, total, progress);
      this.partTimer = window.setTimeout(() => next(after), total);
      return;
    }

    const u = new SpeechSynthesisUtterance(part.spoken);
    u.lang = run.lang;
    u.rate = part.rate;
    u.pitch = part.pitch;
    u.volume = part.volume;
    // その言語 (と性別) に合う声があれば選ぶ (無ければブラウザ任せ)
    const voice = pickVoice(run.synth.getVoices(), u.lang, run.gender);
    if (voice) u.voice = voice;
    let gotBoundary = false;
    // 声が出始めてから口を動かす。区切りの通知が来ない音声なら、全文を見積もって動かし、吹き出しにも全文を出す
    u.onstart = () => {
      if (this.utterance !== u) return;
      this.fallbackTimer = window.setTimeout(() => {
        if (gotBoundary || this.utterance !== u) return;
        progress(part.spoken);
        this.playMouth(mouthSteps(part.spoken, MORA_MS / u.rate, PAUSE_MS / u.rate), true);
      }, BOUNDARY_WAIT_MS);
    };
    // 単語の区切り: その単語の口の動きを出し直す (前の単語の残りは打ち切る)
    u.onboundary = (e) => {
      if (this.utterance !== u || e.name === "sentence") return;
      gotBoundary = true;
      const end = e.charIndex + (e.charLength || wordLength(part.spoken, e.charIndex));
      progress(part.spoken.slice(0, end));
      this.playMouth(mouthSteps(part.spoken.slice(e.charIndex, end), MORA_MS / u.rate));
    };
    u.onend = u.onerror = () => {
      if (this.utterance !== u) return;
      this.utterance = undefined;
      window.clearTimeout(this.fallbackTimer);
      this.mouthToken++;
      this.player()?.setMouth(MOUTH_CLOSED);
      next(after);
    };
    this.utterance = u;
    run.synth.speak(u);
  }

  /**
   * 口の形の並びを順に出す (前の並びは打ち切る)。出し終えたら口を閉じて、次の区切りを待つ。
   * keepTalking なら、見積もりより読み上げが長引いたときも、終わるまで形を適当に変えて口を動かし続ける
   */
  private playMouth(steps: MouthStep[], keepTalking = false) {
    const token = ++this.mouthToken;
    window.clearTimeout(this.mouthTimer);
    let i = 0;
    const next = () => {
      if (token !== this.mouthToken || !this.speaking) return;
      const step = steps[i++];
      if (!step && keepTalking) {
        this.player()?.setMouth(randomVowelMouth());
        this.mouthTimer = window.setTimeout(next, MORA_MS);
        return;
      }
      this.player()?.setMouth(step ? step[0] : MOUTH_CLOSED);
      if (step) this.mouthTimer = window.setTimeout(next, step[1]);
    };
    next();
  }

  /**
   * 声を出さないとき: 口を動かす時間に合わせて、吹き出しの文を少しずつ出す。
   * 英語などは単語の区切りまで、日本語などは文字ごとに出す
   */
  private pace(run: Run, text: string, total: number, onProgress: (shown: string) => void) {
    const chars = [...text];
    const start = performance.now();
    let shown = -1;
    const tick = () => {
      if (this.run !== run) return;
      const t = Math.min(1, (performance.now() - start) / total);
      let n = Math.ceil(chars.length * t);
      // 単語の途中で切らない (空白で区切る言葉のとき)
      while (n < chars.length && /[A-Za-z0-9'-]/.test(chars[n - 1] ?? "") && /[A-Za-z0-9'-]/.test(chars[n]!)) n++;
      if (n !== shown) {
        shown = n;
        onProgress(chars.slice(0, n).join(""));
      }
      if (n < chars.length) this.paceTimer = window.setTimeout(tick, 60);
    };
    tick();
  }

  private finish() {
    const run = this.run;
    if (!run) return;
    this.run = undefined;
    this.utterance = undefined;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // まだ始まっていない・もう終わっている
      }
      this.source = undefined;
    }
    this.mouthToken++;
    for (const t of [this.mouthTimer, this.fallbackTimer, this.partTimer, this.paceTimer]) window.clearTimeout(t);
    this.mouthTimer = this.fallbackTimer = this.partTimer = this.paceTimer = undefined;
    this.player()?.setMouth(undefined);
    run.handlers.onProgress(this.text);
    run.handlers.onEnd();
  }
}
