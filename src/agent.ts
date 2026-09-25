import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { ActCharacter, isActFile } from "./act/reader";
import { Balloon } from "./balloon";
import { AgentCommands } from "./commands";
import { PopupMenu, type MenuEntry } from "./menu";
import { DEFAULT_BALLOON_STYLE, type BalloonStyle, type Character } from "./character";
import { IdleController, isIdleAnimation } from "./idle";
import { languageTag, type Language } from "./language";
import { Speaker, voiceParams, type SpeakParams } from "./speak";
import { injectStyles } from "./styles";
import { AgentRequest, type RequestType } from "./request";
import { isRepeatTag, parseSpeechTags, removeBookmarks, shownText } from "./tags";

export interface AgentOptions {
  /** キャラクターを置く要素 (既定: document.body) */
  container?: HTMLElement;
  /** 効果音を鳴らすか (既定: true)。ブラウザの制限で、ページが一度クリックされるまでは鳴らない */
  sound?: boolean;
  /** speak() で声に出して読み上げるか (既定: true)。false なら吹き出しと口の動きだけ */
  voice?: boolean;
  /** 何もしていない間、ときどき待機動作 (Idle 系) を再生するか (既定: true) */
  idle?: boolean;
  /** name / description の言語 (BCP 47 の "ja" など、または Windows の言語 ID)。省略時はブラウザの言語 */
  language?: Language | readonly Language[];
  /** 表示の倍率 (既定: 1 = キャラクターファイルのままの大きさ) */
  scale?: number;
  /** 吹き出しの見た目。キャラクターファイルの設定の上に、指定した項目だけを重ねる (agent.balloonStyle と同じ) */
  balloon?: Partial<BalloonStyle>;
  /** キャラクターを右クリックしたときに、メニューを出すか (既定: true。本家の AutoPopupMenu と同じ) */
  autoPopupMenu?: boolean;
}


/** クリックされたときの、ボタンと Shift / Ctrl / Alt キーの状態 (本家の Click の Button / Shift と同じ) */
export interface PointerDetail {
  /** 画面上の位置 (clientX / clientY) */
  x: number;
  y: number;
  button: "left" | "middle" | "right";
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  originalEvent: MouseEvent;
}

/** 出た・消えた原因 (本家の VisibilityCause と同じ考え方): プログラムから / ユーザーの操作 (右クリックのメニューなど) */
export type VisibilityCause = "program" | "user";

/** 最後に動いた原因 (本家の MoveCause と同じ考え方): まだ動いていない / ドラッグ / プログラム / 画面の中に戻した */
export type MoveCause = "none" | "drag" | "moveTo" | "reposition";

/** agent.on() で受け取れるイベントと、その detail */
export interface AgentEventMap {
  /** キャラクターの絵の部分がクリックされた (左・中・右ボタン。ドラッグの後は来ない) */
  click: PointerDetail;
  /** ダブルクリックされた。event.preventDefault() すると、animate() しない */
  dblclick: PointerDetail;
  /** ドラッグで動かし始めた / 動かし終えた (x, y はキャラクターの左上の位置) */
  dragstart: { x: number; y: number };
  dragend: { x: number; y: number };
  /**
   * 別の場所に移った。by: ドラッグ (ユーザー) / moveTo (プログラム) /
   * reposition (ブラウザの窓が小さくなり、画面の中に戻した。本家の「画面の解像度が変わった」と同じ)
   */
  move: { x: number; y: number; by: Exclude<MoveCause, "none"> };
  /** 大きさが変わった (scale / width / height)。width, height は表示の大きさ (px) */
  resize: { width: number; height: number; scale: number };
  /** 出た / 消えた */
  show: { cause: VisibilityCause };
  hide: { cause: VisibilityCause };
  /** 命令 (show / play / speak など) を始めた / 終えた。request.status で結果が分かる */
  requeststart: { request: AgentRequest };
  requestcomplete: { request: AgentRequest };
  /** 吹き出しが出た / 閉じた */
  balloonshow: Record<string, never>;
  balloonhide: Record<string, never>;
  /** 待機状態 (Idling) に入った / 抜けた (次の命令が始まった) */
  idlestart: Record<string, never>;
  idlecomplete: Record<string, never>;
  /** 右クリックのメニューで、commands に足した項目が選ばれた (本家の Command と同じ) */
  command: { name: string };
  /** アニメーションが始まった / 終わった (idle: 待機動作か) */
  animationstart: { name: string; idle: boolean };
  animationend: { name: string; idle: boolean };
  /** しゃべり始めた / しゃべり終えた (途中でやめたときも来る)。text は吹き出しに出す文 (タグを除いたもの)。thought: think() か */
  speakstart: { text: string; thought: boolean };
  speakend: { text: string; thought: boolean };
  /** 読み上げの目印 (\Mrk=番号\) まで来た (本家の Bookmark と同じ) */
  bookmark: { id: number };
}

export type AgentEventListener<K extends keyof AgentEventMap> = (event: CustomEvent<AgentEventMap[K]>) => void;

/** ドラッグとみなすまでの動き (px)。これより小さければクリック */
const DRAG_THRESHOLD = 3;

/** 順番待ちの命令の中身。終わったら complete を呼ぶ (できなかったときは "failed" と理由) */
type Task = (complete: (status?: "complete" | "failed", description?: string) => void, request: AgentRequest) => void;

/** stopAll() で選べる種類 (本家の StopAll と同じ。play には gestureAt、speak には think も含む) */
export type StopType = "play" | "speak" | "move";

const STOP_TYPES: Record<RequestType, StopType | undefined> = {
  play: "play", gestureAt: "play", speak: "speak", think: "speak", moveTo: "move",
  show: undefined, hide: undefined, delay: undefined, wait: undefined, interrupt: undefined,
};

/** キャラクターから見た向き (画面の左が "Right") */
type Direction = "Right" | "Up" | "Left" | "Down";

export interface HideOptions {
  /**
   * true なら、順番待ちを捨てて、すぐに隠れる (clippy.js と同じ)。
   * 省略時 (false) は Microsoft Agent と同じく順番待ちに入り、前の命令が終わってから隠れる
   */
  immediate?: boolean;
}

/** play() の timeout の既定値 (clippy.js と同じ) */
const DEFAULT_TIMEOUT_MS = 5000;
/** 読み上げが終わってから、吹き出しを閉じるまで (clippy.js と同じ) */
const CLOSE_BALLOON_DELAY_MS = 2000;
/** think() で文を出しておく時間: 1 文字あたりと、最短・最長 (読み終わるくらい) */
const THINK_MS_PER_CHAR = 60;
const THINK_MIN_MS = 1500;
const THINK_MAX_MS = 10000;
/** animate() で選ばないもの (待機動作のほかに、登場・退場など) */
const NOT_FOR_ANIMATE = /^(Show|Hide|RestPose)$/i;

/** ACS (Microsoft Agent) か ACT (Office 97 のアシスタント) を、中身から見分けて読み込む */
export function parseCharacter(data: ArrayBuffer): Character {
  return isActFile(data) ? new ActCharacter(data) : new AcsCharacter(data);
}

/** "A|B|C" のように | で区切った候補から、1 つをランダムに選ぶ (本家の Speak / Think と同じ) */
function pickAlternative(text: string): string {
  const alternatives = text.split("|");
  return alternatives[Math.floor(Math.random() * alternatives.length)]!;
}

/** 手前に出すときの z-index (出すたびに増やす) と、いちばん手前のキャラクター */
let zIndexCounter = 1000;
const nextZIndex = () => ++zIndexCounter;
let topmost: Agent | undefined;

/** マウスのイベントから、click / dblclick の detail を作る */
function pointerDetail(e: MouseEvent): PointerDetail {
  const button = e.button === 1 ? "middle" : e.button === 2 ? "right" : "left";
  return { x: e.clientX, y: e.clientY, button, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, originalEvent: e };
}

/** 大文字小文字を問わず、実在するアニメーション名に直す (無ければ undefined) */
function findAnimation(character: Character, name: string): string | undefined {
  if (character.animations.has(name)) return name;
  const lower = name.toLowerCase();
  for (const key of character.animations.keys()) if (key.toLowerCase() === lower) return key;
  return undefined;
}

/**
 * キャラクター 1 体。clippy.js の Agent と同じ使い方ができる。
 * play / speak / moveTo / gestureAt / delay は順番待ちに入り、前のものが終わってから 1 つずつ実行される
 */
export class Agent extends EventTarget {
  /** キャラクターの要素 (div.msagent)。この中に canvas がある */
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly player: AcsPlayer;
  private readonly balloon: Balloon;
  private readonly speaker: Speaker;
  private readonly idle: IdleController;
  private idleEnabled: boolean;
  /** speak() で声に出すか */
  voice: boolean;
  /** name / description の言語 (BCP 47 か Windows の言語 ID)。undefined ならブラウザの言語 */
  language: Language | readonly Language[] | undefined;
  /** 右クリックのメニューに足す項目 (本家の Commands と同じ) */
  readonly commands = new AgentCommands();
  /** キャラクターを右クリックしたときに、メニューを出すか (本家の AutoPopupMenu と同じ) */
  autoPopupMenu: boolean;

  private currentScale = 1;
  /** balloonStyle で指定された項目 (キャラクターファイルの設定の上に重ねる) */
  private balloonOverrides: Partial<BalloonStyle> = {};
  private queue: { request: AgentRequest; task: Task }[] = [];
  private running = false;
  /** いま実行中の命令 */
  private current: AgentRequest | undefined;
  /** 実行中の命令を途中で止めるときに呼ぶもの (delay の待ちなど) */
  private currentAbort: (() => void) | undefined;
  /** 待機状態 (Idling) か */
  private idling = false;
  /** 開いている右クリックのメニュー */
  private menu: PopupMenu | undefined;
  /** 最後に動いた・出た / 消えた原因 (本家の MoveCause / VisibilityCause) */
  private lastMoveCause: MoveCause = "none";
  private lastVisibilityCause: VisibilityCause | "none" = "none";
  /** stop() / hide() で順番待ちを捨てるたびに増やし、捨てたものの complete を無視する */
  private generation = 0;
  private hidden = true;
  /** 登場・退場のアニメーションの途中 (stop() では止めない。本家と同じ) */
  private transition: "show" | "hide" | undefined;
  /** speak(text, true): 読み終えても吹き出しを閉じず、closeBalloon() まで次へ進まない */
  private hold = false;
  private speechComplete: (() => void) | undefined;
  private balloonTimer: number | undefined;
  /** think() の文を出しておく時間のタイマー (過ぎたら次の命令へ) */
  private thinkTimer: number | undefined;
  /** think() の文を少しずつ出すタイマー */
  private thinkPaceTimer: number | undefined;
  /** 最後にしゃべった文 (\Lst\ で繰り返すため) */
  private lastSpoken: string | undefined;
  private destroyed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    readonly character: Character,
    options: AgentOptions = {},
  ) {
    super();
    injectStyles();
    this.element = document.createElement("div");
    this.element.className = "msagent";
    this.element.style.display = "none";
    this.canvas = document.createElement("canvas");
    this.element.append(this.canvas);
    this.player = new AcsPlayer(character, this.canvas);
    this.player.soundEnabled = options.sound ?? true;
    this.voice = options.voice ?? true;
    this.language = options.language;
    this.autoPopupMenu = options.autoPopupMenu ?? true;
    this.balloonOverrides = { ...options.balloon };
    this.balloon = new Balloon(this.element, this.balloonStyle, (visible) =>
      this.emit(visible ? "balloonshow" : "balloonhide", {}),
    );
    this.applyScale(options.scale ?? 1);
    this.speaker = new Speaker(() => this.player);
    (options.container ?? document.body).append(this.element, this.balloon.element);

    this.idle = new IdleController({
      player: () => this.player,
      character: () => this.character,
      busy: () => this.hidden || this.running || this.speaking || this.player.isPaused,
    });
    this.idleEnabled = options.idle ?? true;
    if (this.idleEnabled) this.idle.start();
    let playing: string | undefined;
    this.player.onPlayingChange = (active) => {
      if (active) {
        playing = this.player.currentAnimation;
        const idle = playing !== undefined && isIdleAnimation(character, playing);
        // 命令が無いときに待機動作が始まったら、待機状態に入る
        if (idle && !this.running && !this.idling) {
          this.idling = true;
          this.emit("idlestart", {});
        }
        if (playing) this.emit("animationstart", { name: playing, idle });
      } else {
        if (playing) this.emit("animationend", { name: playing, idle: isIdleAnimation(character, playing) });
        playing = undefined;
        this.idle?.animationEnded();
      }
    };

    this.setupDrag();
    this.listen(this.element, "dblclick", (e) => {
      if (this.emit("dblclick", pointerDetail(e as MouseEvent), true)) this.animate();
    });
    // 中ボタンと右ボタン (contextmenu) も click として知らせる (本家の Click の Button と同じ)。
    // 中ボタンは auxclick が来ないブラウザがあるので、絵の上で押して離したことで見る
    let middleDown = false;
    this.listen(this.element, "pointerdown", (e) => {
      if ((e as PointerEvent).button === 1) middleDown = true;
    });
    this.listen(this.element, "pointerup", (e) => {
      const ev = e as PointerEvent;
      if (ev.button !== 1 || !middleDown) return;
      middleDown = false;
      if (this.hitTest(ev.clientX, ev.clientY)) this.emit("click", pointerDetail(ev));
    });
    this.listen(this.element, "contextmenu", (e) => {
      const ev = e as MouseEvent;
      this.emit("click", pointerDetail(ev));
      if (!this.autoPopupMenu) return;
      ev.preventDefault();
      this.showPopupMenu(ev.clientX, ev.clientY);
    });
    // ブラウザの窓が小さくなったら、画面の中に戻す
    this.listen(window, "resize", () => {
      const before = this.position;
      this.reposition();
      const after = this.position;
      if (!this.hidden && (before.x !== after.x || before.y !== after.y)) this.emit("move", { ...after, by: "reposition" });
    });
    // 最初の操作で音を鳴らせるようにしておく (自動再生の制限)
    const unlock = () => this.player.unlockAudio();
    this.listen(window, "pointerdown", unlock, true);
    this.listen(window, "keydown", unlock, true);
  }

  // --- clippy.js と同じ API ---

  /**
   * 登場する。キャラクターの Showing の状態に割り当てられたアニメーション (多くは Show) を再生する。
   * fast なら、アニメーションなしですぐ出す。Microsoft Agent と同じく順番待ちに入る
   */
  show(fast?: boolean): AgentRequest {
    return this.addToQueue("show", async (complete) => {
      if (!this.hidden) return complete();
      this.hidden = false;
      this.element.style.display = "block";
      if (!this.element.style.left) {
        // clippy.js と同じく、画面の右下寄り (はみ出す分は reposition で戻す)
        this.element.style.left = `${window.innerWidth * 0.8}px`;
        this.element.style.top = `${window.innerHeight * 0.8}px`;
      }
      this.reposition();
      this.resume();
      this.activate();
      this.emit("show", { cause: "program" });
      const name = fast ? undefined : this.stateAnimation("Showing", ["Show"]);
      if (!name) {
        this.drawRestPose();
        return complete();
      }
      this.transition = "show";
      await this.player.play(name);
      this.transition = undefined;
      complete();
    });
  }

  /**
   * 退場する。キャラクターの Hiding の状態に割り当てられたアニメーション (多くは Hide) を再生してから消す。
   * fast なら、アニメーションなしですぐ消す。
   * Microsoft Agent と同じく順番待ちに入り、前の命令が終わってから隠れる。すぐ隠れたいときは { immediate: true }
   */
  hide(fast?: boolean, callback?: () => void, options: HideOptions = {}): AgentRequest {
    return this.queueHide(fast, callback, options, "program");
  }

  /** hide() の中身。cause: 誰が隠したか (右クリックのメニューなら "user") */
  private queueHide(fast: boolean | undefined, callback: (() => void) | undefined, options: HideOptions, cause: VisibilityCause) {
    const task: Task = async (complete) => {
      if (this.hidden) {
        callback?.();
        return complete();
      }
      this.closeBalloon();
      const name = fast ? undefined : this.stateAnimation("Hiding", ["Hide"]);
      if (name) {
        this.transition = "hide";
        await this.player.play(name);
        this.transition = undefined;
      }
      this.hidden = true;
      this.player.stop();
      this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.element.style.display = "none";
      this.balloon.hide();
      this.emit("hide", { cause });
      callback?.();
      complete();
    };
    if (options.immediate) {
      // clippy.js と同じ: いまの動き (登場・退場の途中でも) と順番待ちを捨てて、すぐ隠れる
      this.transition = undefined;
      this.clearQueue();
      this.closeBalloon();
    }
    return this.addToQueue("hide", task);
  }

  /**
   * アニメーションを再生する。timeout (ms、既定 5000。0 なら無制限) を過ぎても終わらなければ、終了分岐で自然に終わらせる。
   * 終わったら callback。キャラクターに無いアニメーションなら false。
   * 最後の姿勢 (指す・見るなど) は、次のアニメーションまで保ち、戻りの動きはその前に再生する
   */
  play(animation: string, timeout = DEFAULT_TIMEOUT_MS, callback?: () => void): AgentRequest | false {
    const name = findAnimation(this.character, animation);
    if (!name) return false;
    return this.addToQueue("play", (complete) => this.runPlay(name, timeout, callback, complete));
  }

  /** play() の中身 (順番が来たとき)。隠れている間は描かずに、すぐ終わったことにする (本家は見えないまま再生する) */
  private runPlay(name: string, timeout: number, callback: (() => void) | undefined, complete: () => void) {
    if (this.hidden) {
      callback?.();
      return complete();
    }
    const timer = timeout
      ? window.setTimeout(() => {
          if (this.player.currentAnimation === name) void this.player.release();
        }, timeout)
      : undefined;
    // Microsoft Agent と同じく、戻りの動きは次のアニメーションの前にする (指した姿勢のまましゃべれる)
    void this.player.play(name, { hold: true }).then(() => {
      window.clearTimeout(timer);
      callback?.();
      complete();
    });
  }

  /** 待機動作以外から、アニメーションを 1 つ選んで再生する */
  animate(): AgentRequest | false {
    const transitions = new Set([...this.character.stateAnimations("Showing"), ...this.character.stateAnimations("Hiding")]);
    const names = this.animations().filter(
      (n) => !isIdleAnimation(this.character, n) && !NOT_FOR_ANIMATE.test(n) && !transitions.has(n),
    );
    const name = names[Math.floor(Math.random() * names.length)];
    return name !== undefined && this.play(name);
  }

  /** アニメーション名の一覧 */
  animations(): string[] {
    return [...this.character.animations.keys()];
  }

  hasAnimation(name: string): boolean {
    return findAnimation(this.character, name) !== undefined;
  }

  /**
   * 吹き出しでしゃべる (声に出すのは voice が true のとき)。
   * hold なら、読み終えても吹き出しを閉じず、closeBalloon() まで次の命令に進まない
   */
  speak(text: string, hold?: boolean): AgentRequest {
    text = pickAlternative(text);
    return this.addToQueue("speak", async (complete) => {
      // 隠れている間は、吹き出しも声も出せない (本家も隠れたキャラクターは音を出せず、失敗になる)
      if (this.hidden) return complete("failed", "キャラクターが隠れています");
      // 口の画像が無いコマ (待機動作の終わりなど) では口が動かないので、Microsoft Agent と同じく、
      // しゃべるとき用のアニメーション (Speaking の状態。多くは RestPose) に切り替えてから
      if (!this.player.hasMouth) {
        const speaking = this.speakingAnimation();
        const gen = this.generation;
        if (speaking) await this.player.play(speaking, { hold: true });
        if (gen !== this.generation) return complete(); // 切り替えの間に stop() された
      }
      // \Lst\ だけなら、直前の発言を繰り返す (目印は繰り返さない。本家と同じ)
      let said = text;
      if (isRepeatTag(said)) {
        if (this.lastSpoken === undefined) return complete();
        said = removeBookmarks(this.lastSpoken);
      } else {
        this.lastSpoken = said;
      }
      const params = this.speakParams();
      const parts = parseSpeechTags(said, params);
      const shown = shownText(parts);
      window.clearTimeout(this.balloonTimer);
      this.hold = !!hold;
      this.speechComplete = complete;
      this.emit("speakstart", { text: shown, thought: false });
      const style = this.balloonStyle;
      this.balloon.element.lang = this.speechLanguage ?? "";
      if (style.enabled) {
        this.balloon.setThink(false);
        // 少しずつ出さない (autoPace: false) なら、最初から全文
        this.balloon.setText(style.autoPace ? "" : shown);
        this.balloon.show();
      } else {
        this.balloon.hide();
      }
      this.speaker.speak(
        parts,
        {
          onProgress: (progress) => {
            if (style.enabled && style.autoPace) this.balloon.setText(progress);
          },
          onBookmark: (id) => this.emit("bookmark", { id }),
          onEnd: () => {
            this.emit("speakend", { text: shown, thought: false });
            if (this.hold) return;
            this.completeSpeech();
            this.scheduleBalloonHide();
          },
        },
        params,
        this.voice,
      );
    });
  }

  /**
   * 考えごとの吹き出し (雲形) に文を出す (本家の Think と同じ)。声は出さず、口も動かさない。
   * 読み終わるくらいの時間 (文の長さから決める) が過ぎたら次の命令に進み、少しして吹き出しを閉じる
   */
  think(text: string): AgentRequest {
    text = pickAlternative(text);
    return this.addToQueue("think", (complete) => {
      // 隠れている間と、吹き出しを使わないキャラクターは、何も出さない (本家と同じ)
      const style = this.balloonStyle;
      if (this.hidden) return complete("failed", "キャラクターが隠れています");
      if (!style.enabled) return complete();
      // 本家と同じく、\Mrk\ (目印) だけを使い、ほかのタグは取り除く
      const parts = parseSpeechTags(text, undefined, true);
      const shownAll = shownText(parts);
      // 目印の位置 (その前までの文字数)
      const bookmarks: { at: number; id: number }[] = [];
      let offset = 0;
      for (const p of parts) {
        if (p.kind === "text") offset += [...p.shown].length;
        else if (p.kind === "bookmark") bookmarks.push({ at: offset, id: p.id });
      }
      const fireBookmarks = (upTo: number) => {
        while (bookmarks.length > 0 && bookmarks[0]!.at <= upTo) this.emit("bookmark", { id: bookmarks.shift()!.id });
      };
      window.clearTimeout(this.balloonTimer);
      this.hold = false;
      this.speechComplete = complete;
      this.emit("speakstart", { text: shownAll, thought: true });
      this.balloon.setThink(true);
      const chars = [...shownAll];
      const ms = Math.min(THINK_MAX_MS, Math.max(THINK_MIN_MS, chars.length * THINK_MS_PER_CHAR));
      // 少しずつ出すときは、出しておく時間に合わせて文字を出していく
      let shown = style.autoPace ? 0 : chars.length;
      this.balloon.setText(chars.slice(0, shown).join(""));
      this.balloon.show();
      fireBookmarks(shown);
      const started = performance.now();
      const pace = () => {
        if (this.thinkTimer === undefined) return;
        shown = Math.min(chars.length, Math.ceil((chars.length * (performance.now() - started)) / (ms * 0.8)));
        this.balloon.setText(chars.slice(0, shown).join(""));
        fireBookmarks(shown);
        if (shown < chars.length) this.thinkPaceTimer = window.setTimeout(pace, 60);
      };
      this.thinkTimer = window.setTimeout(() => {
        this.thinkTimer = undefined;
        window.clearTimeout(this.thinkPaceTimer);
        this.balloon.setText(shownAll);
        fireBookmarks(Infinity);
        this.emit("speakend", { text: shownAll, thought: true });
        this.completeSpeech();
        this.scheduleBalloonHide();
      }, ms);
      if (shown < chars.length) pace();
    });
  }

  /** 吹き出しを閉じる (読み上げ中ならやめる) */
  closeBalloon(): void {
    this.hold = false;
    this.speaker.cancel();
    if (this.thinkTimer !== undefined) {
      window.clearTimeout(this.thinkTimer);
      window.clearTimeout(this.thinkPaceTimer);
      this.thinkTimer = undefined;
      this.emit("speakend", { text: this.balloon.text, thought: true });
    }
    this.completeSpeech();
    window.clearTimeout(this.balloonTimer);
    this.balloon.hide();
  }

  /**
   * (x, y) の方を指す。キャラクターの Gesturing〜 の状態に割り当てられたアニメーション
   * (無ければ Gesture〜、Look〜) を再生する。向きは順番が来たときの位置で決める。指す動きが 1 つも無ければ false
   */
  gestureAt(x: number, y: number): AgentRequest | false {
    const directions: Direction[] = ["Right", "Up", "Left", "Down"];
    if (!directions.some((d) => this.gestureAnimation(d))) return false;
    return this.addToQueue("gestureAt", (complete) => {
      const name = this.gestureAnimation(this.direction(x, y));
      if (!name) return complete("failed", "その向きの動きがありません");
      this.runPlay(name, DEFAULT_TIMEOUT_MS, undefined, complete);
    });
  }

  private gestureAnimation(d: Direction): string | undefined {
    return this.stateAnimation(`Gesturing${d}`, [`Gesture${d}`, `Look${d}`]);
  }

  /**
   * (x, y) へ移動する。Move〜 のアニメーションがあれば、Microsoft Agent と同じく
   * 移動前の動き → 最後のコマのまま移動 → 移動後の動き (戻りアニメか終了分岐) の順にする。duration が 0 なら、すぐ移る
   */
  moveTo(x: number, y: number, duration = 1000): AgentRequest {
    return this.addToQueue("moveTo", async (complete, request) => {
      // 隠れている間は、アニメーションなしですぐ移る (本家と同じ)
      if (duration === 0 || this.hidden) {
        this.setPosition(x, y);
        this.emit("move", { ...this.position, by: "moveTo" });
        return complete();
      }
      const d = this.direction(x, y);
      const name = this.stateAnimation(`Moving${d}`, [`Move${d}`]);
      if (name) await this.player.play(name, { hold: true });
      await this.slide(x, y, duration, request);
      this.emit("move", { ...this.position, by: "moveTo" });
      if (name) await this.player.playReturn();
      complete();
    });
  }

  /** 次の命令まで、time (ms、既定 250) 待つ */
  delay(time = 250): AgentRequest {
    return this.addToQueue("delay", (complete) => {
      const timer = window.setTimeout(() => complete(), time);
      this.currentAbort = () => {
        window.clearTimeout(timer);
        complete();
      };
    });
  }

  /**
   * 別のキャラクターの命令が終わるまで、このキャラクターの順番待ちを止める (本家の Wait と同じ)。
   * 2 体の掛け合いで、相手がしゃべり終えてから、こちらがしゃべるときに使う
   *
   * ```js
   * const q = genie.speak("なぜニワトリは道を渡ったの？");
   * robby.wait(q);
   * robby.speak("わからないなあ");
   * ```
   */
  wait(request: AgentRequest): AgentRequest {
    return this.addToQueue("wait", (complete) => {
      if (request.done) return complete();
      void request.then(() => complete());
      this.currentAbort = () => complete();
    });
  }

  /**
   * 順番が来たら、別のキャラクターの命令を止める (本家の Interrupt と同じ)。
   * その命令が実行中なら終わらせて相手の次の命令へ進め、順番待ちなら取り除く。相手の順番待ちは捨てない
   */
  interrupt(request: AgentRequest): AgentRequest {
    return this.addToQueue("interrupt", (complete) => {
      if (request.agent === this) return complete("failed", "自分の命令は止められません (stop を使う)");
      request.agent.stop(request);
      complete();
    });
  }

  /** いまのアニメーションを、終了分岐で自然に終わらせる (しゃべっている途中なら、読み終えたら吹き出しを閉じる) */
  stopCurrent(): void {
    void this.player.release();
    if (this.speaker.speaking) this.hold = false;
    else if (this.hold) this.closeBalloon();
  }

  /**
   * 順番待ちを全部捨て、いまのアニメーションを終わらせ、吹き出しを閉じる。
   * 登場・退場のアニメーションの途中なら、それは最後まで再生する (本家と同じ)。
   * request を渡すと、その命令だけを止める (実行中なら終わらせて次へ、順番待ちなら取り除く)
   */
  stop(request?: AgentRequest): void {
    if (request) return this.stopRequest(request);
    if (this.transition) {
      this.dropQueued(() => true);
      this.closeBalloon();
      return;
    }
    this.clearQueue();
    void this.player.release();
    this.closeBalloon();
  }

  /**
   * 命令を種類ごとに止める (本家の StopAll と同じ)。types: "play" (play / gestureAt) / "speak" (speak / think) / "move" (moveTo)。
   * 省略すると、登場・退場の途中も含めて、全部止める
   */
  stopAll(types?: StopType | readonly StopType[]): void {
    if (types === undefined) {
      this.transition = undefined;
      this.stop();
      return;
    }
    const wanted = new Set(Array.isArray(types) ? types : [types as StopType]);
    const matches = (r: AgentRequest) => {
      const t = STOP_TYPES[r.type];
      return t !== undefined && wanted.has(t);
    };
    this.dropQueued(matches);
    if (this.current && matches(this.current)) this.interruptCurrent();
  }

  /** アニメーションを一時停止する */
  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.resume();
  }

  /** キャラクターと吹き出しを、画面の中に収める */
  reposition(): void {
    if (this.element.style.display === "none") return;
    const r = this.element.getBoundingClientRect();
    this.setPosition(r.left, r.top);
  }

  // --- msagent.js で足したもの ---

  /**
   * 表示の倍率 (1 = キャラクターファイルのままの大きさ)。変えても、足もと (下端の真ん中) の位置は変わらない。
   * 拡大するときは、ドット絵がぼけないように、ぼかさずに引き伸ばす
   */
  get scale(): number {
    return this.currentScale;
  }

  set scale(value: number) {
    if (!(value > 0) || value === this.currentScale) return;
    const before = this.element.getBoundingClientRect();
    this.applyScale(value);
    if (this.element.style.display !== "none" && before.width > 0) {
      // 足もとをそろえる
      this.setPosition(before.left + before.width / 2 - this.width / 2, before.bottom - this.height);
    }
    this.emit("resize", { width: this.width, height: this.height, scale: value });
  }

  /**
   * 吹き出しの見た目 (いま使われているもの。キャラクターファイルの設定 + 指定した項目)。
   * 代入すると、キャラクターファイルの設定の上に、指定した項目だけを重ねる。undefined や {} でファイルの設定に戻す。
   *
   * ```js
   * agent.balloonStyle = { background: "#222", foreground: "#fff", fontSize: 16 };
   * agent.balloonStyle = { ...agent.balloonStyle, border: "red" }; // 今の見た目に足す
   * ```
   */
  get balloonStyle(): BalloonStyle {
    const defined = Object.fromEntries(Object.entries(this.balloonOverrides).filter(([, v]) => v !== undefined));
    return { ...DEFAULT_BALLOON_STYLE, ...this.character.balloon, ...defined };
  }

  set balloonStyle(style: Partial<BalloonStyle> | undefined) {
    this.balloonOverrides = { ...style };
    this.balloon.setStyle(this.balloonStyle);
  }

  /** 表示の幅 (px)。代入すると、縦横の比を保ったまま大きさを変える (本家の Width と同じ) */
  get width(): number {
    return Math.round(this.character.width * this.currentScale);
  }

  set width(px: number) {
    this.scale = px / this.character.width;
  }

  /** 表示の高さ (px)。代入すると、縦横の比を保ったまま大きさを変える (本家の Height と同じ) */
  get height(): number {
    return Math.round(this.character.height * this.currentScale);
  }

  set height(px: number) {
    this.scale = px / this.character.height;
  }

  /** 名前 (language の言語。省略時はブラウザの言語) */
  get name(): string | undefined {
    return this.character.getName(this.language);
  }

  /** 紹介文 (language の言語。省略時はブラウザの言語) */
  get description(): string | undefined {
    return this.character.getDescription(this.language);
  }

  /** しゃべっている途中か (speak(text, true) で吹き出しを出したままのときも true) */
  get speaking(): boolean {
    return this.speaker.speaking || this.hold || this.thinkTimer !== undefined;
  }

  /** イベントを受け取る (addEventListener と同じ。detail に中身が入る) */
  on<K extends keyof AgentEventMap>(type: K, listener: AgentEventListener<K>, options?: AddEventListenerOptions): this {
    this.addEventListener(type, listener as EventListener, options);
    return this;
  }

  off<K extends keyof AgentEventMap>(type: K, listener: AgentEventListener<K>): this {
    this.removeEventListener(type, listener as EventListener);
    return this;
  }

  get sound(): boolean {
    return this.player.soundEnabled;
  }

  set sound(on: boolean) {
    this.player.soundEnabled = on;
  }

  /** 画面上の位置 (clientX / clientY) に、キャラクターの絵があるか (透明な部分なら false) */
  hitTest(clientX: number, clientY: number): boolean {
    return this.player.hitTest(clientX, clientY);
  }

  /** 見えているか (本家の Visible と同じ。読むだけ。出す・隠すは show() / hide()) */
  get visible(): boolean {
    return !this.hidden;
  }

  /** 左上の位置 (px、画面の左上から。本家の Left / Top と同じ)。代入すると、アニメーションなしですぐ移る */
  get left(): number {
    return this.position.x;
  }

  set left(x: number) {
    this.setPosition(x, this.position.y);
    this.emit("move", { ...this.position, by: "moveTo" });
  }

  get top(): number {
    return this.position.y;
  }

  set top(y: number) {
    this.setPosition(this.position.x, y);
    this.emit("move", { ...this.position, by: "moveTo" });
  }

  /** 最後に動いた原因 (本家の MoveCause と同じ) */
  get moveCause(): MoveCause {
    return this.lastMoveCause;
  }

  /** 最後に出た・消えた原因 (本家の VisibilityCause と同じ。まだ一度も出ていなければ "none") */
  get visibilityCause(): VisibilityCause | "none" {
    return this.lastVisibilityCause;
  }

  /** 待機動作 (Idle 系) を自動で再生するか (本家の IdleOn と同じ)。false にすると、待機状態を自分で扱える */
  get idleOn(): boolean {
    return this.idleEnabled;
  }

  set idleOn(on: boolean) {
    if (on === this.idleEnabled) return;
    this.idleEnabled = on;
    if (on) this.idle.start();
    else {
      this.idle.stop();
      void this.idle.interrupt();
    }
  }

  /** 吹き出しが出ているか (本家の Balloon.Visible と同じ) */
  get balloonVisible(): boolean {
    return this.balloon.visible;
  }

  /** 作者が入れたおまけの文字 (本家の ExtraData。language の言語) */
  get extraData(): string | undefined {
    return this.character.getExtraData(this.language);
  }

  /** キャラクターファイルの版 (本家の Version) */
  get version(): string | undefined {
    return this.character.version;
  }

  /** キャラクターの GUID (本家の GUID) */
  get guid(): string | undefined {
    return this.character.guid;
  }

  /** キャラクターファイルのままの大きさ (本家の OriginalWidth / OriginalHeight) */
  get originalWidth(): number {
    return this.character.width;
  }

  get originalHeight(): number {
    return this.character.height;
  }

  /** 読み上げの速さ (語/分) と高さ (Hz)。キャラクターファイルの設定 (本家の Speed / Pitch。読むだけ) */
  get speed(): number | undefined {
    return this.character.voice.speed;
  }

  get pitch(): number | undefined {
    return this.character.voice.pitch;
  }

  /** 効果音を鳴らすか (本家の SoundEffectsOn。sound と同じ) */
  get soundEffectsOn(): boolean {
    return this.sound;
  }

  set soundEffectsOn(on: boolean) {
    this.sound = on;
  }

  /**
   * いちばん手前に出す (本家の Activate と同じ。複数のキャラクターがいるとき)。
   * キャラクターを表示したとき・クリックやドラッグしたときも、自動で手前に出る。隠れている間はできず、false を返す
   */
  activate(): boolean {
    if (this.hidden) return false;
    const z = String(nextZIndex());
    this.element.style.zIndex = z;
    this.balloon.element.style.zIndex = z;
    topmost = this;
    return true;
  }

  /** いちばん手前にいるか (本家の Active と同じ考え方) */
  get active(): boolean {
    return topmost === this && !this.hidden;
  }

  /**
   * 右クリックのメニューを、画面上の (x, y) に出す (本家の ShowPopupMenu と同じ)。
   * commands に足した項目と、「隠す」が並ぶ。隠れている間は出せず、false を返す
   */
  showPopupMenu(x: number, y: number): boolean {
    if (this.hidden || this.destroyed) return false;
    const entries: MenuEntry[] = [];
    if (this.commands.visible) {
      for (const c of this.commands.list()) {
        if (!c.visible) continue;
        entries.push({
          kind: "item",
          caption: c.caption,
          enabled: c.enabled,
          bold: c.name === this.commands.defaultCommand,
          onSelect: () => this.emit("command", { name: c.name }),
        });
      }
    }
    if (entries.length > 0) entries.push({ kind: "separator" });
    // 本家と同じく、キャラクターを隠す項目を足す (ユーザーが隠したので、hide の cause は "user")
    entries.push({
      kind: "item",
      caption: this.isJapanese ? "隠す(&H)" : "&Hide",
      enabled: true,
      onSelect: () => void this.queueHide(false, undefined, { immediate: true }, "user"),
    });
    this.menu = new PopupMenu(entries, x, y);
    return true;
  }

  /** メニューなどの文言を日本語にするか (agent.language、無ければブラウザの言語) */
  private get isJapanese(): boolean {
    const lang = this.speechLanguage ?? (typeof navigator === "undefined" ? "en" : navigator.language);
    return lang.toLowerCase().startsWith("ja");
  }

  /** 後片付け: 再生・読み上げ・待機動作をやめ、要素を取り除く */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hidden = true;
    this.stop();
    this.idle?.stop();
    this.player.stop();
    this.player.onPlayingChange = undefined;
    this.menu?.close();
    if (topmost === this) topmost = undefined;
    for (const cleanup of this.cleanups) cleanup();
    this.element.remove();
    this.balloon.element.remove();
  }

  // --- 内部 ---

  private applyScale(scale: number) {
    this.currentScale = scale;
    this.canvas.style.width = `${this.character.width * scale}px`;
    this.canvas.style.height = `${this.character.height * scale}px`;
    // 拡大はドット絵のまま、縮小はなめらかに
    this.canvas.style.imageRendering = scale > 1 ? "pixelated" : "auto";
    this.balloon.reposition();
  }

  /** イベントを出す。cancelable で preventDefault() されたら false */
  private emit<K extends keyof AgentEventMap>(type: K, detail: AgentEventMap[K], cancelable = false): boolean {
    // 最後に動いた・出た / 消えた原因を覚えておく (moveCause / visibilityCause)
    if (type === "move") this.lastMoveCause = (detail as AgentEventMap["move"]).by;
    if (type === "show" || type === "hide") this.lastVisibilityCause = (detail as AgentEventMap["show"]).cause;
    return this.dispatchEvent(new CustomEvent(type, { detail, cancelable }));
  }

  /** キャラクターの左上の位置 (隠れている間は、画面上の大きさが無いので、指定された位置) */
  private get position(): { x: number; y: number } {
    if (this.element.style.display === "none") {
      return { x: parseFloat(this.element.style.left) || 0, y: parseFloat(this.element.style.top) || 0 };
    }
    const r = this.element.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  /** 命令を順番待ちに入れる。前の命令が終わっていれば、すぐ始める */
  private addToQueue(type: RequestType, task: Task): AgentRequest {
    const request = new AgentRequest(type, this);
    if (this.destroyed) {
      this.settle(request, "failed", "キャラクターは片付けられています");
      return request;
    }
    this.queue.push({ request, task });
    if (!this.running) void this.next();
    return request;
  }

  private async next() {
    const item = this.queue.shift();
    if (!item) {
      this.running = false;
      this.current = undefined;
      return;
    }
    const { request, task } = item;
    this.running = true;
    this.current = request;
    this.currentAbort = undefined;
    const gen = this.generation;
    // 命令が来たので、待機状態を抜ける。待機動作の途中なら、終了分岐で自然に終わらせてから
    if (this.idling) {
      this.idling = false;
      this.emit("idlecomplete", {});
    }
    this.idle?.userActivity();
    await this.idle?.interrupt();
    if (gen !== this.generation || request.done) return;
    // 待機動作を終わらせている間に止められた命令は、始めずに次へ
    if (request.interruptRequested) {
      this.settle(request, "interrupted");
      this.current = undefined;
      return void this.next();
    }
    request.start();
    this.emit("requeststart", { request });
    let done = false;
    task((status = "complete", description) => {
      if (done) return;
      done = true;
      this.settle(request, request.interruptRequested ? "interrupted" : status, description);
      if (gen !== this.generation || this.current !== request) return;
      this.current = undefined;
      this.currentAbort = undefined;
      void this.next();
    }, request);
  }

  /** 命令を終わらせ、requestcomplete を出す (すでに終わっていれば何もしない) */
  private settle(request: AgentRequest, status: "complete" | "failed" | "interrupted", description = "") {
    if (request.settle(status, description)) this.emit("requestcomplete", { request });
  }

  /** 順番待ちを全部捨てる (実行中の命令も、止められたことにする) */
  private clearQueue() {
    this.dropQueued(() => true);
    if (this.current) this.settle(this.current, "interrupted");
    this.current = undefined;
    this.currentAbort = undefined;
    this.generation++;
    this.running = false;
  }

  /** 順番待ち (まだ始まっていないもの) から、条件に合う命令を取り除く */
  private dropQueued(matches: (request: AgentRequest) => boolean) {
    const kept: typeof this.queue = [];
    for (const item of this.queue) {
      if (matches(item.request)) this.settle(item.request, "interrupted");
      else kept.push(item);
    }
    this.queue = kept;
  }

  /** 命令を 1 つだけ止める: 実行中なら終わらせて次へ、順番待ちなら取り除く */
  private stopRequest(request: AgentRequest) {
    if (request.agent !== this) return request.agent.stop(request);
    if (request.done) return;
    if (this.current === request) this.interruptCurrent();
    else this.dropQueued((r) => r === request);
  }

  /**
   * 実行中の命令を終わらせて、次の命令へ進める (本家の Interrupt と同じ。順番待ちは捨てない)。
   * アニメーションは終了分岐で自然に終わらせ、しゃべり・考えごとは途中でやめ、待ちはすぐやめる
   */
  private interruptCurrent() {
    const request = this.current;
    if (!request) return;
    request.interruptRequested = true;
    void this.player.release();
    if (this.speaking) this.closeBalloon();
    this.currentAbort?.();
  }

  /** 読み終えた後: 自動で閉じる (autoHide) なら少しして閉じる。そうでなければ、次の speak / think などまで出したまま */
  private scheduleBalloonHide() {
    if (this.balloonStyle.autoHide) {
      this.balloonTimer = window.setTimeout(() => this.balloon.hide(), CLOSE_BALLOON_DELAY_MS);
    }
  }

  private completeSpeech() {
    const complete = this.speechComplete;
    this.speechComplete = undefined;
    complete?.();
  }

  /**
   * 状態 (Showing / MovingLeft など) に割り当てられたアニメーションから 1 つ選ぶ (複数あればランダム。本家と同じ)。
   * 割り当てが無ければ、名前の候補から実在するもの
   */
  private stateAnimation(state: string, fallbacks: string[]): string | undefined {
    const assigned = this.character.stateAnimations(state).filter((n) => this.character.animations.has(n));
    if (assigned.length > 0) return assigned[Math.floor(Math.random() * assigned.length)];
    for (const name of fallbacks) {
      const found = findAnimation(this.character, name);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * 読み上げの設定: 速さ・高さと声の性別はキャラクターの設定から。言語は agent.language を指定していればそれ
   * (本家の LanguageID と同じ)、無ければ文から推測する
   */
  private speakParams(): SpeakParams {
    const lang = this.speechLanguage;
    return { ...voiceParams(this.character.voice), gender: this.character.voice.gender, ...(lang ? { lang } : {}) };
  }

  /** agent.language から決めた読み上げ・吹き出しの言語 (BCP 47)。指定が無ければ undefined */
  private get speechLanguage(): string | undefined {
    const first = Array.isArray(this.language) ? this.language[0] : this.language;
    if (first === undefined) return undefined;
    return typeof first === "number" ? languageTag(first) : first;
  }

  /** しゃべるとき用のアニメーション (Speaking の状態、無ければ RestPose)。口の画像があるものだけ */
  private speakingAnimation(): string | undefined {
    const candidates = [...this.character.stateAnimations("Speaking"), "RestPose"];
    return candidates
      .map((n) => findAnimation(this.character, n))
      .find((n) => n !== undefined && this.character.animations.get(n)!.frames.some((f) => f.overlays.length > 0));
  }

  /** 止まっているときの絵 (RestPose、無ければ登場のアニメーションの最後のコマ) を描く */
  private drawRestPose() {
    const rest = this.character.animations.get(findAnimation(this.character, "RestPose") ?? "");
    const show = this.character.animations.get(this.stateAnimation("Showing", ["Show"]) ?? "");
    const frame = rest?.frames[0] ?? show?.frames.at(-1) ?? this.character.animations.values().next().value?.frames[0];
    if (frame) this.player.draw(frame);
  }

  /**
   * (x, y) がキャラクターから見てどちらか (clippy.js と同じ判定)。
   * キャラクターの向きで数えるので、画面の左が "Right" になる
   */
  private direction(x: number, y: number): Direction {
    const r = this.element.getBoundingClientRect();
    const a = r.top + r.height / 2 - y;
    const b = r.left + r.width / 2 - x;
    const deg = Math.round((180 * Math.atan2(a, b)) / Math.PI);
    if (deg >= -45 && deg < 45) return "Right";
    if (deg >= 45 && deg < 135) return "Up";
    if (deg >= -135 && deg < -45) return "Down";
    return "Left";
  }

  /** 画面からはみ出さないように置く */
  private setPosition(x: number, y: number) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    this.element.style.left = `${Math.max(0, Math.min(x, vw - w))}px`;
    this.element.style.top = `${Math.max(0, Math.min(y, vh - h))}px`;
    this.balloon.reposition();
  }

  /** duration ms かけて (x, y) へ動かす。request が止められたら、その場で止まる */
  private slide(x: number, y: number, duration: number, request?: AgentRequest): Promise<void> {
    const r = this.element.getBoundingClientRect();
    const start = performance.now();
    return new Promise((resolve) => {
      const frame = (now: number) => {
        if (request?.interruptRequested) return resolve();
        const t = Math.min(1, (now - start) / duration);
        this.setPosition(r.left + (x - r.left) * t, r.top + (y - r.top) * t);
        if (t < 1 && !this.destroyed) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /**
   * 透明な部分は押せない (下のページに通す) ようにし、絵の部分だけドラッグで動かせるようにする。
   * 要素はふだん pointer-events: none で、ポインターが絵の上にあるときだけ .msagent-hit で押せるようにする。
   * タッチは押すまで位置が分からないので、押した時点で絵の上なら、そのままドラッグを始める
   */
  private setupDrag() {
    /** つかんだ位置 (キャラクターの左上から) と、つかんだ画面上の位置 */
    let grab: { dx: number; dy: number; x: number; y: number } | undefined;
    let dragging = false;
    /** ドラッグの後に来る click は、クリックとして扱わない */
    let suppressClick = false;
    const setHit = (hit: boolean) => this.element.classList.toggle("msagent-hit", hit);
    this.listen(
      document,
      "pointermove",
      (e) => {
        const ev = e as PointerEvent;
        if (!grab) return void setHit(this.hitTest(ev.clientX, ev.clientY));
        if (!dragging && Math.hypot(ev.clientX - grab.x, ev.clientY - grab.y) < DRAG_THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          this.emit("dragstart", this.position);
        }
        this.setPosition(ev.clientX - grab.dx, ev.clientY - grab.dy);
      },
      true,
    );
    this.listen(
      document,
      "pointerdown",
      (e) => {
        const ev = e as PointerEvent;
        if (ev.button !== 0 || !this.hitTest(ev.clientX, ev.clientY)) return;
        setHit(true);
        this.activate();
        if (!this.speaking && this.balloon.visible) this.balloon.hide();
        const r = this.element.getBoundingClientRect();
        grab = { dx: ev.clientX - r.left, dy: ev.clientY - r.top, x: ev.clientX, y: ev.clientY };
        dragging = false;
        this.element.setPointerCapture(ev.pointerId);
        // 文字の選択や、画像のドラッグを始めない
        ev.preventDefault();
      },
      true,
    );
    // タッチで絵をつかんだときは、ページをスクロールさせない
    this.listen(
      document,
      "touchstart",
      (e) => {
        const touch = (e as TouchEvent).touches[0];
        if (touch && this.hitTest(touch.clientX, touch.clientY)) e.preventDefault();
      },
      { capture: true, passive: false },
    );
    const end = () => {
      if (!grab) return;
      grab = undefined;
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      // click はこの後すぐに来る (来なければ、次の操作までに戻しておく)
      window.setTimeout(() => (suppressClick = false), 0);
      const pos = this.position;
      this.emit("dragend", pos);
      this.emit("move", { ...pos, by: "drag" });
    };
    this.listen(this.element, "pointerup", end);
    this.listen(this.element, "pointercancel", end);
    this.listen(this.element, "lostpointercapture", end);
    this.listen(this.element, "click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.stopPropagation();
        return;
      }
      this.emit("click", pointerDetail(e as MouseEvent));
    });
  }



  private listen(target: EventTarget, type: string, handler: (e: Event) => void, options: boolean | AddEventListenerOptions = false) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}
