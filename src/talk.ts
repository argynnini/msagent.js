import type { AcsPlayer } from "./acs/player";
import { speakingAnimation } from "./animations";
import type { Balloon } from "./balloon";
import type { BalloonStyle, Character } from "./character";
import type { Emit } from "./events";
import { audioOutput } from "./audio";
import { readLwv, type LwvInfo } from "./lwv";
import { MORA_MS, mouthSteps, PAUSE_MS, stepsDuration } from "./mouth";
import { paceText } from "./pace";
import type { Task } from "./queue";
import { RequestError } from "./request";
import type { Speaker } from "./speak";
import { bookmarkNotifier, isRepeatTag, parseSpeechTags, plainSpeech, removeBookmarks, shownText, type Bookmark } from "./tags";
import type { SpeakParams } from "./voice";

/** 読み上げが終わってから、吹き出しを閉じるまで (clippy.js と同じ) */
const CLOSE_BALLOON_DELAY_MS = 2000;
/** think() で文を出しておく、最短の時間 (ms) */
const THINK_MIN_MS = 300;

type Complete = Parameters<Task>[0];

/** speak() の中身の設定 */
export interface TalkOptions {
  /** 読み終えても吹き出しを閉じず、close() まで次へ進まない */
  hold?: boolean;
  /** 音声ファイルでしゃべる */
  url?: string | URL | Blob | ArrayBuffer | undefined;
  /** 声に出すか (省略時は agent.voice) */
  voice?: boolean | undefined;
  /** 考えごとの吹き出し (雲形) に出す (think(text, { voice: true })) */
  thought?: boolean;
  /** 読み上げの制御タグを使うか (既定: true)。false なら、タグも文字としてそのまま */
  tags?: boolean;
}

/** しゃべる・考えるために、キャラクター (Agent) から借りるもの */
export interface TalkHost {
  readonly balloon: Balloon;
  readonly speaker: Speaker;
  readonly player: AcsPlayer;
  readonly character: Character;
  emit: Emit;
  /** いま使う吹き出しの見た目と動き */
  balloonStyle(): BalloonStyle;
  /** 読み上げの設定 (速さ・高さ・言語・声の性別) */
  speakParams(): SpeakParams;
  /** 吹き出しの言語 (agent.language から。指定が無ければ undefined) */
  speechLanguage(): string | undefined;
  /** 声に出すか (agent.voice) */
  voice(): boolean;
}

/**
 * 吹き出しでしゃべる・考える (speak / think)。吹き出しの開け閉め、読み上げ、hold、\Lst\ のための発言の記録を受け持つ
 */
export class Talk {
  /** speak(text, true): 読み終えても吹き出しを閉じず、close() まで次へ進まない */
  private hold = false;
  /** しゃべっている命令の complete (読み終えたら・閉じたら呼ぶ) */
  private complete: Complete | undefined;
  private balloonTimer: number | undefined;
  /** think() の文を出しておく時間のタイマー (過ぎたら次の命令へ) */
  private thinkTimer: number | undefined;
  private stopThinkPace: (() => void) | undefined;
  /** balloonVisible = false をしゃべっている途中に言われた (読み終えたらすぐ閉じる) */
  private hideWhenDone = false;
  /** いまの発言を声に出しているか */
  private aloud = false;
  /** 最後にしゃべった文 (\Lst\ で繰り返すため) */
  private lastSpoken: string | undefined;

  constructor(private readonly host: TalkHost) {}

  /** しゃべっている途中か (hold で吹き出しを出したままのとき、考えごとの途中も true) */
  get speaking(): boolean {
    return this.host.speaker.speaking || this.hold || this.thinkTimer !== undefined;
  }

  /** 声に出してしゃべっている途中か (声なしの speak・think は含まない) */
  get speakingAloud(): boolean {
    return this.host.speaker.speaking && this.aloud;
  }

  /**
   * しゃべる (speak の命令の中身)。url があれば、その音声ファイルでしゃべる。thought なら考えごとの吹き出しに出す。
   * 途中で await するので、isStale() が true になっていたら (止められたら)、何もせずに終わる
   */
  async speak(text: string, options: TalkOptions, complete: Complete, isStale: () => boolean) {
    const { player } = this.host;
    const { hold = false, url, thought = false, tags = true } = options;
    // 全キャラクターの声を切っていれば (audioOutput.enabled)、声は出さない。
    // 聞き取り中にユーザーの声が聞こえている間も、声は出さない (吹き出しは出す。本家と同じ)
    const aloud = (options.voice ?? this.host.voice()) && audioOutput.enabled && audioOutput.status !== 3;
    // 音声ファイルでしゃべるときは、先に読み込んでおく (.lwv なら、単語と音素も)
    let audio: AudioBuffer | undefined;
    let lwv: LwvInfo | undefined;
    if (url !== undefined) {
      try {
        const data = await readAudio(url);
        // decodeAudioData は data を使えなくするので、先に読む
        lwv = readLwv(data);
        audio = await player.audioContext().decodeAudioData(data);
      } catch (e) {
        return complete("failed", `音声ファイルを読み込めません: ${e instanceof Error ? e.message : String(e)}`, RequestError.invalidSound);
      }
      if (isStale()) return complete();
    }
    // 口の画像が無いコマ (待機動作の終わりなど) では口が動かないので、Microsoft Agent と同じく、
    // しゃべるとき用のアニメーション (Speaking の状態。多くは RestPose) に切り替えてから
    if (!player.hasMouth) {
      const speaking = speakingAnimation(this.host.character);
      if (speaking) await player.play(speaking, { hold: true });
      if (isStale()) return complete();
    }
    // \Lst\ だけなら、直前の発言を繰り返す (目印は繰り返さない。本家と同じ)
    let said = text;
    // 文が無ければ、.lwv の単語を吹き出しに出す (本家と同じ)
    if (!said.trim() && lwv?.words.length) said = lwv.words.map((w) => w.text).join(" ");
    if (tags && isRepeatTag(said)) {
      if (this.lastSpoken === undefined) return complete();
      said = removeBookmarks(this.lastSpoken);
    } else if (!thought) {
      this.lastSpoken = said;
    }
    const params = this.host.speakParams();
    const parts = tags ? parseSpeechTags(said, params) : plainSpeech(said, params);
    const shown = shownText(parts);
    const { balloon, emit } = this.host;
    this.begin(complete, hold);
    this.aloud = aloud;
    emit("speakstart", { text: shown, thought });
    const style = this.host.balloonStyle();
    balloon.element.lang = this.host.speechLanguage() ?? "";
    if (style.enabled) {
      balloon.setThink(thought);
      // 少しずつ出すなら、全文の入る大きさを先に確保する。出さない (autoPace: false) なら、最初から全文
      balloon.reserve(style.autoPace ? shown : undefined);
      balloon.setText(style.autoPace ? "" : shown);
      balloon.show();
    } else {
      balloon.hide();
    }
    const handlers = {
      onProgress: (progress: string) => {
        if (style.enabled && style.autoPace) balloon.setText(progress);
      },
      onBookmark: (bookmark: Bookmark) => emit("bookmark", bookmark),
      onEnd: () => {
        emit("speakend", { text: shown, thought });
        if (this.hold) return;
        this.finish();
      },
    };
    if (audio) this.host.speaker.speakAudio(audio, player.audioContext(), parts, handlers, aloud ? 1 : 0, lwv);
    else this.host.speaker.speak(parts, handlers, params, aloud);
  }

  /**
   * 考えごとの吹き出しに出す (think の命令の中身)。声は出さず、口も動かさない。
   * 声なしの speak と同じく、キャラクターの声の速さで読んだときの時間をかけて文字を出し、出し終えたら complete を呼ぶ
   */
  think(text: string, complete: Complete, tags = true) {
    // 吹き出しを使わないキャラクターは、何も出さない (本家と同じ)
    const style = this.host.balloonStyle();
    if (!style.enabled) return complete();
    // 本家と同じく、\Mrk\ (目印) だけを使い、ほかのタグは取り除く
    const parts = tags ? parseSpeechTags(text, undefined, true) : plainSpeech(text);
    const shown = shownText(parts);
    const { balloon, emit } = this.host;
    const notifyBookmarks = bookmarkNotifier(parts, (bookmark) => emit("bookmark", bookmark));
    this.begin(complete, false);
    this.aloud = false;
    emit("speakstart", { text: shown, thought: true });
    balloon.setThink(true);
    balloon.reserve(style.autoPace ? shown : undefined);
    balloon.setText(style.autoPace ? "" : shown);
    balloon.show();
    // 声なしの speak と同じ見積もり: 文を拍に分け、キャラクターの声の速さ (本家の Speed) で 1 拍の長さを決める
    const { rate } = this.host.speakParams();
    const ms = Math.max(THINK_MIN_MS, stepsDuration(mouthSteps(shown, MORA_MS / rate, PAUSE_MS / rate)));
    this.thinkTimer = window.setTimeout(() => {
      this.thinkTimer = undefined;
      this.stopThinkPace?.();
      balloon.setText(shown);
      notifyBookmarks(Infinity);
      emit("speakend", { text: shown, thought: true });
      this.finish();
    }, ms);
    // 少しずつ出すときは、出しておく時間に合わせて文字を出していく
    if (style.autoPace) {
      this.stopThinkPace = paceText(
        shown,
        ms,
        (s, count) => {
          balloon.setText(s);
          notifyBookmarks(count);
        },
        { wholeWords: true },
      );
    } else {
      balloon.setText(shown);
      notifyBookmarks(Infinity);
    }
  }

  /** 吹き出しを閉じる (読み上げ・考えごとの途中ならやめる) */
  close() {
    this.hold = false;
    this.host.speaker.cancel();
    if (this.thinkTimer !== undefined) {
      window.clearTimeout(this.thinkTimer);
      this.stopThinkPace?.();
      this.thinkTimer = undefined;
      this.host.emit("speakend", { text: this.host.balloon.text, thought: true });
    }
    this.callComplete();
    window.clearTimeout(this.balloonTimer);
    this.host.balloon.hide();
  }

  /**
   * 吹き出しを出す・閉じる (agent.balloonVisible の代入)。閉じるとき、読み上げ・考えごとの途中なら、終わったらすぐ閉じる
   * (本家と同じく、途中の発言はやめない)。出すときは最後の文をもう一度出し、自動では閉じない
   */
  setBalloonVisible(visible: boolean) {
    window.clearTimeout(this.balloonTimer);
    if (visible) {
      this.hideWhenDone = false;
      if (this.host.balloon.text) this.host.balloon.show();
    } else if (this.host.speaker.speaking || this.thinkTimer !== undefined) {
      this.hideWhenDone = true;
    } else {
      this.close();
    }
  }

  /** いまの発言を終わらせる (stopCurrent): 読み上げ中なら読み終えたら閉じる、hold で出したままなら閉じる */
  stopCurrent() {
    if (this.host.speaker.speaking) this.hold = false;
    else if (this.hold) this.close();
  }

  /** キャラクターをつかんだ: 読み終えて出したままの吹き出しを閉じる (autoHide: false のとき。本家と同じ) */
  dismiss() {
    if (!this.speaking && this.host.balloon.visible) this.host.balloon.hide();
  }

  /** 新しい発言を始める (前の発言の、吹き出しを閉じるタイマーは止める) */
  private begin(complete: Complete, hold: boolean) {
    window.clearTimeout(this.balloonTimer);
    this.hold = hold;
    this.hideWhenDone = false;
    this.complete = complete;
  }

  /** 読み終えた: 命令を終わらせ、自動で閉じる (autoHide) なら少しして閉じる */
  private finish() {
    this.callComplete();
    if (this.hideWhenDone) {
      this.hideWhenDone = false;
      this.host.balloon.hide();
    } else if (this.host.balloonStyle().autoHide) {
      this.balloonTimer = window.setTimeout(() => this.host.balloon.hide(), CLOSE_BALLOON_DELAY_MS);
    }
  }

  private callComplete() {
    const complete = this.complete;
    this.complete = undefined;
    complete?.();
  }
}

/** 音声ファイルの中身を読む (URL なら fetch) */
async function readAudio(source: string | URL | Blob | ArrayBuffer): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source.slice(0);
  if (source instanceof Blob) return source.arrayBuffer();
  const res = await fetch(source);
  if (!res.ok) throw new Error(`${res.status} ${res.url}`);
  return res.arrayBuffer();
}
