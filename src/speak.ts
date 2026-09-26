import type { AcsPlayer } from "./acs/player.js";
import { ipaAt, LWV_MOUTH_RATE, type LwvInfo, type LwvWord } from "./lwv.js";
import {
  MORA_MS,
  MOUTH_CLOSED,
  PAUSE_MS,
  mouthForIpa,
  mouthForLevel,
  mouthSteps,
  randomVowelMouth,
  stepsDuration,
  type MouthStep,
} from "./mouth.js";
import { paceText, withTrailingPunctuation } from "./pace.js";
import { bookmarkNotifier, parseSpeechTags, shownText, type Bookmark, type SpeechPart } from "./tags.js";
import { findVoice, pickVoice, type SpeakParams } from "./voice.js";

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

/** 単語の区切りの通知 (boundary) が来ない音声とみなすまでの時間 (過ぎたら、全文を見積もって口を動かし、吹き出しにも全文を出す) */
const BOUNDARY_WAIT_MS = 400;
/** 声を出さないとき、読み上げる部分 1 つにかける最短の時間 */
const SILENT_PART_MIN_MS = 300;
/** 音声ファイルでしゃべるとき、音の大きさを測って口を変える間隔 (ms) */
const LEVEL_TICK_MS = 60;

/** Callbacks for {@link Speaker}. */
export interface SpeakHandlers {
  /** The text spoken so far, to show in the balloon (the whole text at the end). */
  onProgress(shown: string): void;
  /** Speaking finished (also called after `cancel()`). */
  onEnd(): void;
  /** Speech reached a bookmark (`\Mrk=number\` or `<bookmark/>`). */
  onBookmark?(bookmark: Bookmark): void;
}

/** ひらがな・カタカナ・漢字・半角カナを含めば日本語として読む */
const hasJapanese = (text: string) => /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/.test(text); // ひらがな・カタカナ・漢字・半角カナ

/**
 * 吹き出しの文を、.lwv の単語の時刻に合わせて出すための区切り (単語 i を出したときの文)。
 * 文の単語の数が .lwv の単語の数と合わなければ undefined (そのときは音の長さに合わせて少しずつ出す)
 */
function wordSteps(text: string, words: readonly LwvWord[]): { at: number; shown: string }[] | undefined {
  const tokens = text.match(/\S+\s*/g) ?? [];
  if (words.length === 0 || tokens.length !== words.length) return undefined;
  const lead = text.length - text.trimStart().length;
  let shown = text.slice(0, lead);
  return words.map((w, i) => ({ at: w.start, shown: (shown += tokens[i]!).trimEnd() }));
}

/** charIndex から始まる単語の長さ (charLength を教えてくれない音声のため) */
function wordLength(text: string, start: number): number {
  const rest = text.slice(start);
  const end = rest.search(/[\s\u3001\u3002\uff0c\uff0e,.!?\uff01\uff1f]/); // 空白と句読点 (、。，．！？ など)
  return end < 0 ? rest.length : end + 1;
}

/** 1 回の speak() で、部分をまたいで使うもの */
interface Run {
  handlers: SpeakHandlers;
  synth: SpeechSynthesis | undefined;
  lang: string;
  gender: SpeakParams["gender"];
  /** 使う声 (voiceURI か名前。見つからなければ言語・性別から選ぶ) */
  voice?: string | undefined;
}

/**
 * Speaks text with the browser's speech synthesis (Web Speech API) while switching the character's mouth images.
 * Used by `Agent`; use it directly with an {@link AcsPlayer} to build your own UI.
 *
 * Speech synthesis reports only the start, the end and word boundaries, so the mouth is approximated: each word is
 * split into morae and a mouth shape is shown per vowel, re-synchronizing at every boundary. For voices without
 * boundary events, the timing of the whole text is estimated. Without speech synthesis, the mouth moves silently for
 * the estimated time.
 */
export class Speaker {
  private mouthTimer: number | undefined;
  private fallbackTimer: number | undefined;
  /** 間 (\Pau\) や、声を出さないときの部分の長さのタイマー */
  private partTimer: number | undefined;
  /** 吹き出しの文を少しずつ出しているのを止める */
  private stopPace: (() => void) | undefined;
  /** 口の動きの並びを出すたびに増やし、古い並びを止める */
  private mouthToken = 0;
  /** 読み上げ中の発話 (Chrome では参照を持っていないと、途中で GC されてイベントが来なくなることがある) */
  private utterance: SpeechSynthesisUtterance | undefined;
  private run: Run | undefined;
  /** 吹き出しに出す全文 (途中で止めても、吹き出しには全文を残すため) */
  private text = "";
  /** 音声ファイルでしゃべっているときの、再生している音 */
  private source: AudioBufferSourceNode | undefined;

  /** @param player - Returns the player whose mouth to move. */
  constructor(private readonly player: () => AcsPlayer | undefined) {}

  /** Whether speaking is in progress. */
  get speaking(): boolean {
    return this.run !== undefined;
  }

  /**
   * Speaks text, cancelling any speech in progress.
   *
   * @param input - Text (may contain speech output tags such as `\Pau=500\`) or parts from {@link parseSpeechTags}.
   * @param params - Rate and pitch (browser values, normal = 1; see {@link voiceParams}), language and voice.
   *   Without `lang`, Japanese is assumed if the text contains kana or kanji, otherwise English.
   * @param aloud - If `false`, no sound is made: the mouth moves and the text is revealed for the estimated time.
   */
  speak(
    input: string | readonly SpeechPart[],
    handlers: SpeakHandlers,
    params: SpeakParams = { rate: 1, pitch: 1 },
    aloud = true,
  ) {
    const parts = typeof input === "string" ? parseSpeechTags(input, params) : input;
    const spoken = parts.map((p) => (p.kind === "text" ? p.spoken : "")).join("");
    const run = this.begin(parts, {
      handlers,
      synth: !aloud || typeof speechSynthesis === "undefined" ? undefined : speechSynthesis,
      lang: params.lang ?? (hasJapanese(spoken) ? "ja-JP" : "en-US"),
      gender: params.gender,
      voice: params.voice,
    });
    this.speakPart(run, parts, 0, "");
  }

  /**
   * Speaks with a decoded audio file, like the `Url` argument of Microsoft Agent's `Speak`.
   * The mouth follows the audio volume, and the text (`parts`, which may include bookmarks) is revealed over the
   * length of the audio.
   *
   * @param volume - `0` plays no sound but still moves the mouth.
   * @param lwv - Word and phoneme timings from a .lwv file (see {@link readLwv}). If given, the mouth follows the
   *   phonemes (30 times per second, like Microsoft Agent) and the text is revealed word by word.
   */
  speakAudio(
    audio: AudioBuffer,
    context: AudioContext,
    parts: readonly SpeechPart[],
    handlers: SpeakHandlers,
    volume = 1,
    lwv?: LwvInfo,
  ) {
    const run = this.begin(parts, { handlers, synth: undefined, lang: "", gender: undefined });
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

    // 吹き出し: 単語の時刻 (.lwv) か、音の長さに合わせて文字を出し、通り過ぎた目印を知らせる
    const notifyBookmarks = bookmarkNotifier(parts, (bookmark) => run.handlers.onBookmark?.(bookmark));
    const show = (shown: string) => {
      if (this.run !== run) return;
      run.handlers.onProgress(shown);
      notifyBookmarks([...shown].length);
    };
    const words = lwv && wordSteps(this.text, lwv.words);
    if (!words) this.stopPace = paceText(this.text, audio.duration * 1000, show);
    let wordIndex = 0;
    // 口: 音素 (.lwv) があればそこから、無ければ音の大きさ (RMS) で開き方を決める
    const phonemes = lwv?.phonemes.length ? lwv.phonemes : undefined;
    const samples = new Float32Array(analyser.fftSize);
    let mouth: number = MOUTH_CLOSED;
    let startedAt = 0;
    const tick = () => {
      if (this.run !== run) return;
      const t = context.currentTime - startedAt;
      while (words && wordIndex < words.length && words[wordIndex]!.at <= t) show(words[wordIndex++]!.shown);
      if (phonemes) {
        // 表に無い音は、口の形を変えない
        mouth = mouthForIpa(ipaAt(phonemes, t)) ?? mouth;
      } else {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        mouth = mouthForLevel(Math.sqrt(sum / samples.length));
      }
      this.player()?.setMouth(mouth);
      this.mouthTimer = window.setTimeout(tick, phonemes ? 1000 / LWV_MOUTH_RATE : LEVEL_TICK_MS);
    };
    source.onended = () => {
      if (this.run !== run) return;
      notifyBookmarks(Infinity);
      this.finish();
    };
    source.start();
    startedAt = context.currentTime;
    tick();
  }

  /** Stops speaking. Does nothing if not speaking. */
  cancel() {
    if (!this.speaking) return;
    if (this.utterance) {
      this.utterance = undefined;
      speechSynthesis.cancel();
    }
    this.finish();
  }

  /** 前の読み上げをやめて、新しい読み上げを始める */
  private begin(parts: readonly SpeechPart[], run: Run): Run {
    this.cancel();
    this.text = shownText(parts);
    this.run = run;
    run.handlers.onProgress("");
    return run;
  }

  /** i 番目の部分を読む。読み終えたら次へ (shownBefore: それまでに吹き出しに出した文) */
  private speakPart(run: Run, parts: readonly SpeechPart[], i: number, shownBefore: string): void {
    if (this.run !== run) return;
    const part = parts[i];
    if (!part) return this.finish();
    const next = (shown: string): void => this.speakPart(run, parts, i + 1, shown);

    if (part.kind === "bookmark") {
      run.handlers.onBookmark?.({ id: part.id, mark: part.mark });
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
      const total = Math.max(SILENT_PART_MIN_MS, stepsDuration(steps));
      this.stopPace?.();
      if (mapped) progress(part.shown);
      else this.stopPace = paceText(part.spoken, total, progress, { wholeWords: true });
      this.partTimer = window.setTimeout(() => next(after), total);
      return;
    }

    const u = new SpeechSynthesisUtterance(part.spoken);
    u.lang = part.lang ?? run.lang;
    u.rate = part.rate;
    u.pitch = part.pitch;
    u.volume = part.volume;
    // 声を指定していれば、その声 (制御タグで言語・性別を変えた部分は除く)。
    // 指定が無い・見つからなければ、その言語 (と性別) に合う声を選ぶ (無ければブラウザ任せ)
    const voices = run.synth.getVoices();
    const fixed = run.voice && !part.lang && !part.gender ? findVoice(voices, run.voice) : undefined;
    if (fixed) u.lang = fixed.lang;
    const voice = fixed ?? pickVoice(voices, u.lang, part.gender ?? run.gender);
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
      // 言葉の後ろの句読点 (！。など) も一緒に出す (ブラウザが知らせる言葉の範囲には入っていない)
      progress(part.spoken.slice(0, withTrailingPunctuation(part.spoken, end)));
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
    this.stopPace?.();
    for (const t of [this.mouthTimer, this.fallbackTimer, this.partTimer]) window.clearTimeout(t);
    this.mouthTimer = this.fallbackTimer = this.partTimer = this.stopPace = undefined;
    this.player()?.setMouth(undefined);
    run.handlers.onProgress(this.text);
    run.handlers.onEnd();
  }
}
