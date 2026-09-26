/**
 * 聞き取り (本家の Listening mode)。ブラウザの音声認識 (Web Speech API の SpeechRecognition) を使う。
 *
 * - listen(true) (プログラム): 10 秒聞く。1 つ言い終えたら (結果が出たら) やめる
 * - 聞き取りキー: 押している間聞く (いくつ言ってもよい)。離したらやめる
 *
 * ブラウザによっては (Chrome・Edge)、声をインターネット上のサーバーに送って認識する
 */

/** How listening started: `listen()` (the program) or the listening key. */
export type ListenMode = "program" | "key";

/**
 * Why listening ended. Same idea as the `Cause` of Microsoft Agent's `ListenComplete`.
 *
 * - `"program"`: `listen(false)`
 * - `"timeout"`: the time ran out
 * - `"key"`: the listening key was released
 * - `"finished"`: the user finished speaking
 * - `"error"`: speech recognition failed (e.g. the microphone is not permitted; see `agent.srStatus`)
 */
export type ListenCause = "program" | "timeout" | "key" | "finished" | "error";

/**
 * Whether speech input is available, with the same values as Microsoft Agent's `SRStatus`:
 * `0` available, `1` no microphone, `4` no speech recognition in this browser or the service cannot be reached,
 * `5` microphone or speech recognition not permitted, `6` other error.
 */
export type SrStatus = 0 | 1 | 4 | 5 | 6;

/** One recognized alternative. */
export interface HeardAlternative {
  /** The recognized text. */
  transcript: string;
  /** Recognition confidence, 0–1. */
  confidence: number;
}

/** listen() で聞く時間 (本家と同じ 10 秒) */
export const LISTEN_TIMEOUT_MS = 10000;
/** 候補をいくつまで受け取るか (本家の UserInput と同じく、最もよいものと、次の 2 つ) */
const MAX_ALTERNATIVES = 3;

/** ブラウザの SpeechRecognition (型は lib.dom に無いので、使う分だけ書く) */
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionClass = new () => Recognition;

/** このブラウザの SpeechRecognition (無ければ undefined) */
export function recognitionClass(): RecognitionClass | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** 聞き取りのために、キャラクター (Agent) から借りるもの */
export interface ListenerHost {
  /** 聞き取る言語 (BCP 47) */
  lang(): string;
  onStart(mode: ListenMode): void;
  /** 声が聞こえ始めた (本家は Hearing の状態のアニメーションにする) */
  onHearing(): void;
  /** 1 つ言い終えた。候補は、よい順 */
  onHeard(alternatives: HeardAlternative[]): void;
  onEnd(cause: ListenCause): void;
}

export class Listener {
  private recognition: Recognition | undefined;
  private currentMode: ListenMode | undefined;
  private timer: number | undefined;
  /** stop() で言われた、終わった原因 (音声認識が止まったら onEnd で知らせる) */
  private endCause: ListenCause | undefined;
  private status: SrStatus = recognitionClass() ? 0 : 4;
  private speechHeard = false;
  /** 聞き取りキーを離した後の時間が過ぎたが、話している途中なので、言い終えたらやめる */
  private stopWhenQuiet = false;

  constructor(private readonly host: ListenerHost) {}

  /** 聞いているか */
  get listening(): boolean {
    return this.currentMode !== undefined;
  }

  get mode(): ListenMode | undefined {
    return this.currentMode;
  }

  get srStatus(): SrStatus {
    return this.status;
  }

  /** 声が聞こえている途中か (聞こえ始めてから、言い終えるまで) */
  get hearing(): boolean {
    return this.speechHeard;
  }

  /**
   * 聞き始める。プログラムからなら 10 秒で終わる (聞いている途中なら、時間を延ばす)。
   * キーからなら、stop("key") まで聞く。音声認識が使えなければ false
   */
  start(mode: ListenMode): boolean {
    const Class = recognitionClass();
    if (!Class) return false;
    window.clearTimeout(this.timer);
    this.stopWhenQuiet = false;
    if (mode === "program" && this.currentMode !== "key") {
      this.timer = window.setTimeout(() => this.stop("timeout"), LISTEN_TIMEOUT_MS);
    }
    if (this.currentMode) {
      // プログラムで聞いている途中にキーが押されたら、キーで聞く (知らせ直さない。本家と同じ)
      if (mode === "key") this.currentMode = "key";
      this.endCause = undefined;
      return true;
    }
    this.currentMode = mode;
    this.endCause = undefined;
    this.status = 0;
    this.host.onStart(mode);
    this.open(Class);
    return true;
  }

  /** 聞くのをやめる (音声認識が止まってから onEnd を呼ぶ。言いかけの分は、聞き取れれば onHeard に来る) */
  stop(cause: ListenCause) {
    if (!this.currentMode || this.endCause) return;
    window.clearTimeout(this.timer);
    this.endCause = cause;
    const rec = this.recognition;
    if (!rec) return this.end();
    try {
      rec.stop();
    } catch {
      this.end();
    }
  }

  /**
   * 聞き取りキーを離した。holdMs (0 以下ならすぐ) 聞き続けてからやめる。そのとき話している途中なら、言い終えるまで待つ
   * (本家の Listening key の time-out と同じ。待つのは長くても LISTEN_TIMEOUT_MS)
   */
  releaseKey(holdMs: number) {
    if (this.currentMode !== "key" || this.endCause) return;
    window.clearTimeout(this.timer);
    if (holdMs <= 0) return this.stop("key");
    this.timer = window.setTimeout(() => {
      if (!this.speechHeard) return this.stop("key");
      this.stopWhenQuiet = true;
      this.timer = window.setTimeout(() => this.stop("key"), LISTEN_TIMEOUT_MS);
    }, holdMs);
  }

  /** 声が聞こえなくなった (言い終えた) */
  private quiet() {
    this.speechHeard = false;
    if (this.stopWhenQuiet) this.stop("key");
  }

  /** すぐやめる (片付け。onEnd は呼ばない) */
  abort() {
    window.clearTimeout(this.timer);
    const rec = this.recognition;
    this.recognition = undefined;
    this.currentMode = undefined;
    if (rec) {
      rec.onend = rec.onresult = rec.onerror = rec.onspeechstart = rec.onspeechend = null;
      rec.abort();
    }
  }

  private open(Class: RecognitionClass) {
    const rec = new Class();
    rec.lang = this.host.lang();
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = MAX_ALTERNATIVES;
    rec.onspeechstart = () => {
      this.speechHeard = true;
      this.host.onHearing();
    };
    rec.onspeechend = () => this.quiet();
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        if (!result.isFinal) continue;
        this.quiet();
        const alternatives: HeardAlternative[] = [];
        for (let k = 0; k < result.length; k++) {
          const a = result[k]!;
          if (a.transcript.trim()) alternatives.push({ transcript: a.transcript.trim(), confidence: a.confidence });
        }
        if (alternatives.length === 0) continue;
        this.host.onHeard(alternatives);
        // プログラムで聞いているときは、1 つ言い終えたらやめる
        if (this.currentMode === "program") this.stop("finished");
      }
    };
    rec.onerror = (e) => {
      // 何も言わなかった・止めた、は続ける (時間切れまで聞く)
      if (e.error === "no-speech" || e.error === "aborted") return;
      this.status =
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? 5
          : e.error === "audio-capture"
            ? 1
            : e.error === "network" || e.error === "language-not-supported"
              ? 4
              : 6;
      this.stop("error");
    };
    rec.onend = () => {
      if (this.recognition !== rec) return;
      // やめるように言っていないのに止まった (しばらく黙っていたときなど) なら、聞き直す
      if (!this.endCause && this.currentMode) {
        try {
          rec.start();
          return;
        } catch {
          this.endCause = "error";
        }
      }
      this.end();
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch {
      this.status = 6;
      this.endCause = "error";
      this.end();
    }
  }

  private end() {
    const cause = this.endCause ?? "program";
    this.speechHeard = false;
    this.stopWhenQuiet = false;
    window.clearTimeout(this.timer);
    this.recognition = undefined;
    this.currentMode = undefined;
    this.endCause = undefined;
    this.host.onEnd(cause);
  }
}
