import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { ActCharacter, isActFile } from "./act/reader";
import { animateCandidates, findAnimation, restFrame, stateAnimation } from "./animations";
import { Balloon } from "./balloon";
import { DEFAULT_BALLOON_STYLE, type BalloonStyle, type Character } from "./character";
import { AgentCommands } from "./commands";
import { pointerDetail, type AgentEventListener, type AgentEventMap, type MoveCause, type VisibilityCause } from "./events";
import { IdleController, isIdleAnimation } from "./idle";
import { languageTag, type Language } from "./language";
import { PopupMenu, type MenuEntry } from "./menu";
import { attachPointerInput } from "./pointer";
import { RequestQueue, type Task } from "./queue";
import { RequestError, type AgentRequest, type RequestType } from "./request";
import { Speaker } from "./speak";
import { injectStyles } from "./styles";
import { Talk } from "./talk";
import { voiceParams, type SpeakParams } from "./voice";

export type { AgentEventListener, AgentEventMap, MoveCause, PointerDetail, VisibilityCause } from "./events";

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

/** speak() の 2 つ目の引数 (true / false なら hold と同じ) */
export interface SpeakOptions {
  /** 読み終えても吹き出しを閉じず、closeBalloon() まで次の命令に進まない */
  hold?: boolean;
  /**
   * 音声ファイルでしゃべる (本家の Speak の Url と同じ。.wav / .mp3 など、ブラウザで鳴らせるもの)。
   * 音の大きさに合わせて口を動かし、text は吹き出しに出す (目印 \Mrk\ も使える)
   */
  url?: string | URL | Blob | ArrayBuffer;
}

export interface HideOptions {
  /**
   * true なら、順番待ちを捨てて、すぐに隠れる (clippy.js と同じ)。
   * 省略時 (false) は Microsoft Agent と同じく順番待ちに入り、前の命令が終わってから隠れる
   */
  immediate?: boolean;
}

/** stopAll() で選べる種類 (本家の StopAll と同じ。play には gestureAt、speak には think も含む) */
export type StopType = "play" | "speak" | "move";

const STOP_TYPES: Record<RequestType, StopType | undefined> = {
  play: "play", gestureAt: "play", speak: "speak", think: "speak", moveTo: "move",
  show: undefined, hide: undefined, delay: undefined, wait: undefined, interrupt: undefined, get: undefined,
};

/** get() で取り寄せるものの種類 (本家の Get の Type と同じ。大文字小文字は問わない) */
export type GetType = "animation" | "state" | "wavefile";

/** get("state", …) で、まとめて指定できる状態 (Gesturing なら GesturingDown / Left / Right / Up の全部) */
const STATE_GROUPS: Record<string, readonly string[]> = {
  gesturing: ["GesturingDown", "GesturingLeft", "GesturingRight", "GesturingUp"],
  moving: ["MovingDown", "MovingLeft", "MovingRight", "MovingUp"],
  idling: ["IdlingLevel1", "IdlingLevel2", "IdlingLevel3"],
};

/** キャラクターから見た向き (画面の左が "Right") */
type Direction = "Right" | "Up" | "Left" | "Down";
const DIRECTIONS: readonly Direction[] = ["Right", "Up", "Left", "Down"];

/** play() の timeout の既定値 (clippy.js と同じ) */
const DEFAULT_TIMEOUT_MS = 5000;
/** 隠れているときの speak / think の失敗の理由 */
const HIDDEN = "キャラクターが隠れています";

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
let topmost: Agent | undefined;

/**
 * キャラクター 1 体。clippy.js の Agent と同じ使い方ができる。
 * show / hide / play / speak / think / moveTo / gestureAt / delay は順番待ちに入り、前のものが終わってから 1 つずつ実行される
 */
export class Agent extends EventTarget {
  /** キャラクターの要素 (div.msagent)。この中に canvas がある */
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly player: AcsPlayer;
  /** speak() で声に出すか */
  voice: boolean;
  /** name / description の言語 (BCP 47 か Windows の言語 ID)。undefined ならブラウザの言語 */
  language: Language | readonly Language[] | undefined;
  /** 右クリックのメニューに足す項目 (本家の Commands と同じ) */
  readonly commands = new AgentCommands();
  /** キャラクターを右クリックしたときに、メニューを出すか (本家の AutoPopupMenu と同じ) */
  autoPopupMenu: boolean;

  private readonly balloon: Balloon;
  private readonly talk: Talk;
  private readonly queue: RequestQueue;
  private readonly idle: IdleController;
  private idleEnabled: boolean;
  /** 待機状態 (Idling) か */
  private idling = false;
  private currentScale = 1;
  /** balloonStyle で指定された項目 (キャラクターファイルの設定の上に重ねる) */
  private balloonOverrides: Partial<BalloonStyle> = {};
  private hidden = true;
  /** 登場・退場のアニメーションの途中 (stop() では止めない。本家と同じ) */
  private transition: "show" | "hide" | undefined;
  /** 開いている右クリックのメニュー */
  private menu: PopupMenu | undefined;
  /** 最後に動いた・出た / 消えた原因 (本家の MoveCause / VisibilityCause) */
  private lastMoveCause: MoveCause = "none";
  private lastVisibilityCause: VisibilityCause | "none" = "none";
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
    (options.container ?? document.body).append(this.element, this.balloon.element);

    const speaker = new Speaker(() => this.player);
    this.talk = new Talk({
      balloon: this.balloon,
      speaker,
      player: this.player,
      character,
      emit: this.emit.bind(this),
      balloonStyle: () => this.balloonStyle,
      speakParams: () => this.speakParams(),
      speechLanguage: () => this.speechLanguage,
      voice: () => this.voice,
    });
    this.queue = new RequestQueue(this, {
      beforeStart: async () => {
        // 命令が来たので、待機状態を抜ける。待機動作の途中なら、終了分岐で自然に終わらせてから
        if (this.idling) {
          this.idling = false;
          this.emit("idlecomplete", {});
        }
        this.idle.userActivity();
        await this.idle.interrupt();
      },
      onStart: (request) => this.emit("requeststart", { request }),
      onSettle: (request) => this.emit("requestcomplete", { request }),
    });
    this.idle = new IdleController({
      player: () => this.player,
      character: () => this.character,
      busy: () => this.hidden || this.queue.busy || this.speaking || this.player.isPaused,
    });
    this.idleEnabled = options.idle ?? true;
    if (this.idleEnabled) this.idle.start();
    this.watchAnimations();

    attachPointerInput({
      element: this.element,
      hitTest: (x, y) => this.hitTest(x, y),
      position: () => this.position,
      setPosition: (x, y) => this.setPosition(x, y),
      grab: () => {
        this.activate();
        this.talk.dismiss();
      },
      click: (detail) => this.emit("click", detail),
      dblclick: (detail) => {
        if (this.emit("dblclick", detail, true)) this.animate();
      },
      contextmenu: (e) => this.onContextMenu(e),
      dragstart: () => this.emit("dragstart", this.position),
      dragend: () => {
        const pos = this.position;
        this.emit("dragend", pos);
        this.emit("move", { ...pos, by: "drag" });
      },
      listen: (target, type, handler, options) => this.listen(target, type, handler, options),
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
    return this.enqueue("show", async (complete) => {
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
      const name = fast ? undefined : stateAnimation(this.character, "Showing", ["Show"]);
      if (!name) {
        this.drawRestPose();
        return complete();
      }
      await this.playTransition("show", name);
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

  /**
   * アニメーションを再生する。timeout (ms、既定 5000。0 なら無制限) を過ぎても終わらなければ、終了分岐で自然に終わらせる。
   * 終わったら callback。キャラクターに無いアニメーションなら false。
   * 最後の姿勢 (指す・見るなど) は、次のアニメーションまで保ち、戻りの動きはその前に再生する
   */
  play(animation: string, timeout = DEFAULT_TIMEOUT_MS, callback?: () => void): AgentRequest | false {
    const name = findAnimation(this.character, animation);
    if (!name) return false;
    return this.enqueue("play", (complete) => this.runPlay(name, timeout, callback, complete));
  }

  /** 待機動作以外から、アニメーションを 1 つ選んで再生する */
  animate(): AgentRequest | false {
    const names = animateCandidates(this.character);
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
  speak(text: string, options?: boolean | SpeakOptions): AgentRequest {
    text = pickAlternative(text);
    const { hold, url } = typeof options === "object" ? options : { hold: options, url: undefined };
    return this.enqueue("speak", (complete) => {
      // 隠れている間は、吹き出しも声も出せない (本家も隠れたキャラクターは音を出せず、失敗になる)
      if (this.hidden) return complete("failed", HIDDEN, RequestError.hidden);
      const gen = this.queue.generation;
      void this.talk.speak(text, !!hold, url, complete, () => gen !== this.queue.generation);
    });
  }

  /**
   * 考えごとの吹き出し (雲形) に文を出す (本家の Think と同じ)。声は出さず、口も動かさない。
   * 読み終わるくらいの時間 (文の長さから決める) が過ぎたら次の命令に進み、少しして吹き出しを閉じる
   */
  think(text: string): AgentRequest {
    text = pickAlternative(text);
    return this.enqueue("think", (complete) => {
      if (this.hidden) return complete("failed", HIDDEN, RequestError.hidden);
      this.talk.think(text, complete);
    });
  }

  /** 吹き出しを閉じる (読み上げ中ならやめる) */
  closeBalloon(): void {
    this.talk.close();
  }

  /**
   * (x, y) の方を指す。キャラクターの Gesturing〜 の状態に割り当てられたアニメーション
   * (無ければ Gesture〜、Look〜) を再生する。向きは順番が来たときの位置で決める。指す動きが 1 つも無ければ false
   */
  gestureAt(x: number, y: number): AgentRequest | false {
    if (!DIRECTIONS.some((d) => this.gestureAnimation(d))) return false;
    return this.enqueue("gestureAt", (complete) => {
      const name = this.gestureAnimation(this.direction(x, y));
      if (!name) return complete("failed", "その向きの動きがありません", RequestError.stateNotFound);
      this.runPlay(name, DEFAULT_TIMEOUT_MS, undefined, complete);
    });
  }

  /**
   * (x, y) へ移動する。Move〜 のアニメーションがあれば、Microsoft Agent と同じく
   * 移動前の動き → 最後のコマのまま移動 → 移動後の動き (戻りアニメか終了分岐) の順にする。duration が 0 なら、すぐ移る
   */
  moveTo(x: number, y: number, duration = 1000): AgentRequest {
    return this.enqueue("moveTo", async (complete, request) => {
      // 隠れている間は、アニメーションなしですぐ移る (本家と同じ)
      if (duration === 0 || this.hidden) {
        this.setPosition(x, y);
        this.emit("move", { ...this.position, by: "moveTo" });
        return complete();
      }
      const d = this.direction(x, y);
      const name = stateAnimation(this.character, `Moving${d}`, [`Move${d}`]);
      if (name) await this.player.play(name, { hold: true });
      await this.slide(x, y, duration, request);
      this.emit("move", { ...this.position, by: "moveTo" });
      if (name) await this.player.playReturn();
      complete();
    });
  }

  /** 次の命令まで、time (ms、既定 250) 待つ */
  delay(time = 250): AgentRequest {
    return this.enqueue("delay", (complete) => {
      const timer = window.setTimeout(() => complete(), time);
      this.queue.onAbort(() => {
        window.clearTimeout(timer);
        complete();
      });
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
    return this.enqueue("wait", (complete) => {
      // 自分の命令を待つと、順番によっては終わらなくなる (本家もできない)
      if (request.agent === this) return complete("failed", "自分の命令は待てません", RequestError.waitSelf);
      if (request.done) return complete();
      void request.then(() => complete());
      this.queue.onAbort(() => complete());
    });
  }

  /**
   * 順番が来たら、別のキャラクターの命令を止める (本家の Interrupt と同じ)。
   * その命令が実行中なら終わらせて相手の次の命令へ進め、順番待ちなら取り除く。相手の順番待ちは捨てない
   */
  interrupt(request: AgentRequest): AgentRequest {
    return this.enqueue("interrupt", (complete) => {
      if (request.agent === this) return complete("failed", "自分の命令は止められません (stop を使う)", RequestError.interruptSelf);
      request.agent.stop(request);
      complete();
    });
  }

  /**
   * アニメーション・状態・音声ファイルを、先に取り寄せる (本家の Get と同じ)。
   * .acs / .act はファイルを丸ごと読み込み済みなので、アニメーションと状態は、あるかどうかを確かめるだけ
   * (無ければ failed)。"wavefile" は URL を読み込んでおき (ブラウザのキャッシュに入る)、後の speak(text, { url }) を速くする。
   * name はカンマ区切りで複数指定できる。queue が true (既定) なら順番待ちに入り、false ならすぐ実行する
   *
   * ```js
   * agent.get("animation", "Wave, Greet");
   * agent.get("state", "Gesturing"); // GesturingDown / Left / Right / Up の全部
   * agent.get("wavefile", "hello.wav", false);
   * ```
   */
  get(type: GetType, name: string, queue = true): AgentRequest {
    const task: Task = (complete) => void this.runGet(type, name).then(([description, number]) =>
      number ? complete("failed", description, number) : complete(),
    );
    return queue ? this.enqueue("get", task) : this.queue.runNow("get", task);
  }

  /** いまのアニメーションを、終了分岐で自然に終わらせる (しゃべっている途中なら、読み終えたら吹き出しを閉じる) */
  stopCurrent(): void {
    void this.player.release();
    this.talk.stopCurrent();
  }

  /**
   * 順番待ちを全部捨て、いまのアニメーションを終わらせ、吹き出しを閉じる。
   * 登場・退場のアニメーションの途中なら、それは最後まで再生する (本家と同じ)。
   * request を渡すと、その命令だけを止める (実行中なら終わらせて次へ、順番待ちなら取り除く)
   */
  stop(request?: AgentRequest): void {
    if (request) return this.stopRequest(request);
    if (this.transition) {
      this.queue.drop(() => true);
      this.talk.close();
      return;
    }
    this.queue.clear();
    void this.player.release();
    this.talk.close();
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
    this.queue.drop(matches);
    const current = this.queue.current;
    if (current && matches(current)) this.interruptCurrent();
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
    return this.talk.speaking;
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
    this.moveNow(x, this.position.y);
  }

  get top(): number {
    return this.position.y;
  }

  set top(y: number) {
    this.moveNow(this.position.x, y);
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

  /**
   * 吹き出しが出ているか (本家の Balloon.Visible と同じ)。
   * false を代入すると閉じる (しゃべっている途中なら、読み終えたらすぐ閉じる)。
   * true を代入すると、最後の文をもう一度出す (自動では閉じない。隠れている間や、吹き出しを使わないキャラクターでは何もしない)
   */
  get balloonVisible(): boolean {
    return this.balloon.visible;
  }

  set balloonVisible(visible: boolean) {
    if (visible && (this.hidden || !this.balloonStyle.enabled)) return;
    this.talk.setBalloonVisible(visible);
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
    const z = String(++zIndexCounter);
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
    this.menu = new PopupMenu(entries, x, y, { fontName: this.commands.fontName, fontSize: this.commands.fontSize });
    return true;
  }

  /** 後片付け: 再生・読み上げ・待機動作をやめ、要素を取り除く */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hidden = true;
    this.stop();
    this.queue.close();
    this.idle.stop();
    this.player.stop();
    this.player.onPlayingChange = undefined;
    this.player.onAnimationChange = undefined;
    this.menu?.close();
    if (topmost === this) topmost = undefined;
    for (const cleanup of this.cleanups) cleanup();
    this.element.remove();
    this.balloon.element.remove();
  }

  // --- 内部: 命令 ---

  private enqueue(type: RequestType, task: Task): AgentRequest {
    return this.queue.add(type, task);
  }

  /** hide() の中身。cause: 誰が隠したか (右クリックのメニューなら "user") */
  private queueHide(fast: boolean | undefined, callback: (() => void) | undefined, options: HideOptions, cause: VisibilityCause) {
    if (options.immediate) {
      // clippy.js と同じ: いまの動き (登場・退場の途中でも) と順番待ちを捨てて、すぐ隠れる
      this.transition = undefined;
      this.queue.clear();
      this.talk.close();
    }
    return this.enqueue("hide", async (complete) => {
      if (this.hidden) {
        callback?.();
        return complete();
      }
      this.talk.close();
      const name = fast ? undefined : stateAnimation(this.character, "Hiding", ["Hide"]);
      if (name) await this.playTransition("hide", name);
      this.hidden = true;
      this.player.stop();
      this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.element.style.display = "none";
      this.balloon.hide();
      this.emit("hide", { cause });
      callback?.();
      complete();
    });
  }

  /** 登場・退場のアニメーションを再生する (その間は stop() で止めない) */
  private async playTransition(kind: "show" | "hide", name: string) {
    this.transition = kind;
    await this.player.play(name);
    this.transition = undefined;
  }

  /** get() の中身。できたら ["", 0]、できなければ [理由, 番号] */
  private async runGet(type: GetType, name: string): Promise<[string, number]> {
    const names = name.split(",").map((n) => n.trim()).filter(Boolean);
    switch (type.toLowerCase()) {
      case "animation": {
        const missing = names.find((n) => !findAnimation(this.character, n));
        return missing ? [`アニメーションがありません: ${missing}`, RequestError.animationNotFound] : ["", 0];
      }
      case "state": {
        const missing = names.find((n) =>
          (STATE_GROUPS[n.toLowerCase()] ?? [n]).every((state) => this.character.stateAnimations(state).length === 0),
        );
        return missing ? [`状態にアニメーションがありません: ${missing}`, RequestError.stateNotFound] : ["", 0];
      }
      case "wavefile":
        for (const url of names) {
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status} ${res.url}`);
            await res.arrayBuffer();
          } catch (e) {
            return [`音声ファイルを読み込めません: ${e instanceof Error ? e.message : String(e)}`, RequestError.invalidSound];
          }
        }
        return ["", 0];
      default:
        return [`get() の type が正しくありません: ${type}`, RequestError.invalidGetType];
    }
  }

  /** play() の中身 (順番が来たとき)。隠れている間は描かずに、すぐ終わったことにする (本家は見えないまま再生する) */
  private runPlay(name: string, timeout: number, callback: (() => void) | undefined, complete: () => void) {
    if (this.hidden) {
      callback?.();
      return complete();
    }
    const timer = timeout
      ? window.setTimeout(() => {
          if (this.player.requestedAnimation === name) void this.player.release();
        }, timeout)
      : undefined;
    // Microsoft Agent と同じく、戻りの動きは次のアニメーションの前にする (指した姿勢のまましゃべれる)
    void this.player.play(name, { hold: true }).then(() => {
      window.clearTimeout(timer);
      callback?.();
      complete();
    });
  }

  private gestureAnimation(d: Direction): string | undefined {
    return stateAnimation(this.character, `Gesturing${d}`, [`Gesture${d}`, `Look${d}`]);
  }

  /** 命令を 1 つだけ止める: 実行中なら終わらせて次へ、順番待ちなら取り除く */
  private stopRequest(request: AgentRequest) {
    if (request.agent !== this) return request.agent.stop(request);
    if (request.done) return;
    if (this.queue.current === request) this.interruptCurrent();
    else this.queue.drop((r) => r === request);
  }

  /**
   * 実行中の命令を終わらせて、次の命令へ進める (本家の Interrupt と同じ。順番待ちは捨てない)。
   * アニメーションは終了分岐で自然に終わらせ、しゃべり・考えごとは途中でやめ、待ちはすぐやめる
   */
  private interruptCurrent() {
    this.queue.interruptCurrent(() => {
      void this.player.release();
      if (this.speaking) this.talk.close();
    });
  }

  // --- 内部: イベント・アニメーション ---

  /** イベントを出す。cancelable で preventDefault() されたら false */
  private emit<K extends keyof AgentEventMap>(type: K, detail: AgentEventMap[K], cancelable = false): boolean {
    // 最後に動いた・出た / 消えた原因を覚えておく (moveCause / visibilityCause)
    if (type === "move") this.lastMoveCause = (detail as AgentEventMap["move"]).by;
    if (type === "show" || type === "hide") this.lastVisibilityCause = (detail as AgentEventMap["show"]).cause;
    return this.dispatchEvent(new CustomEvent(type, { detail, cancelable }));
  }

  /**
   * アニメーションの始まり・終わりを知らせ (戻りアニメも 1 つのアニメーションとして)、
   * 命令が無いときに待機動作が始まったら、待機状態に入る
   */
  private watchAnimations() {
    this.player.onAnimationChange = (current, previous) => {
      if (previous) this.emit("animationend", { name: previous, idle: isIdleAnimation(this.character, previous) });
      if (!current) return;
      const idle = isIdleAnimation(this.character, current);
      if (idle && !this.queue.busy && !this.idling) {
        this.idling = true;
        this.emit("idlestart", {});
      }
      this.emit("animationstart", { name: current, idle });
    };
    this.player.onPlayingChange = (active) => {
      if (!active) this.idle.animationEnded();
    };
  }

  /** 右クリック: click として知らせ、メニューを出す (autoPopupMenu のとき) */
  private onContextMenu(e: MouseEvent) {
    this.emit("click", pointerDetail(e));
    if (!this.autoPopupMenu) return;
    e.preventDefault();
    this.showPopupMenu(e.clientX, e.clientY);
  }

  /** 止まっているときの絵を描く */
  private drawRestPose() {
    const frame = restFrame(this.character);
    if (frame) this.player.draw(frame);
  }

  // --- 内部: 読み上げ ---

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

  /** メニューなどの文言を日本語にするか (agent.language、無ければブラウザの言語) */
  private get isJapanese(): boolean {
    const lang = this.speechLanguage ?? (typeof navigator === "undefined" ? "en" : navigator.language);
    return lang.toLowerCase().startsWith("ja");
  }

  // --- 内部: 位置と大きさ ---

  private applyScale(scale: number) {
    this.currentScale = scale;
    this.canvas.style.width = `${this.character.width * scale}px`;
    this.canvas.style.height = `${this.character.height * scale}px`;
    // 拡大はドット絵のまま、縮小はなめらかに
    this.canvas.style.imageRendering = scale > 1 ? "pixelated" : "auto";
    this.balloon.reposition();
  }

  /** キャラクターの左上の位置 (隠れている間は、画面上の大きさが無いので、指定された位置) */
  private get position(): { x: number; y: number } {
    if (this.element.style.display === "none") {
      return { x: parseFloat(this.element.style.left) || 0, y: parseFloat(this.element.style.top) || 0 };
    }
    const r = this.element.getBoundingClientRect();
    return { x: r.left, y: r.top };
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

  /** すぐ移り、move を知らせる (left / top の代入) */
  private moveNow(x: number, y: number) {
    this.setPosition(x, y);
    this.emit("move", { ...this.position, by: "moveTo" });
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

  private listen(target: EventTarget, type: string, handler: (e: Event) => void, options: boolean | AddEventListenerOptions = false) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}
