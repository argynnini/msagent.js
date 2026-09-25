import type { AcsPlayer } from "./acs/player";
import { speakingAnimation } from "./animations";
import type { Balloon } from "./balloon";
import type { BalloonStyle, Character } from "./character";
import type { Emit } from "./events";
import { paceText } from "./pace";
import type { Task } from "./queue";
import type { Speaker } from "./speak";
import { bookmarkNotifier, isRepeatTag, parseSpeechTags, removeBookmarks, shownText } from "./tags";
import type { SpeakParams } from "./voice";

/** 読み上げが終わってから、吹き出しを閉じるまで (clippy.js と同じ) */
const CLOSE_BALLOON_DELAY_MS = 2000;
/** think() で文を出しておく時間: 1 文字あたりと、最短・最長 (読み終わるくらい) */
const THINK_MS_PER_CHAR = 60;
const THINK_MIN_MS = 1500;
const THINK_MAX_MS = 10000;
/** think() で少しずつ出すときは、出しておく時間のこの割合で出し終える (残りは全文を読む時間) */
const THINK_PACE_RATIO = 0.8;

type Complete = Parameters<Task>[0];

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
  /** 最後にしゃべった文 (\Lst\ で繰り返すため) */
  private lastSpoken: string | undefined;

  constructor(private readonly host: TalkHost) {}

  /** しゃべっている途中か (hold で吹き出しを出したままのとき、考えごとの途中も true) */
  get speaking(): boolean {
    return this.host.speaker.speaking || this.hold || this.thinkTimer !== undefined;
  }

  /**
   * しゃべる (speak の命令の中身)。url があれば、その音声ファイルでしゃべる。
   * 途中で await するので、isStale() が true になっていたら (止められたら)、何もせずに終わる
   */
  async speak(text: string, hold: boolean, url: string | URL | Blob | ArrayBuffer | undefined, complete: Complete, isStale: () => boolean) {
    const { player } = this.host;
    // 音声ファイルでしゃべるときは、先に読み込んでおく
    let audio: AudioBuffer | undefined;
    if (url !== undefined) {
      try {
        audio = await player.audioContext().decodeAudioData(await readAudio(url));
      } catch (e) {
        return complete("failed", `音声ファイルを読み込めません: ${e instanceof Error ? e.message : String(e)}`);
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
    if (isRepeatTag(said)) {
      if (this.lastSpoken === undefined) return complete();
      said = removeBookmarks(this.lastSpoken);
    } else {
      this.lastSpoken = said;
    }
    const params = this.host.speakParams();
    const parts = parseSpeechTags(said, params);
    const shown = shownText(parts);
    const { balloon, emit } = this.host;
    this.begin(complete, hold);
    emit("speakstart", { text: shown, thought: false });
    const style = this.host.balloonStyle();
    balloon.element.lang = this.host.speechLanguage() ?? "";
    if (style.enabled) {
      balloon.setThink(false);
      // 少しずつ出さない (autoPace: false) なら、最初から全文
      balloon.setText(style.autoPace ? "" : shown);
      balloon.show();
    } else {
      balloon.hide();
    }
    const handlers = {
      onProgress: (progress: string) => {
        if (style.enabled && style.autoPace) balloon.setText(progress);
      },
      onBookmark: (id: number) => emit("bookmark", { id }),
      onEnd: () => {
        emit("speakend", { text: shown, thought: false });
        if (this.hold) return;
        this.finish();
      },
    };
    if (audio) this.host.speaker.speakAudio(audio, player.audioContext(), parts, handlers, this.host.voice() ? 1 : 0);
    else this.host.speaker.speak(parts, handlers, params, this.host.voice());
  }

  /**
   * 考えごとの吹き出しに出す (think の命令の中身)。声は出さず、口も動かさない。
   * 読み終わるくらいの時間 (文の長さから決める) が過ぎたら complete を呼ぶ
   */
  think(text: string, complete: Complete) {
    // 吹き出しを使わないキャラクターは、何も出さない (本家と同じ)
    const style = this.host.balloonStyle();
    if (!style.enabled) return complete();
    // 本家と同じく、\Mrk\ (目印) だけを使い、ほかのタグは取り除く
    const parts = parseSpeechTags(text, undefined, true);
    const shown = shownText(parts);
    const { balloon, emit } = this.host;
    const notifyBookmarks = bookmarkNotifier(parts, (id) => emit("bookmark", { id }));
    this.begin(complete, false);
    emit("speakstart", { text: shown, thought: true });
    balloon.setThink(true);
    balloon.show();
    const ms = Math.min(THINK_MAX_MS, Math.max(THINK_MIN_MS, [...shown].length * THINK_MS_PER_CHAR));
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
      this.stopThinkPace = paceText(shown, ms * THINK_PACE_RATIO, (s, count) => {
        balloon.setText(s);
        notifyBookmarks(count);
      });
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
    this.complete = complete;
  }

  /** 読み終えた: 命令を終わらせ、自動で閉じる (autoHide) なら少しして閉じる */
  private finish() {
    this.callComplete();
    if (this.host.balloonStyle().autoHide) {
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
