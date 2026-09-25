import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { ActCharacter, isActFile } from "./act/reader";
import { registerAudioClient } from "./audio";
import { animateCandidates, findAnimation, restFrame, stateAnimation, thinkingAnimation } from "./animations";
import { Balloon } from "./balloon";
import { DEFAULT_BALLOON_STYLE, type BalloonStyle, type Character } from "./character";
import { AgentCommands, type GlobalVoiceCommand, type VoiceMatch } from "./commands";
import { CommandsWindow, type CommandsWindowContent } from "./commandswindow";
import { pointerDetail, type AgentEventListener, type AgentEventMap, type HelpCause, type MoveCause, type VisibilityCause } from "./events";
import { IdleController, isIdleAnimation } from "./idle";
import { languageTag, type Language } from "./language";
import { Listener, recognitionClass, type HeardAlternative, type ListenCause, type ListenMode, type SrStatus } from "./listen";
import { ListeningTip } from "./listentip";
import { PopupMenu, type MenuEntry } from "./menu";
import { attachPointerInput } from "./pointer";
import { RequestQueue, type Task } from "./queue";
import { AgentRequestError, RequestError, type AgentRequest, type RequestType } from "./request";
import { Speaker } from "./speak";
import { injectStyles } from "./styles";
import { Talk } from "./talk";
import { voiceParams, type SpeakParams } from "./voice";

export type {
  AgentEventListener,
  AgentEventMap,
  CommandAlternative,
  CommandDetail,
  HelpCause,
  HelpDetail,
  MoveCause,
  PointerDetail,
  VisibilityCause,
} from "./events";
export type { ListenCause, ListenMode, SrStatus } from "./listen";

export interface AgentOptions {
  /** キャラクターを置く要素 (既定: document.body) */
  container?: HTMLElement;
  /** 効果音を鳴らすか (既定: true)。ブラウザの制限で、ページが一度クリックされるまでは鳴らない */
  sound?: boolean;
  /** speak() で声に出して読み上げるか (既定: true)。false なら吹き出しと口の動きだけ */
  voice?: boolean;
  /**
   * speak() / think() の文の、読み上げの制御タグ (\Pau=500\ や SAPI 5 の <silence/> など) を使うか (既定: true)。
   * false なら、タグも文字としてそのまま読み、吹き出しに出す (agent.tags と同じ。msagent.js で足したもの)
   */
  tags?: boolean;
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
  /**
   * 聞き取りキー (本家の Listening key)。押している間、声のコマンドを聞く。KeyboardEvent の key か code
   * (例: "ScrollLock"、"F8")。既定: なし (listen() でだけ聞く)
   */
  listeningKey?: string;
  /** 聞いている間、キャラクターの下に聞き取りのヒントを出すか (既定: true。本家の Listening Tip) */
  listeningTip?: boolean;
  /**
   * 命令の失敗を例外にするか (既定: false。本家の RaiseRequestErrors。本家の既定は true だが、msagent.js では false)。
   * true なら、失敗した命令を await すると AgentRequestError になり、無いアニメーションの play() などはその場で例外を投げる
   */
  raiseRequestErrors?: boolean;
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
  /**
   * 声に出すか (この 1 回だけ。省略時は agent.voice)。false なら、吹き出しと口の動きだけ
   */
  voice?: boolean;
  /** 読み上げの制御タグを使うか (この 1 回だけ。省略時は agent.tags)。false なら、タグも文字としてそのまま */
  tags?: boolean;
}

/** think() の 2 つ目の引数 */
export interface ThinkOptions {
  /**
   * true なら、考えごとの吹き出しのまま声に出して読み、口も動かす (msagent.js で足したもの。本家の Think は声を出さない)。
   * 読み上げの制御タグも使える
   */
  voice?: boolean;
  /** 読み上げの制御タグを使うか (この 1 回だけ。省略時は agent.tags)。false なら、タグも文字としてそのまま */
  tags?: boolean;
}

export interface HideOptions {
  /**
   * true なら、順番待ちを捨てて、すぐに隠れる。
   * 省略時 (false) は Microsoft Agent と同じく順番待ちに入り、前の命令が終わってから隠れる
   */
  immediate?: boolean;
}

/** stop() / stopAll() / stopCurrent() の設定 */
export interface StopOptions {
  /**
   * true なら、アニメーションを終わりの動き (終了分岐) をせずに、その場で切り、止まっているときの絵に戻す。
   * 省略時 (false) は、本家と同じく終わりの動きをたどって自然に終わらせる
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

/** play() の timeout の既定値 */
const DEFAULT_TIMEOUT_MS = 5000;
/** 音声コマンドの窓を開く・閉じる声のコマンド (本家の Global Commands) */
const OPEN_COMMANDS_VOICE =
  "((open | show) [the] commands [window] | what can I say [now] | (コマンド | こまんど) [の] [一覧] [を] (見せて | みせて | 開いて | ひらいて | 表示して) | (何 | なん) (と | て) (言えば | いえば) [いい])";
const CLOSE_COMMANDS_VOICE = "(close [the] commands [window] | (コマンド | こまんど) [の] [一覧] [を] (閉じて | とじて))";

/** 聞き取りのヒントに、聞こえた文を出しておく時間 (ms) */
const HEARD_TIP_MS = 3000;

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
 * キャラクター 1 体。
 * show / hide / play / speak / think / moveTo / gestureAt / delay は順番待ちに入り、前のものが終わってから 1 つずつ実行される
 */
export class Agent extends EventTarget {
  /** キャラクターの要素 (div.msagent)。この中に canvas がある */
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly player: AcsPlayer;
  /** speak() で声に出すか */
  voice: boolean;
  /** speak() / think() の文の、読み上げの制御タグを使うか。false なら、タグも文字としてそのまま (AgentOptions の tags を参照) */
  tags: boolean;
  /** name / description の言語 (BCP 47 か Windows の言語 ID)。undefined ならブラウザの言語 */
  language: Language | readonly Language[] | undefined;
  /** 右クリックのメニューに足す項目 (本家の Commands と同じ) */
  readonly commands = new AgentCommands();
  /**
   * 音声コマンドの窓 (本家の CommandsWindow)。いま声で言えるコマンドの一覧。visible で開く・閉じる。
   * 開いている間にコマンドを変えたら refresh() で出し直す
   */
  readonly commandsWindow: CommandsWindow;
  /** キャラクターを右クリックしたときに、メニューを出すか (本家の AutoPopupMenu と同じ) */
  autoPopupMenu: boolean;
  /** 聞き取りキー (KeyboardEvent の key か code。例: "ScrollLock")。undefined なら使わない (本家の Listening key) */
  listeningKey: string | undefined;
  /** 聞いている間、聞き取りのヒントを出すか (本家の Listening Tip) */
  listeningTip: boolean;
  /** 命令の失敗を例外にするか (本家の RaiseRequestErrors。AgentOptions の raiseRequestErrors を参照) */
  raiseRequestErrors: boolean;
  /** キャラクターをクリック・ドラッグしてヘルプモードが終わったときに、helpcomplete で渡す番号 (本家の HelpContextID) */
  helpContextId: number | undefined;

  private readonly balloon: Balloon;
  private readonly listener: Listener;
  private readonly tip: ListeningTip;
  /** 聞き取りのヒントに、聞こえた文を出している間のタイマー */
  private tipTimer: number | undefined;
  private helpMode = false;
  /** 聞き取りのために、Listening / Hearing の状態のアニメーションを再生した (終わったら戻す) */
  private listenAnimation = false;
  /** think() のために再生している考える動き (終わったら戻す) */
  private thinkPose: string | undefined;
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
    this.tags = options.tags ?? true;
    this.language = options.language;
    this.autoPopupMenu = options.autoPopupMenu ?? true;
    this.listeningKey = options.listeningKey;
    this.listeningTip = options.listeningTip ?? true;
    this.raiseRequestErrors = options.raiseRequestErrors ?? false;
    this.balloonOverrides = { ...options.balloon };
    this.balloon = new Balloon(this.element, this.balloonStyle, (visible) =>
      this.emit(visible ? "balloonshow" : "balloonhide", {}),
    );
    this.tip = new ListeningTip(this.element);
    this.commandsWindow = new CommandsWindow(
      () => this.commandsWindowContent(),
      () => String(++zIndexCounter),
    );
    this.applyScale(options.scale ?? 1);
    (options.container ?? document.body).append(this.element, this.balloon.element, this.tip.element);

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
      onStart: (request) => {
        this.listenAnimation = false;
        this.thinkPose = undefined;
        this.emit("requeststart", { request });
      },
      onSettle: (request) => this.emit("requestcomplete", { request }),
    });
    this.idle = new IdleController({
      player: () => this.player,
      character: () => this.character,
      busy: () => this.hidden || this.queue.busy || this.speaking || this.player.isPaused || this.listener.listening,
    });
    this.listener = new Listener({
      lang: () => this.speechLanguage ?? (typeof navigator === "undefined" ? "en-US" : navigator.language),
      onStart: (mode) => this.onListenStart(mode),
      onHearing: () => this.playListenState("Hearing"),
      onHeard: (alternatives) => this.onHeard(alternatives),
      onEnd: (cause) => this.onListenEnd(cause),
    });
    // 全キャラクターの音の状態 (audioOutput.status) のために登録する
    const talk = this.talk;
    const listener = this.listener;
    this.cleanups.push(
      registerAudioClient({
        get speakingAloud() {
          return talk.speakingAloud;
        },
        get listening() {
          return listener.listening;
        },
        get hearing() {
          return listener.hearing;
        },
      }),
    );
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
      helpMode: () => this.helpMode,
      help: () => this.completeHelp("", "character"),
      dragstart: () => this.emit("dragstart", this.position),
      dragend: () => {
        const pos = this.position;
        this.emit("dragend", pos);
        this.emit("move", { ...pos, by: "drag" });
      },
      listen: (target, type, handler, options) => this.listenTo(target, type, handler, options),
    });
    // ブラウザの窓が小さくなったら、画面の中に戻す
    this.listenTo(window, "resize", () => {
      const before = this.position;
      this.reposition();
      const after = this.position;
      if (!this.hidden && (before.x !== after.x || before.y !== after.y)) this.emit("move", { ...after, by: "reposition" });
    });
    // 聞き取りキー: 押している間聞く (いちばん手前のキャラクターだけ)
    this.listenTo(window, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (!this.isListeningKey(k) || !this.active) return;
      k.preventDefault();
      if (!k.repeat) this.listener.start("key");
    });
    this.listenTo(window, "keyup", (e) => {
      if (this.isListeningKey(e as KeyboardEvent) && this.listener.mode === "key") this.listener.stop("key");
    });
    this.listenTo(window, "blur", () => {
      if (this.listener.mode === "key") this.listener.stop("key");
    });
    // 最初の操作で音を鳴らせるようにしておく (自動再生の制限)
    const unlock = () => this.player.unlockAudio();
    this.listenTo(window, "pointerdown", unlock, true);
    this.listenTo(window, "keydown", unlock, true);
  }

  // --- 基本の命令 ---

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
        // 画面の右下寄り (はみ出す分は reposition で戻す)
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
   * 終わったら callback。キャラクターに無いアニメーションなら false (raiseRequestErrors なら例外)。
   * 最後の姿勢 (指す・見るなど) は、次のアニメーションまで保ち、戻りの動きはその前に再生する
   */
  play(animation: string, timeout = DEFAULT_TIMEOUT_MS, callback?: () => void): AgentRequest | false {
    const name = findAnimation(this.character, animation);
    if (!name) return this.fail(RequestError.animationNotFound, `アニメーションがありません: ${animation}`);
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
   * 吹き出しでしゃべる (声に出すのは agent.voice が true のとき。{ voice: false } なら、この 1 回だけ声を出さない)。
   * hold なら、読み終えても吹き出しを閉じず、closeBalloon() まで次の命令に進まない
   */
  speak(text: string, options?: boolean | SpeakOptions): AgentRequest {
    text = pickAlternative(text);
    const { hold, url, voice, tags } = typeof options === "object" ? options : { hold: options, url: undefined, voice: undefined, tags: undefined };
    return this.enqueue("speak", (complete) => {
      // 隠れている間は、吹き出しも声も出せない (本家も隠れたキャラクターは音を出せず、失敗になる)
      if (this.hidden) return complete("failed", HIDDEN, RequestError.hidden);
      const gen = this.queue.generation;
      void this.talk.speak(text, { hold: !!hold, url, voice, tags: tags ?? this.tags }, complete, () => gen !== this.queue.generation);
    });
  }

  /**
   * 考えごとの吹き出し (雲形) に文を出す (本家の Think と同じ)。声は出さず、口も動かさない。
   * キャラクターの声の速さで読んだときの時間をかけて文字を出し (声なしの speak と同じ)、出し終えたら次の命令に進み、少しして吹き出しを閉じる。
   * { voice: true } なら、考えごとの吹き出しのまま声に出して読み、読み終えたら次の命令に進む
   */
  think(text: string, options: ThinkOptions = {}): AgentRequest {
    text = pickAlternative(text);
    return this.enqueue("think", (complete) => {
      if (this.hidden) return complete("failed", HIDDEN, RequestError.hidden);
      const tags = options.tags ?? this.tags;
      if (!options.voice) return this.talk.think(text, this.withThinkingPose(complete), tags);
      // 声に出して考える: 考えごとの吹き出しで speak と同じように読む
      const gen = this.queue.generation;
      void this.talk.speak(text, { voice: true, thought: true, tags }, complete, () => gen !== this.queue.generation);
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
    if (!DIRECTIONS.some((d) => this.gestureAnimation(d))) return this.fail(RequestError.stateNotFound, "指す動きがありません");
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
      // stop() で捨てられたら (request.done)、その場でやめる。続けると、次の命令 (例: 別の場所への moveTo) と
      // 位置を取り合い、着いたときの戻りの動きで次の命令の移動のアニメーションを止めてしまう (歩かずに滑る)
      const dropped = () => {
        if (!request.done) return false;
        // 次の命令が無ければ、移動の姿勢のまま固まらないよう、戻りの動きだけ再生する
        if (name && !this.queue.current) void this.player.playReturn();
        return true;
      };
      if (name) await this.player.play(name, { hold: true });
      if (dropped()) return;
      await this.slide(x, y, duration, request);
      if (dropped()) return;
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
      void request.then(() => complete(), () => complete());
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

  /**
   * いまのアニメーションを、終了分岐で自然に終わらせる (しゃべっている途中なら、読み終えたら吹き出しを閉じる)。
   * { immediate: true } なら、アニメーションをその場で切る
   */
  stopCurrent(options: StopOptions = {}): void {
    this.endAnimation(options);
    this.talk.stopCurrent();
  }

  /**
   * 順番待ちを全部捨て、いまのアニメーションを終わらせ、吹き出しを閉じる。
   * 登場・退場のアニメーションの途中なら、それは最後まで再生する (本家と同じ)。
   * request を渡すと、その命令だけを止める (実行中なら終わらせて次へ、順番待ちなら取り除く)。
   * { immediate: true } なら、アニメーションを終わりの動きをせずに、その場で切る
   */
  stop(request?: AgentRequest, options: StopOptions = {}): void {
    if (request) return this.stopRequest(request, options);
    if (this.transition) {
      this.queue.drop(() => true);
      this.talk.close();
      return;
    }
    this.queue.clear();
    this.endAnimation(options);
    this.talk.close();
  }

  /**
   * 命令を種類ごとに止める (本家の StopAll と同じ)。types: "play" (play / gestureAt) / "speak" (speak / think) / "move" (moveTo)。
   * 省略すると、登場・退場の途中も含めて、全部止める。{ immediate: true } なら、アニメーションをその場で切る
   */
  stopAll(types?: StopType | readonly StopType[], options: StopOptions = {}): void {
    if (types === undefined) {
      this.transition = undefined;
      this.stop(undefined, options);
      return;
    }
    const wanted = new Set(Array.isArray(types) ? types : [types as StopType]);
    const matches = (r: AgentRequest) => {
      const t = STOP_TYPES[r.type];
      return t !== undefined && wanted.has(t);
    };
    this.queue.drop(matches);
    const current = this.queue.current;
    if (current && matches(current)) this.interruptCurrent(options);
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
    this.tip.element.style.zIndex = z;
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
          onSelect: () => {
            // ヘルプモードなら、コマンドの代わりにヘルプを知らせる (本家と同じ)
            if (this.helpMode) return this.completeHelp(c.name, "command", c.helpContextId);
            this.emit("command", { name: c.name, source: "menu", confidence: 100, voice: "", count: 1, alternatives: [] });
          },
        });
      }
    }
    if (entries.length > 0) entries.push({ kind: "separator" });
    // 音声認識が使えるブラウザなら、音声コマンドの窓を開く・閉じる項目 (本家と同じ)
    if (recognitionClass()) {
      const open = this.commandsWindow.visible;
      const ja = this.isJapanese;
      entries.push({
        kind: "item",
        caption: open ? (ja ? "音声コマンドを閉じる(&C)" : "&Close Voice Commands") : ja ? "音声コマンドを開く(&O)" : "&Open Voice Commands",
        enabled: true,
        onSelect: () => {
          if (this.helpMode) return this.completeHelp("", open ? "closeCommandsWindow" : "openCommandsWindow");
          this.commandsWindow.visible = !open;
        },
      });
    }
    // 本家と同じく、キャラクターを隠す項目を足す (ユーザーが隠したので、hide の cause は "user")
    entries.push({
      kind: "item",
      caption: this.isJapanese ? "隠す(&H)" : "&Hide",
      enabled: true,
      onSelect: () => {
        if (this.helpMode) return this.completeHelp("", "hide");
        void this.queueHide(false, undefined, { immediate: true }, "user");
      },
    });
    this.menu = new PopupMenu(entries, x, y, { fontName: this.commands.fontName, fontSize: this.commands.fontSize, help: this.helpMode });
    // どのキャラクターよりも手前に出す (キャラクターは手前に出すたびに z-index が増える)
    this.menu.element.style.zIndex = String(++zIndexCounter);
    return true;
  }

  /**
   * 声のコマンドを聞く (本家の Listen と同じ)。true なら 10 秒聞き (聞いている途中なら延ばす)、1 つ言い終えたらやめる。
   * false ならやめる。聞いた言葉は、commands の voice と照らし合わせて command イベントで知らせる。
   * 音声認識が使えない (ブラウザが対応していないなど) ときと、聞き取りキーを押している間の listen(false) は false
   */
  listen(on: boolean): boolean {
    if (this.destroyed) return false;
    if (on) return this.listener.start("program");
    if (this.listener.mode === "key") return false;
    this.listener.stop("program");
    return true;
  }

  /**
   * ヘルプモード (本家の HelpModeOn と同じ)。true の間は、キャラクターのクリック・ドラッグ、メニューの項目、声のコマンドを選ぶと、
   * click / dragstart / command の代わりに helpcomplete イベントが来て、ヘルプモードが終わる (右クリックのメニューは出せる)。
   * false を代入してやめたときは、helpcomplete は来ない
   */
  get helpModeOn(): boolean {
    return this.helpMode;
  }

  set helpModeOn(on: boolean) {
    this.helpMode = on;
    this.element.classList.toggle("msagent-help-mode", on);
  }

  /** 聞いているか */
  get listening(): boolean {
    return this.listener.listening;
  }

  /**
   * 音声入力が使えるか (本家の SRStatus と同じ値)。0: 使える / 1: マイクが使えない /
   * 4: このブラウザには音声認識が無い・認識サービスにつながらない / 5: マイク・音声認識を許可されていない / 6: そのほか。
   * 許可されているかは、一度聞いてみるまで分からない
   */
  get srStatus(): SrStatus {
    return this.listener.srStatus;
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
    this.listener.abort();
    window.clearTimeout(this.tipTimer);
    if (topmost === this) topmost = undefined;
    for (const cleanup of this.cleanups) cleanup();
    this.element.remove();
    this.balloon.element.remove();
    this.tip.element.remove();
    this.commandsWindow.destroy();
  }

  // --- 内部: 命令 ---

  /** 命令を作る前に分かった失敗: raiseRequestErrors なら例外、そうでなければ false */
  private fail(number: number, description: string): false {
    if (this.raiseRequestErrors) throw new AgentRequestError(number, description);
    return false;
  }

  private enqueue(type: RequestType, task: Task): AgentRequest {
    return this.queue.add(type, task);
  }

  /** hide() の中身。cause: 誰が隠したか (右クリックのメニューなら "user") */
  private queueHide(fast: boolean | undefined, callback: (() => void) | undefined, options: HideOptions, cause: VisibilityCause) {
    if (options.immediate) {
      // いまの動き (登場・退場の途中でも) と順番待ちを捨てて、すぐ隠れる
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
      // 退場のアニメーションの効果音は最後まで鳴らす (アニメーションなしで隠れたなら、前の動きの音を止める)
      this.player.stop({ keepSounds: name !== undefined });
      this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.element.style.display = "none";
      this.balloon.hide();
      this.tip.hide();
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

  /**
   * 考えている間、考える動き (Thinking / Think) を再生する。complete を包んで返し、考え終えたら元の姿勢に戻す
   * (次の命令があれば、その前の戻りの動きで戻る)
   */
  private withThinkingPose(complete: Parameters<Task>[0]): Parameters<Task>[0] {
    const pose = thinkingAnimation(this.character);
    if (!pose) return complete;
    this.thinkPose = pose;
    void this.player.play(pose, { hold: true });
    return (...args) => {
      if (this.thinkPose === pose) {
        this.thinkPose = undefined;
        // 繰り返す動きは終了分岐で終わらせ、最後の姿勢のままなら戻す
        void this.player.release().then(() => {
          if (!this.queue.busy && !this.hidden && this.player.isHolding) void this.player.playReturn();
        });
      }
      complete(...args);
    };
  }

  private gestureAnimation(d: Direction): string | undefined {
    return stateAnimation(this.character, `Gesturing${d}`, [`Gesture${d}`, `Look${d}`]);
  }

  /** 命令を 1 つだけ止める: 実行中なら終わらせて次へ、順番待ちなら取り除く */
  private stopRequest(request: AgentRequest, options: StopOptions) {
    if (request.agent !== this) return request.agent.stop(request, options);
    if (request.done) return;
    if (this.queue.current === request) this.interruptCurrent(options);
    else this.queue.drop((r) => r === request);
  }

  /**
   * 実行中の命令を終わらせて、次の命令へ進める (本家の Interrupt と同じ。順番待ちは捨てない)。
   * アニメーションは終了分岐で自然に終わらせ ({ immediate: true } ならその場で切り)、しゃべり・考えごとは途中でやめ、待ちはすぐやめる
   */
  private interruptCurrent(options: StopOptions = {}) {
    this.queue.interruptCurrent(() => {
      this.endAnimation(options);
      if (this.speaking) this.talk.close();
    });
  }

  /** いまのアニメーションを終わらせる: 終了分岐で自然に、または (immediate) その場で切って止まっているときの絵に戻す */
  private endAnimation({ immediate = false }: StopOptions) {
    if (!immediate) return void this.player.release();
    this.player.stop();
    if (!this.hidden) this.drawRestPose();
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
    // ヘルプモードでメニューを出さないなら、右クリックもヘルプ (本家と同じ)
    if (this.helpMode && !this.autoPopupMenu) {
      e.preventDefault();
      return this.completeHelp("", "character");
    }
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

  /** ヘルプモードを終え、helpcomplete で知らせる (キャラクターなら、キャラクターの helpContextId) */
  private completeHelp(name: string, cause: HelpCause, helpContextId?: number) {
    this.helpModeOn = false;
    this.emit("helpcomplete", { name, cause, helpContextId: cause === "character" ? this.helpContextId : helpContextId });
  }

  // --- 内部: 聞き取り ---

  private isListeningKey(e: KeyboardEvent): boolean {
    const key = this.listeningKey?.toLowerCase();
    return !!key && (e.key.toLowerCase() === key || e.code.toLowerCase() === key);
  }

  /** msagent.js が用意する声のコマンド: 「隠れて」(本家の Global Commands の Hide) */
  private get globalVoiceCommands(): GlobalVoiceCommand[] {
    // 名前は、文法の記号を除いて使う
    const name = (this.name ?? "").replace(/[()[\]|*+\\.]/g, " ").trim();
    const n = name ? `[${name}]` : "";
    return [
      { id: "hide", voice: `(hide ${n} | ${n} (隠れて | かくれて | 隠す | かくす | 消えて | きえて))` },
      { id: "openCommands", voice: OPEN_COMMANDS_VOICE },
      { id: "closeCommands", voice: CLOSE_COMMANDS_VOICE },
    ];
  }

  /** 音声コマンドの窓に出すもの: このキャラクターの声のコマンドと、用意してあるコマンド */
  private commandsWindowContent(): CommandsWindowContent {
    const ja = this.isJapanese;
    const name = this.name ?? "";
    const plain = (caption: string) => caption.replace(/&(.)/g, "$1");
    const mine = this.commands
      .list()
      .filter((c) => c.enabled && c.voice && (c.voiceCaption || c.caption))
      .map((c) => ({ caption: plain(c.voiceCaption || c.caption), hint: c.voice }));
    const sections = [
      {
        caption: this.commands.voiceCaption || this.commands.caption || (ja ? `${name}のコマンド` : `${name} commands`),
        items: mine.length ? mine : [{ caption: ja ? "(声のコマンドはありません)" : "(no voice commands)" }],
      },
    ];
    if (this.commands.globalVoiceCommandsEnabled) {
      sections.push({
        caption: ja ? "全体のコマンド" : "Global Commands",
        items: [
          { caption: ja ? "音声コマンドを閉じる" : "Close Voice Commands Window", hint: ja ? "「コマンドを閉じて」" : '"close commands window"' },
          { caption: ja ? `${name}を隠す` : `Hide ${name}`, hint: ja ? "「隠れて」" : `"hide ${name}"` },
        ],
      });
    }
    const status = this.srStatus;
    return {
      title: ja ? "音声コマンド" : "Voice Commands",
      closeLabel: ja ? "閉じる" : "Close",
      notice: status === 0 ? undefined : ja ? `音声認識が使えません (srStatus: ${status})` : `Speech input is not available (srStatus: ${status})`,
      sections,
    };
  }

  private onListenStart(mode: ListenMode) {
    this.commandsWindow.refresh();
    this.emit("listenstart", { mode });
    this.showListeningTip();
    // 聞き取りキーのときは Listening の状態のアニメーション (listen() では、本家と同じく自動では再生しない)
    if (mode === "key") this.playListenState("Listening");
  }

  private onListenEnd(cause: ListenCause) {
    if (this.listenAnimation && !this.queue.busy && !this.hidden) void this.player.playReturn();
    this.listenAnimation = false;
    // 聞こえた文を出している途中なら、それが消えるまで出しておく
    if (this.tipTimer === undefined) this.tip.hide();
    this.emit("listencomplete", { cause });
  }

  /** 聞き取りのための状態のアニメーション (Listening / Hearing) を再生する。命令やしゃべりの途中なら、邪魔しない */
  private playListenState(state: "Listening" | "Hearing") {
    if (this.hidden || this.queue.busy || this.speaking) return;
    const name = stateAnimation(this.character, state, []);
    if (!name) return;
    this.listenAnimation = true;
    void this.player.play(name, { hold: true });
  }

  /** 1 つ言い終えた: 声のコマンドと照らし合わせ、command イベントで知らせる */
  private onHeard(alternatives: HeardAlternative[]) {
    const matches = this.commands.matchVoice(alternatives, this.globalVoiceCommands);
    const best: VoiceMatch | undefined = matches[0];
    const heard = alternatives[0]!;
    // ヘルプモードなら、選ばれたコマンドのヘルプを知らせる (コマンドは実行しない)
    if (this.helpMode && best) {
      this.showHeardTip(best, heard.transcript);
      if (best.global === "hide") return this.completeHelp("", "hide");
      if (best.global === "openCommands") return this.completeHelp("", "openCommandsWindow");
      if (best.global === "closeCommands") return this.completeHelp("", "closeCommandsWindow");
      return this.completeHelp(best.name, "command", best.command?.helpContextId);
    }
    this.emit("command", {
      name: best?.name ?? "",
      source: "voice",
      confidence: best?.confidence ?? Math.round(heard.confidence * 100),
      voice: best?.voice ?? heard.transcript,
      count: matches.length,
      alternatives: matches.slice(1).map(({ name, confidence, voice }) => ({ name, confidence, voice })),
    });
    this.showHeardTip(best, heard.transcript);
    if (best?.global === "hide") void this.queueHide(false, undefined, { immediate: true }, "user");
    if (best?.global === "openCommands") this.commandsWindow.visible = true;
    if (best?.global === "closeCommands") this.commandsWindow.visible = false;
  }

  /** 聞き取りのヒントの 1 行目 */
  private tipTitle(listening: boolean): string {
    const name = this.name ?? "";
    if (this.isJapanese) return `-- ${name}${listening ? "が聞いています" : "は聞いていません"} --`;
    return `-- ${name} is ${listening ? "" : "not "}listening --`;
  }

  /** 聞いている間のヒント: 何のコマンドを聞いているか */
  private showListeningTip() {
    if (!this.listeningTip || this.hidden) return;
    window.clearTimeout(this.tipTimer);
    this.tipTimer = undefined;
    const caption = this.commands.voiceCaption ?? this.commands.caption;
    const body = this.isJapanese
      ? caption ? `「${caption}」のコマンドをどうぞ` : "コマンドをどうぞ"
      : caption ? `for "${caption}" commands` : "for commands";
    this.tip.show(this.tipTitle(true), body);
  }

  /** 聞こえた文をヒントに出す (しばらくしたら、聞いていれば聞いている表示に戻し、いなければ消す) */
  private showHeardTip(best: VoiceMatch | undefined, transcript: string) {
    if (!this.listeningTip || this.hidden) return;
    const ja = this.isJapanese;
    const low = best?.command?.confidence !== undefined && best.confidence <= best.command.confidence;
    const body =
      low && best?.command?.confidenceText ? best.command.confidenceText
      : best ? (ja ? `「${best.voice}」と聞こえました` : `Heard "${best.voice}"`)
      : ja ? `「${transcript}」は分かりませんでした` : `Didn't understand "${transcript}"`;
    window.clearTimeout(this.tipTimer);
    this.tip.show(this.tipTitle(this.listener.mode === "key"), body);
    this.tipTimer = window.setTimeout(() => {
      this.tipTimer = undefined;
      if (this.listener.listening) this.showListeningTip();
      else this.tip.hide();
    }, HEARD_TIP_MS);
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
    this.tip?.reposition();
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
    this.tip.reposition();
  }

  /** すぐ移り、move を知らせる (left / top の代入) */
  private moveNow(x: number, y: number) {
    this.setPosition(x, y);
    this.emit("move", { ...this.position, by: "moveTo" });
  }

  /**
   * (x, y) がキャラクターから見てどちらか。
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
        if (request?.interruptRequested || request?.done) return resolve();
        const t = Math.min(1, (now - start) / duration);
        this.setPosition(r.left + (x - r.left) * t, r.top + (y - r.top) * t);
        if (t < 1 && !this.destroyed) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  private listenTo(target: EventTarget, type: string, handler: (e: Event) => void, options: boolean | AddEventListenerOptions = false) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}
