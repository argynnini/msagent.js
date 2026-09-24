import type { AcsPlayer } from "./acs/player";

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
const SILENT_MIN_MS = 1200;

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
}

/** ひらがな・カタカナ・漢字・半角カナを含めば日本語として読む */
const hasJapanese = (text: string) => /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/.test(text);

/** charIndex から始まる単語の長さ (charLength を教えてくれない音声のため) */
function wordLength(text: string, start: number): number {
  const rest = text.slice(start);
  const end = rest.search(/[\s、。，．,.!?！？]/);
  return end < 0 ? rest.length : end + 1;
}

export class Speaker {
  private mouthTimer: number | undefined;
  private fallbackTimer: number | undefined;
  private silentTimer: number | undefined;
  /** 口の動きの並びを出すたびに増やし、古い並びを止める */
  private mouthToken = 0;
  /** 読み上げ中の発話 (Chrome では参照を持っていないと、途中で GC されてイベントが来なくなることがある) */
  private utterance: SpeechSynthesisUtterance | undefined;
  private handlers: SpeakHandlers | undefined;
  /** 読み上げ中の文 (途中で止めても、吹き出しには全文を残すため) */
  private text = "";

  constructor(private readonly player: () => AcsPlayer | undefined) {}

  get speaking(): boolean {
    return this.handlers !== undefined;
  }

  /** params: 読み上げの速さ・高さ (ブラウザの値。標準 = 1。voiceParams() で ACS の設定から作る) */
  speak(text: string, handlers: SpeakHandlers, params = { rate: 1, pitch: 1 }) {
    this.cancel();
    this.handlers = handlers;
    this.text = text;
    handlers.onProgress("");

    const synth = typeof speechSynthesis === "undefined" ? undefined : speechSynthesis;
    if (!synth) {
      handlers.onProgress(text);
      const steps = mouthSteps(text, MORA_MS / params.rate, PAUSE_MS / params.rate);
      this.playMouth(steps);
      const total = steps.reduce((sum, [, ms]) => sum + ms, 0);
      this.silentTimer = window.setTimeout(() => this.finish(), Math.max(SILENT_MIN_MS, total));
      return;
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang = hasJapanese(text) ? "ja-JP" : "en-US";
    u.rate = params.rate;
    u.pitch = params.pitch;
    // その言語の声があれば選ぶ (無ければブラウザ任せ)
    const voice = synth.getVoices().find((v) => v.lang.replace("_", "-").startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    let gotBoundary = false;
    // 声が出始めてから口を動かす。区切りの通知が来ない音声なら、全文を見積もって動かし、吹き出しにも全文を出す
    u.onstart = () => {
      if (this.utterance !== u) return;
      this.fallbackTimer = window.setTimeout(() => {
        if (gotBoundary || this.utterance !== u) return;
        handlers.onProgress(text);
        this.playMouth(mouthSteps(text, MORA_MS / u.rate, PAUSE_MS / u.rate), true);
      }, BOUNDARY_WAIT_MS);
    };
    // 単語の区切り: その単語の口の動きを出し直す (前の単語の残りは打ち切る)
    u.onboundary = (e) => {
      if (this.utterance !== u || e.name === "sentence") return;
      gotBoundary = true;
      const end = e.charIndex + (e.charLength || wordLength(text, e.charIndex));
      handlers.onProgress(text.slice(0, end));
      this.playMouth(mouthSteps(text.slice(e.charIndex, end), MORA_MS / u.rate));
    };
    u.onend = u.onerror = () => {
      if (this.utterance === u) this.finish();
    };
    this.utterance = u;
    synth.speak(u);
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

  private finish() {
    const handlers = this.handlers;
    if (!handlers) return;
    this.handlers = undefined;
    this.utterance = undefined;
    this.mouthToken++;
    for (const t of [this.mouthTimer, this.fallbackTimer, this.silentTimer]) window.clearTimeout(t);
    this.mouthTimer = this.fallbackTimer = this.silentTimer = undefined;
    this.player()?.setMouth(undefined);
    handlers.onProgress(this.text);
    handlers.onEnd();
  }
}
