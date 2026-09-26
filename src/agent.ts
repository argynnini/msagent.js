import { AcfCharacter, isAcfFile, type AcfOptions } from "./acf/reader.js";
import { AcsPlayer } from "./acs/player.js";
import { AcsCharacter } from "./acs/reader.js";
import { ActCharacter, isActFile } from "./act/reader.js";
import { audioOutput, registerAudioClient } from "./audio.js";
import { animateCandidates, findAnimation, restFrame, stateAnimation, thinkingAnimation } from "./animations.js";
import { Balloon } from "./balloon.js";
import { DEFAULT_BALLOON_STYLE, type BalloonStyle, type Character } from "./character.js";
import { AgentCommands, type GlobalVoiceCommand, type VoiceMatch } from "./commands.js";
import { CommandsWindow, type CommandsWindowContent } from "./commandswindow.js";
import {
  pointerDetail,
  type AgentEventListener,
  type AgentEventMap,
  type HelpCause,
  type MoveCause,
  type VisibilityCause,
} from "./events.js";
import { IdleController, isIdleAnimation } from "./idle.js";
import { languageTag, type Language } from "./language.js";
import {
  Listener,
  recognitionClass,
  type HeardAlternative,
  type ListenCause,
  type ListenMode,
  type SrStatus,
} from "./listen.js";
import { ListeningTip } from "./listentip.js";
import { PopupMenu, type MenuEntry } from "./menu.js";
import { attachPointerInput } from "./pointer.js";
import { RequestQueue, type Task } from "./queue.js";
import { AgentRequestError, RequestError, type AgentRequest, type RequestType } from "./request.js";
import { Speaker } from "./speak.js";
import { injectStyles } from "./styles.js";
import { Talk } from "./talk.js";
import { TaskbarIcon } from "./taskbar.js";
import { findVoice, pickVoice, voiceParams, type SpeakParams } from "./voice.js";

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
} from "./events.js";
export type { ListenCause, ListenMode, SrStatus } from "./listen.js";

/** Options for {@link Agent} and `msagent.load()`. */
export interface AgentOptions {
  /** Element the character is placed in. Default: `document.body`. */
  container?: HTMLElement;
  /**
   * Play the character's sound effects. Default: `true`.
   * Browsers block audio until the user has interacted with the page once.
   */
  sound?: boolean;
  /** Read `speak()` text aloud with speech synthesis. Default: `true`. If `false`, only the balloon and mouth move. */
  voice?: boolean;
  /**
   * Interpret speech output tags in `speak()` / `think()` text (such as `\Pau=500\` or SAPI 5 `<silence/>`).
   * Default: `true`. If `false`, tags are spoken and shown as plain text. Same as {@link Agent.tags}.
   * (msagent.js extension)
   */
  tags?: boolean;
  /** Play idle animations from time to time while the character is doing nothing. Default: `true`. */
  idle?: boolean;
  /**
   * Language for `name` / `description` and speech: a BCP 47 tag (`"ja"`, `"en-US"`) or a Windows language ID
   * (`0x0411`). A list is tried in order. Default: the browser's languages.
   */
  language?: Language | readonly Language[];
  /** Display scale. Default: `1` (the size in the character file). */
  scale?: number;
  /**
   * Balloon appearance. Only the given properties are layered over the character file's settings.
   * Same as {@link Agent.balloonStyle}.
   */
  balloon?: Partial<BalloonStyle>;
  /** Show the popup menu when the character is right-clicked. Default: `true`. Same as Microsoft Agent's `AutoPopupMenu`. */
  autoPopupMenu?: boolean;
  /**
   * Listening key: voice commands are recognized while this key is held down. A `KeyboardEvent` `key` or `code`
   * (e.g. `"ScrollLock"`, `"F8"`). Default: none (listen only via `listen()`). Same as Microsoft Agent's Listening key.
   */
  listeningKey?: string;
  /**
   * Seconds to keep listening after the listening key is released. Default: `0` (stop immediately).
   * If the user is in the middle of speaking, listening continues until they finish.
   * Same as Microsoft Agent's Listening key time-out (whose default is 2).
   */
  listeningKeyTimeout?: number;
  /** Show the Listening Tip under the character while listening. Default: `true`. */
  listeningTip?: boolean;
  /**
   * Turn request failures into exceptions. Default: `false` (Microsoft Agent's `RaiseRequestErrors` defaults to
   * `true`). If `true`, awaiting a failed request rejects with {@link AgentRequestError}, and calls that fail up
   * front (such as `play()` with an unknown animation) throw.
   */
  raiseRequestErrors?: boolean;
  /**
   * Show a taskbar icon at the bottom right of the page. Default: `false`. Clicking it shows a hidden character;
   * right-clicking opens the popup menu. Same as Microsoft Agent's Character Taskbar Icon.
   */
  taskbarIcon?: boolean;
  /**
   * Voice used for speech: the `voiceURI` or name of a browser voice. Default: chosen from the language and the
   * character's voice gender. Same as Microsoft Agent's `TTSModeID`.
   */
  ttsModeId?: string;
  /**
   * Language for speech recognition (`listen()` and the listening key): a BCP 47 tag such as `"ja-JP"`. Default: the
   * speech language ({@link AgentOptions.language}, or the browser's language). Same as Microsoft Agent's `SRModeID`.
   */
  srModeId?: string;
}

/** The second argument of {@link Agent.speak}. `true` / `false` is the same as `{ hold }`. */
export interface SpeakOptions {
  /** Keep the balloon open after speaking, and do not start the next request until `closeBalloon()` is called. */
  hold?: boolean;
  /**
   * Speak with an audio file instead of speech synthesis (any format the browser can play, such as .wav or .mp3).
   * The mouth follows the audio volume and `text` is shown in the balloon (`\Mrk\` bookmarks still work).
   * Same as the `Url` argument of Microsoft Agent's `Speak`.
   */
  url?: string | URL | Blob | ArrayBuffer;
  /** Read aloud for this call only. Default: {@link Agent.voice}. If `false`, only the balloon and mouth move. */
  voice?: boolean;
  /** Interpret speech output tags for this call only. Default: {@link Agent.tags}. */
  tags?: boolean;
}

/** The second argument of {@link Agent.think}. */
export interface ThinkOptions {
  /**
   * Read the text aloud (and move the mouth) while keeping the thought balloon. Speech output tags work too.
   * (msagent.js extension; Microsoft Agent's `Think` is always silent)
   */
  voice?: boolean;
  /** Interpret speech output tags for this call only. Default: {@link Agent.tags}. */
  tags?: boolean;
}

/** Options for {@link Agent.hide}. */
export interface HideOptions {
  /**
   * Discard the queue and hide right away. By default (`false`) the request is queued like in Microsoft Agent,
   * and the character hides after the earlier requests finish.
   */
  immediate?: boolean;
}

/** Options for {@link Agent.stop}, {@link Agent.stopAll} and {@link Agent.stopCurrent}. */
export interface StopOptions {
  /**
   * Cut the animation where it is, without playing its exit branch, and return to the rest pose.
   * By default (`false`) the animation follows its exit branch and ends naturally, like in Microsoft Agent.
   */
  immediate?: boolean;
}

/**
 * Request kinds for {@link Agent.stopAll}. `"play"` includes `gestureAt`, `"speak"` includes `think`, and `"move"`
 * is `moveTo`. Same as Microsoft Agent's `StopAll`.
 */
export type StopType = "play" | "speak" | "move";

const STOP_TYPES: Record<RequestType, StopType | undefined> = {
  play: "play",
  gestureAt: "play",
  speak: "speak",
  think: "speak",
  moveTo: "move",
  show: undefined,
  hide: undefined,
  delay: undefined,
  wait: undefined,
  interrupt: undefined,
  get: undefined,
};

/** What {@link Agent.get} loads. Case-insensitive. Same as the `Type` argument of Microsoft Agent's `Get`. */
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
const CLOSE_COMMANDS_VOICE =
  "(close [the] commands [window] | (コマンド | こまんど) [の] [一覧] [を] (閉じて | とじて))";

/** 聞き取りのヒントに、聞こえた文を出しておく時間 (ms) */
const HEARD_TIP_MS = 3000;

/** 隠れているときの speak / think の失敗の理由 */
const HIDDEN = "The character is hidden";

/**
 * Parses a character file, detecting the format from its contents: ACS or ACF (Microsoft Agent) or ACT
 * (Office 97 Assistant). For ACF, `options.baseUrl` is the URL the animation (.aca) file names are resolved against.
 *
 * @param data - The contents of the character file.
 * @throws If the data is not a supported character file.
 */
export function parseCharacter(data: ArrayBuffer, options: AcfOptions = {}): Character {
  if (isAcfFile(data)) return new AcfCharacter(data, options);
  return isActFile(data) ? new ActCharacter(data) : new AcsCharacter(data);
}

/** "A|B|C" のように | で区切った候補から、1 つをランダムに選ぶ (本家の Speak / Think と同じ) */
function pickAlternative(text: string): string {
  const alternatives = text.split("|");
  return alternatives[Math.floor(Math.random() * alternatives.length)]!;
}

/** 手前に出すときの z-index (出すたびに増やす) と、いちばん手前のキャラクター (入力を受け取る。本家の入力アクティブ) */
let zIndexCounter = 1000;
let topmost: Agent | undefined;
/** 破棄していないキャラクター (手前のキャラクターが隠れたときに、次を選ぶ) */
const agents = new Set<Agent>();

/**
 * One character on the page.
 *
 * Like in Microsoft Agent, `show` / `hide` / `play` / `speak` / `think` / `moveTo` / `gestureAt` / `delay` /
 * `wait` / `interrupt` / `get` are queued and run one at a time, each after the previous one finishes.
 * Each returns an {@link AgentRequest}, which can be awaited.
 *
 * Usually created with `msagent.load()`; construct it directly when you already have a parsed {@link Character}.
 *
 * ```js
 * const agent = await msagent.load("merlin.acs");
 * agent.show();
 * agent.play("Greet");
 * await agent.speak("Hello!");
 * ```
 */
export class Agent extends EventTarget {
  /** The character's element (`div.msagent`), which contains {@link Agent.canvas}. */
  readonly element: HTMLDivElement;
  /** The canvas the character is drawn on. */
  readonly canvas: HTMLCanvasElement;
  /** The animation player that draws frames and plays sound effects. */
  readonly player: AcsPlayer;
  /** Read `speak()` text aloud with speech synthesis. See {@link AgentOptions.voice}. */
  voice: boolean;
  /** Interpret speech output tags in `speak()` / `think()` text. See {@link AgentOptions.tags}. */
  tags: boolean;
  private currentLanguage: Language | readonly Language[] | undefined;
  /** Commands shown in the popup menu and recognized by voice. Same as Microsoft Agent's `Commands`. */
  readonly commands = new AgentCommands();
  /**
   * The Voice Commands Window, listing the commands that can be spoken now. Open or close it with `visible`;
   * call `refresh()` after changing commands while it is open. Same as Microsoft Agent's `CommandsWindow`.
   */
  readonly commandsWindow: CommandsWindow;
  /** Show the popup menu when the character is right-clicked. Same as Microsoft Agent's `AutoPopupMenu`. */
  autoPopupMenu: boolean;
  /** Listening key (`KeyboardEvent` `key` or `code`, e.g. `"ScrollLock"`), or `undefined` for none. See {@link AgentOptions.listeningKey}. */
  listeningKey: string | undefined;
  /** Seconds to keep listening after the listening key is released. See {@link AgentOptions.listeningKeyTimeout}. */
  listeningKeyTimeout: number;
  /** Show the Listening Tip while listening. */
  listeningTip: boolean;
  /** Turn request failures into exceptions. See {@link AgentOptions.raiseRequestErrors}. */
  raiseRequestErrors: boolean;
  /**
   * Number passed in `helpcomplete` when Help mode ends by clicking or dragging the character.
   * Same as Microsoft Agent's `HelpContextID`.
   */
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
  /** 代入した名前・紹介文 (undefined ならキャラクターファイルのもの) */
  private customName: string | undefined;
  private customDescription: string | undefined;
  private taskbar: TaskbarIcon | undefined;
  /** 代入した声 (voiceURI か名前。undefined なら言語と性別から選ぶ) */
  private ttsVoice: string | undefined;
  /** 代入した聞き取りの言語 (undefined なら読み上げと同じ言語) */
  private srLanguage: string | undefined;
  private readonly cleanups: (() => void)[] = [];

  /**
   * @param character - A parsed character (see {@link parseCharacter}).
   * @param options - Initial settings.
   */
  constructor(
    /** The parsed character file. */
    readonly character: Character,
    options: AgentOptions = {},
  ) {
    super();
    agents.add(this);
    injectStyles();
    this.element = document.createElement("div");
    this.element.className = "msagent";
    // スクリーンリーダーには、名前の付いた 1 枚の絵として見せる
    this.element.setAttribute("role", "img");
    this.element.style.display = "none";
    this.canvas = document.createElement("canvas");
    this.element.append(this.canvas);
    this.player = new AcsPlayer(character, this.canvas);
    this.player.soundEnabled = options.sound ?? true;
    this.voice = options.voice ?? true;
    this.tags = options.tags ?? true;
    this.currentLanguage = options.language;
    this.autoPopupMenu = options.autoPopupMenu ?? true;
    this.listeningKey = options.listeningKey;
    this.listeningKeyTimeout = options.listeningKeyTimeout ?? 0;
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
    (options.container ?? document.body).append(
      this.element,
      this.balloon.element,
      this.balloon.live,
      this.tip.element,
    );

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
      lang: () => this.recognitionLanguage,
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
    this.taskbarIcon = options.taskbarIcon ?? false;
    this.refreshLabel();
    this.ttsVoice = options.ttsModeId || undefined;
    this.srLanguage = options.srModeId || undefined;

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
      if (!this.hidden && (before.x !== after.x || before.y !== after.y))
        this.emit("move", { ...after, by: "reposition" });
    });
    // 聞き取りキー: 押している間聞く (いちばん手前のキャラクターだけ)
    this.listenTo(window, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (!this.isListeningKey(k) || !this.active) return;
      k.preventDefault();
      if (!k.repeat) this.listener.start("key");
    });
    this.listenTo(window, "keyup", (e) => {
      if (this.isListeningKey(e as KeyboardEvent)) this.listener.releaseKey(this.listeningKeyTimeout * 1000);
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
   * Shows the character, playing the animation assigned to its Showing state (usually `Show`). Queued.
   *
   * @param fast - Show right away without the animation.
   */
  show(fast?: boolean): AgentRequest {
    return this.queueShow(fast, "program");
  }

  private queueShow(fast: boolean | undefined, cause: VisibilityCause): AgentRequest {
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
      this.emit("show", { cause });
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
   * Hides the character after playing the animation assigned to its Hiding state (usually `Hide`).
   * Queued like in Microsoft Agent, so the character hides after the earlier requests finish;
   * pass `{ immediate: true }` to hide right away.
   *
   * @param fast - Hide without the animation.
   * @param callback - Called once the character is hidden.
   */
  hide(fast?: boolean, callback?: () => void, options: HideOptions = {}): AgentRequest {
    return this.queueHide(fast, callback, options, "program");
  }

  /**
   * Plays an animation. Queued. The final pose (pointing, looking, etc.) is held until the next animation, and the
   * return animation is played just before that.
   *
   * @param animation - Animation name (case-insensitive).
   * @param timeout - Milliseconds after which a looping animation is ended through its exit branch. `0` means no limit.
   * @param callback - Called when the animation finishes.
   * @returns `false` if the character has no such animation (throws instead with `raiseRequestErrors`).
   */
  play(animation: string, timeout = DEFAULT_TIMEOUT_MS, callback?: () => void): AgentRequest | false {
    const name = findAnimation(this.character, animation);
    if (!name) return this.fail(RequestError.animationNotFound, `Animation not found: ${animation}`);
    return this.enqueue("play", (complete) => this.runPlay(name, timeout, callback, complete));
  }

  /**
   * Plays a random non-idle animation (what double-clicking the character does).
   *
   * @returns `false` if there is no animation to choose from.
   */
  animate(): AgentRequest | false {
    const names = animateCandidates(this.character);
    const name = names[Math.floor(Math.random() * names.length)];
    return name !== undefined && this.play(name);
  }

  /** Names of all the character's animations. */
  animations(): string[] {
    return [...this.character.animations.keys()];
  }

  /** Whether the character has an animation with this name (case-insensitive). */
  hasAnimation(name: string): boolean {
    return findAnimation(this.character, name) !== undefined;
  }

  /**
   * Speaks text in a word balloon, reading it aloud when {@link Agent.voice} is `true`. Queued.
   * Fails while the character is hidden.
   *
   * The text may contain speech output tags (see {@link parseSpeechTags}), and `"A|B|C"` picks one alternative at
   * random, like Microsoft Agent.
   *
   * @param options - `true` / `false` is the same as `{ hold }`.
   */
  speak(text: string, options?: boolean | SpeakOptions): AgentRequest {
    text = pickAlternative(text);
    const { hold, url, voice, tags } =
      typeof options === "object" ? options : { hold: options, url: undefined, voice: undefined, tags: undefined };
    return this.enqueue("speak", (complete) => {
      // 隠れている間は、吹き出しも声も出せない (本家も隠れたキャラクターは音を出せず、失敗になる)
      if (this.hidden) return complete("failed", HIDDEN, RequestError.hidden);
      const gen = this.queue.generation;
      void this.talk.speak(
        text,
        { hold: !!hold, url, voice, tags: tags ?? this.tags },
        complete,
        () => gen !== this.queue.generation,
      );
    });
  }

  /**
   * Shows text in a thought balloon, without speech or mouth movement. Queued. Same as Microsoft Agent's `Think`.
   *
   * The text appears at the pace of the character's speaking speed; the next request starts once it is all shown,
   * and the balloon closes shortly after. With `{ voice: true }` the text is read aloud in the thought balloon.
   * Fails while the character is hidden.
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

  /** Closes the balloon, stopping speech if it is in progress. */
  closeBalloon(): void {
    this.talk.close();
  }

  /**
   * Points toward a position on the page, playing the animation assigned to the `Gesturing*` state for that direction
   * (falling back to `Gesture*`, then `Look*`). Queued; the direction is decided when the request starts.
   *
   * @param x - Viewport x in CSS pixels (like `clientX`).
   * @param y - Viewport y in CSS pixels (like `clientY`).
   * @returns `false` if the character has no gesture animations (throws instead with `raiseRequestErrors`).
   */
  gestureAt(x: number, y: number): AgentRequest | false {
    if (!DIRECTIONS.some((d) => this.gestureAnimation(d)))
      return this.fail(RequestError.stateNotFound, "The character has no gesture animations");
    return this.enqueue("gestureAt", (complete) => {
      const name = this.gestureAnimation(this.direction(x, y));
      if (!name) return complete("failed", "No gesture animation for that direction", RequestError.stateNotFound);
      this.runPlay(name, DEFAULT_TIMEOUT_MS, undefined, complete);
    });
  }

  /**
   * Moves the character's top-left corner to a position. Queued.
   * If the character has `Moving*` / `Move*` animations, it plays the start of the animation, slides holding the last
   * frame, then plays the return animation, like Microsoft Agent. While hidden, it moves instantly.
   *
   * @param x - Left in CSS pixels from the viewport's left edge.
   * @param y - Top in CSS pixels from the viewport's top edge.
   * @param duration - Milliseconds the slide takes. `0` moves instantly.
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

  /**
   * Waits before the next request. Queued.
   *
   * @param time - Milliseconds to wait.
   */
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
   * Holds this character's queue until another character's request finishes. Same as Microsoft Agent's `Wait`.
   * Use it for conversations between characters. Waiting for this character's own request fails.
   *
   * ```js
   * const q = genie.speak("Why did the chicken cross the road?");
   * robby.wait(q);
   * robby.speak("I don't know.");
   * ```
   */
  wait(request: AgentRequest): AgentRequest {
    return this.enqueue("wait", (complete) => {
      // 自分の命令を待つと、順番によっては終わらなくなる (本家もできない)
      if (request.agent === this)
        return complete("failed", "An agent cannot wait for its own request", RequestError.waitSelf);
      if (request.done) return complete();
      void request.then(
        () => complete(),
        () => complete(),
      );
      this.queue.onAbort(() => complete());
    });
  }

  /**
   * When its turn comes, stops another character's request. Same as Microsoft Agent's `Interrupt`.
   * A running request is ended and that character moves on to its next request; a queued one is removed.
   * The rest of the other character's queue is kept. Interrupting this character's own request fails; use `stop()`.
   */
  interrupt(request: AgentRequest): AgentRequest {
    return this.enqueue("interrupt", (complete) => {
      if (request.agent === this)
        return complete("failed", "An agent cannot interrupt its own request (use stop)", RequestError.interruptSelf);
      request.agent.stop(request);
      complete();
    });
  }

  /**
   * Loads animations, states or sound files ahead of time. Same as Microsoft Agent's `Get`.
   *
   * For .acf characters, animation data (.aca) is downloaded; the request fails if it cannot be.
   * .acs / .act files are already fully loaded, so this only checks that the animations or states exist.
   * `"wavefile"` fetches the URL (into the browser cache) so that a later `speak(text, { url })` starts faster.
   *
   * @param name - One name, or several separated by commas.
   * @param queue - Queue the request (default). If `false`, it runs right away.
   *
   * ```js
   * agent.get("animation", "Wave, Greet");
   * agent.get("state", "Gesturing"); // all of GesturingDown / Left / Right / Up
   * agent.get("wavefile", "hello.wav", false);
   * ```
   */
  get(type: GetType, name: string, queue = true): AgentRequest {
    const task: Task = (complete) =>
      void this.runGet(type, name).then(([description, number]) =>
        number ? complete("failed", description, number) : complete(),
      );
    return queue ? this.enqueue("get", task) : this.queue.runNow("get", task);
  }

  /**
   * Ends the current animation naturally through its exit branch (with `{ immediate: true }`, cuts it where it is).
   * If the character is speaking, the balloon closes when it finishes. The queue is not touched.
   */
  stopCurrent(options: StopOptions = {}): void {
    this.endAnimation(options);
    this.talk.stopCurrent();
  }

  /**
   * Discards the whole queue, ends the current animation and closes the balloon.
   * A Show or Hide animation in progress still plays to the end, like Microsoft Agent.
   *
   * @param request - Stop only this request: a running one is ended and the next one starts; a queued one is removed.
   * @param options - `{ immediate: true }` cuts the animation where it is instead of playing its exit branch.
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
   * Stops requests by kind. Same as Microsoft Agent's `StopAll`.
   *
   * @param types - Kinds to stop. If omitted, everything stops, including a Show or Hide animation in progress.
   * @param options - `{ immediate: true }` cuts the animation where it is.
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

  /** Pauses the animation. */
  pause(): void {
    this.player.pause();
  }

  /** Resumes an animation paused with {@link Agent.pause}. */
  resume(): void {
    this.player.resume();
  }

  /** Moves the character (and its balloon) back inside the viewport. Done automatically when the window is resized. */
  reposition(): void {
    if (this.element.style.display === "none") return;
    const r = this.element.getBoundingClientRect();
    this.setPosition(r.left, r.top);
  }

  // --- msagent.js で足したもの ---

  /**
   * Display scale (`1` = the size in the character file). Changing it keeps the bottom center in place and fires
   * `resize`. Enlarged images are scaled without smoothing so the pixel art stays sharp. (msagent.js extension)
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
   * The balloon appearance in use: the character file's settings plus any overrides.
   * Assigning layers only the given properties over the character file's settings; `undefined` or `{}` restores them.
   * (msagent.js extension)
   *
   * ```js
   * agent.balloonStyle = { background: "#222", foreground: "#fff", fontSize: 16 };
   * agent.balloonStyle = { ...agent.balloonStyle, border: "red" }; // add to the current style
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

  /** Displayed width in CSS pixels. Assigning resizes the character, keeping its aspect ratio. Same as Microsoft Agent's `Width`. */
  get width(): number {
    return Math.round(this.character.width * this.currentScale);
  }

  set width(px: number) {
    this.scale = px / this.character.width;
  }

  /** Displayed height in CSS pixels. Assigning resizes the character, keeping its aspect ratio. Same as Microsoft Agent's `Height`. */
  get height(): number {
    return Math.round(this.character.height * this.currentScale);
  }

  set height(px: number) {
    this.scale = px / this.character.height;
  }

  /**
   * The character's name, in {@link Agent.language}. Also used in the Listening Tip, the "hide" voice command and the
   * taskbar icon. Assign to change it; assign `undefined` to go back to the name in the character file.
   * Same as Microsoft Agent's `Name`.
   */
  get name(): string | undefined {
    return this.customName ?? this.character.getName(this.language);
  }

  set name(name: string | undefined) {
    this.customName = name;
    this.refreshLabel();
  }

  /** Language for `name` / `description` and speech. `undefined` uses the browser's languages. See {@link AgentOptions.language}. */
  get language(): Language | readonly Language[] | undefined {
    return this.currentLanguage;
  }

  set language(language: Language | readonly Language[] | undefined) {
    this.currentLanguage = language;
    this.refreshLabel();
  }

  /**
   * Voice used for speech. Same as Microsoft Agent's `TTSModeID`.
   *
   * Assign the `voiceURI` or name of a browser voice (`speechSynthesis.getVoices()`) to use it, except in parts whose
   * language or gender is changed with speech output tags. Assign `undefined` or `""` to go back to choosing a voice
   * from the language and the character's voice gender (the default). If the assigned voice is not found, the default
   * choice is used; assignment is not validated because browsers may load their voice list later.
   *
   * Reading returns the `voiceURI` of the voice in use, or `""` when speech is off (`voice` or
   * `audioOutput.enabled` is `false`), unsupported, or no voice matches.
   */
  get ttsModeId(): string {
    if (!this.voice || !audioOutput.enabled || typeof speechSynthesis === "undefined") return "";
    const voices = speechSynthesis.getVoices();
    const fixed = this.ttsVoice ? findVoice(voices, this.ttsVoice) : undefined;
    const lang = this.speechLanguage ?? (typeof navigator === "undefined" ? "en-US" : navigator.language);
    return (fixed ?? pickVoice(voices, lang, this.character.voice.gender))?.voiceURI ?? "";
  }

  set ttsModeId(id: string | undefined) {
    this.ttsVoice = id || undefined;
  }

  /**
   * Language for speech recognition, as a BCP 47 tag. Same as Microsoft Agent's `SRModeID`.
   *
   * Browsers do not let pages choose a recognition engine, so this picks the language instead. Assign a tag such as
   * `"en-US"` to listen in that language while speaking in another; assign `undefined` or `""` to go back to the speech
   * language ({@link Agent.language}, or the browser's language). Takes effect the next time listening starts.
   *
   * Reading returns the language used for listening, or `""` when the browser has no speech recognition.
   */
  get srModeId(): string {
    return recognitionClass() ? this.recognitionLanguage : "";
  }

  set srModeId(id: string | undefined) {
    this.srLanguage = id || undefined;
  }

  /**
   * The character's description, in {@link Agent.language}. Assign to change it; assign `undefined` to go back to the
   * description in the character file. Same as Microsoft Agent's `Description`.
   */
  get description(): string | undefined {
    return this.customDescription ?? this.character.getDescription(this.language);
  }

  set description(description: string | undefined) {
    this.customDescription = description;
  }

  /**
   * Show a taskbar icon at the bottom right of the page. Same as Microsoft Agent's Character Taskbar Icon.
   *
   * Hovering shows the name; clicking shows the character (or brings it to the front); right-clicking opens the popup
   * menu (only Show and the Voice Commands Window item while hidden). Clicks on the icon also fire `click` /
   * `dblclick` with `detail.source === "taskbarIcon"`.
   */
  get taskbarIcon(): boolean {
    return this.taskbar !== undefined;
  }

  set taskbarIcon(on: boolean) {
    if (on === this.taskbarIcon || (on && this.destroyed)) return;
    if (!on) {
      this.taskbar!.destroy();
      this.taskbar = undefined;
      return;
    }
    this.taskbar = new TaskbarIcon({
      character: this.character,
      title: () => this.name ?? "",
      click: (e) => this.onTaskbarClick(e),
      dblclick: (e) => this.emit("dblclick", pointerDetail(e, "taskbarIcon")),
      contextmenu: (e) => this.onTaskbarContextMenu(e),
    });
  }

  /** Whether the character is speaking. Also `true` while a balloon is held open by `speak(text, true)`. */
  get speaking(): boolean {
    return this.talk.speaking;
  }

  /**
   * Adds an event listener. The same as `addEventListener`, with types; the event data is in `event.detail`.
   *
   * ```js
   * agent.on("command", (e) => console.log(e.detail.name));
   * ```
   *
   * @returns This agent, for chaining.
   */
  on<K extends keyof AgentEventMap>(type: K, listener: AgentEventListener<K>, options?: AddEventListenerOptions): this {
    this.addEventListener(type, listener as EventListener, options);
    return this;
  }

  /**
   * Removes an event listener added with {@link Agent.on}.
   *
   * @returns This agent, for chaining.
   */
  off<K extends keyof AgentEventMap>(type: K, listener: AgentEventListener<K>): this {
    this.removeEventListener(type, listener as EventListener);
    return this;
  }

  /** Play the character's sound effects. See {@link AgentOptions.sound}. */
  get sound(): boolean {
    return this.player.soundEnabled;
  }

  set sound(on: boolean) {
    this.player.soundEnabled = on;
  }

  /** Whether the character's image covers a point in the viewport (`false` over transparent pixels). */
  hitTest(clientX: number, clientY: number): boolean {
    return this.player.hitTest(clientX, clientY);
  }

  /** Whether the character is visible. Read-only; use `show()` / `hide()`. Same as Microsoft Agent's `Visible`. */
  get visible(): boolean {
    return !this.hidden;
  }

  /**
   * Left edge in CSS pixels from the viewport's left edge. Assigning moves the character instantly.
   * Same as Microsoft Agent's `Left`.
   */
  get left(): number {
    return this.position.x;
  }

  set left(x: number) {
    this.moveNow(x, this.position.y);
  }

  /**
   * Top edge in CSS pixels from the viewport's top edge. Assigning moves the character instantly.
   * Same as Microsoft Agent's `Top`.
   */
  get top(): number {
    return this.position.y;
  }

  set top(y: number) {
    this.moveNow(this.position.x, y);
  }

  /** What last moved the character. Same as Microsoft Agent's `MoveCause`. */
  get moveCause(): MoveCause {
    return this.lastMoveCause;
  }

  /**
   * What last showed or hid the character, or `"none"` if it has never been shown.
   * Same as Microsoft Agent's `VisibilityCause`.
   */
  get visibilityCause(): VisibilityCause | "none" {
    return this.lastVisibilityCause;
  }

  /**
   * Play idle animations automatically. Set to `false` to handle the idle state yourself (`idlestart` / `idlecomplete`).
   * Same as Microsoft Agent's `IdleOn`.
   */
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
   * Whether the balloon is shown. Same as Microsoft Agent's `Balloon.Visible`.
   *
   * Assigning `false` closes it (while speaking, it closes as soon as the speech finishes). Assigning `true` shows the
   * last text again without closing it automatically; this does nothing while hidden or if the character has no balloon.
   */
  get balloonVisible(): boolean {
    return this.balloon.visible;
  }

  set balloonVisible(visible: boolean) {
    if (visible && (this.hidden || !this.balloonStyle.enabled)) return;
    this.talk.setBalloonVisible(visible);
  }

  /** Extra text the character's author stored in the file, in {@link Agent.language}. Same as Microsoft Agent's `ExtraData`. */
  get extraData(): string | undefined {
    return this.character.getExtraData(this.language);
  }

  /** Version of the character file. Same as Microsoft Agent's `Version`. */
  get version(): string | undefined {
    return this.character.version;
  }

  /** The character's GUID. Same as Microsoft Agent's `GUID`. */
  get guid(): string | undefined {
    return this.character.guid;
  }

  /** Width in the character file, in pixels. Same as Microsoft Agent's `OriginalWidth`. */
  get originalWidth(): number {
    return this.character.width;
  }

  /** Height in the character file, in pixels. Same as Microsoft Agent's `OriginalHeight`. */
  get originalHeight(): number {
    return this.character.height;
  }

  /** Speaking speed from the character file, in words per minute. Read-only. Same as Microsoft Agent's `Speed`. */
  get speed(): number | undefined {
    return this.character.voice.speed;
  }

  /** Voice pitch from the character file, in Hz. Read-only. Same as Microsoft Agent's `Pitch`. */
  get pitch(): number | undefined {
    return this.character.voice.pitch;
  }

  /** Alias of {@link Agent.sound}. Same as Microsoft Agent's `SoundEffectsOn`. */
  get soundEffectsOn(): boolean {
    return this.sound;
  }

  set soundEffectsOn(on: boolean) {
    this.sound = on;
  }

  /**
   * Brings the character in front of the others and makes it the one that receives input (fires `activateinput`).
   * Also happens automatically when the character is shown, clicked or dragged. Same as Microsoft Agent's `Activate`.
   *
   * @returns `false` while the character is hidden.
   */
  activate(): boolean {
    if (this.hidden) return false;
    const z = String(++zIndexCounter);
    this.element.style.zIndex = z;
    this.balloon.element.style.zIndex = z;
    this.tip.element.style.zIndex = z;
    Agent.setTopmost(this);
    return true;
  }

  /**
   * いちばん手前のキャラクターを変え、変わったら、前のキャラクターに deactivateinput、新しいキャラクターに activateinput を出す
   * (本家の DeactivateInput / ActivateInput と同じ)
   */
  private static setTopmost(next: Agent | undefined) {
    if (topmost === next) return;
    const previous = topmost;
    topmost = next;
    previous?.emit("deactivateinput", {});
    next?.emit("activateinput", {});
  }

  /**
   * 手前のキャラクターが隠れた・破棄されたら、見えている残りのうち一番手前のものに入力を移す (本家と同じ)。
   * 見えているものが無ければ、どれも入力を受け取らない
   */
  private handOffInput() {
    if (topmost !== this) return;
    let next: Agent | undefined;
    for (const a of agents) {
      if (a === this || a.hidden) continue;
      if (!next || Number(a.element.style.zIndex) > Number(next.element.style.zIndex)) next = a;
    }
    Agent.setTopmost(next);
  }

  /** Whether this is the frontmost visible character, which receives input such as the listening key. */
  get active(): boolean {
    return topmost === this && !this.hidden;
  }

  /**
   * Opens the popup menu at a position in the viewport, listing the {@link Agent.commands} and Hide.
   * Same as Microsoft Agent's `ShowPopupMenu`.
   *
   * @returns `false` while the character is hidden.
   */
  showPopupMenu(x: number, y: number): boolean {
    if (this.hidden || this.destroyed) return false;
    this.openPopupMenu(x, y);
    return true;
  }

  /** メニューを出す。隠れている間は、音声コマンドの窓を開く・閉じる項目と「表示」だけ (本家のタスクバーのアイコンと同じ) */
  private openPopupMenu(x: number, y: number) {
    const entries: MenuEntry[] = [];
    if (this.commands.visible && !this.hidden) {
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
            this.emit("command", {
              name: c.name,
              source: "menu",
              confidence: 100,
              voice: "",
              count: 1,
              alternatives: [],
            });
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
        caption: open
          ? ja
            ? "音声コマンドを閉じる(&C)"
            : "&Close Voice Commands"
          : ja
            ? "音声コマンドを開く(&O)"
            : "&Open Voice Commands",
        enabled: true,
        onSelect: () => {
          if (this.helpMode) return this.completeHelp("", open ? "closeCommandsWindow" : "openCommandsWindow");
          this.commandsWindow.visible = !open;
        },
      });
    }
    // 本家と同じく、キャラクターを隠す (隠れている間は出す) 項目を足す (ユーザーの操作なので、cause は "user")
    if (this.hidden) {
      entries.push({
        kind: "item",
        caption: this.isJapanese ? "表示(&S)" : "&Show",
        enabled: true,
        onSelect: () => void this.queueShow(false, "user"),
      });
    } else {
      entries.push({
        kind: "item",
        caption: this.isJapanese ? "隠す(&H)" : "&Hide",
        enabled: true,
        onSelect: () => {
          if (this.helpMode) return this.completeHelp("", "hide");
          void this.queueHide(false, undefined, { immediate: true }, "user");
        },
      });
    }
    this.menu = new PopupMenu(entries, x, y, {
      fontName: this.commands.fontName,
      fontSize: this.commands.fontSize,
      help: this.helpMode,
    });
    // どのキャラクターよりも手前に出す (キャラクターは手前に出すたびに z-index が増える)
    this.menu.element.style.zIndex = String(++zIndexCounter);
  }

  /**
   * Starts or stops listening for voice commands, using the Web Speech API. Same as Microsoft Agent's `Listen`.
   *
   * `true` listens for up to 10 seconds (extending the time if already listening) and stops after one utterance.
   * What was heard is matched against the `voice` grammars of {@link Agent.commands} and reported with a `command` event.
   *
   * @returns `false` if speech recognition is unavailable, or for `listen(false)` while the listening key is held.
   */
  listen(on: boolean): boolean {
    if (this.destroyed) return false;
    if (on) return this.listener.start("program");
    if (this.listener.mode === "key") return false;
    this.listener.stop("program");
    return true;
  }

  /**
   * Help mode. Same as Microsoft Agent's `HelpModeOn`.
   *
   * While `true`, clicking or dragging the character, choosing a menu item or speaking a voice command fires
   * `helpcomplete` instead of `click` / `dragstart` / `command`, and ends Help mode. The popup menu can still be
   * opened. Setting it to `false` yourself does not fire `helpcomplete`.
   */
  get helpModeOn(): boolean {
    return this.helpMode;
  }

  set helpModeOn(on: boolean) {
    this.helpMode = on;
    this.element.classList.toggle("msagent-help-mode", on);
  }

  /** Whether the character is listening for voice commands. */
  get listening(): boolean {
    return this.listener.listening;
  }

  /**
   * Whether speech input is available, with the same values as Microsoft Agent's `SRStatus`:
   * `0` available, `1` no microphone, `4` no speech recognition in this browser or the service cannot be reached,
   * `5` microphone or speech recognition not permitted, `6` other error.
   * Permission is not known until the first attempt to listen.
   */
  get srStatus(): SrStatus {
    return this.listener.srStatus;
  }

  /**
   * Stops animation, speech and idling, fails the pending requests and removes the character's elements from the page.
   * The agent cannot be used afterwards.
   */
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
    this.handOffInput();
    agents.delete(this);
    this.taskbarIcon = false;
    for (const cleanup of this.cleanups) cleanup();
    this.element.remove();
    this.balloon.element.remove();
    this.balloon.live.remove();
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
  private queueHide(
    fast: boolean | undefined,
    callback: (() => void) | undefined,
    options: HideOptions,
    cause: VisibilityCause,
  ) {
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
      this.handOffInput();
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
    const names = name
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    switch (type.toLowerCase()) {
      case "animation": {
        const missing = names.find((n) => !findAnimation(this.character, n));
        if (missing) return [`Animation not found: ${missing}`, RequestError.animationNotFound];
        return this.prepareAnimations(names.map((n) => findAnimation(this.character, n)!));
      }
      case "state": {
        const missing = names.find((n) =>
          (STATE_GROUPS[n.toLowerCase()] ?? [n]).every((state) => this.character.stateAnimations(state).length === 0),
        );
        if (missing) return [`State has no animations: ${missing}`, RequestError.stateNotFound];
        return this.prepareAnimations(
          names.flatMap((n) =>
            (STATE_GROUPS[n.toLowerCase()] ?? [n]).flatMap((state) => this.character.stateAnimations(state)),
          ),
        );
      }
      case "wavefile":
        for (const url of names) {
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${res.status} ${res.url}`);
            await res.arrayBuffer();
          } catch (e) {
            return [
              `Failed to load sound file: ${e instanceof Error ? e.message : String(e)}`,
              RequestError.invalidSound,
            ];
          }
        }
        return ["", 0];
      default:
        return [`Invalid get() type: ${type}`, RequestError.invalidGetType];
    }
  }

  /** ACF のキャラクターなら、アニメーションのコマ (ACA) を取り寄せる。runGet() と同じ形で結果を返す */
  private async prepareAnimations(names: readonly string[]): Promise<[string, number]> {
    try {
      await this.character.prepare?.(names);
      return ["", 0];
    } catch (e) {
      return [e instanceof Error ? e.message : String(e), RequestError.invalidAnimation];
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

  /** タスクバーのアイコンのクリック: click として知らせ、隠れていれば出す (見えていれば手前に出す) */
  private onTaskbarClick(e: MouseEvent) {
    this.emit("click", pointerDetail(e, "taskbarIcon"));
    if (this.hidden) void this.queueShow(false, "user");
    else this.activate();
  }

  /** タスクバーのアイコンの右クリック: click として知らせ、メニューを出す (autoPopupMenu のとき) */
  private onTaskbarContextMenu(e: MouseEvent) {
    e.preventDefault();
    this.emit("click", pointerDetail(e, "taskbarIcon"));
    if (this.autoPopupMenu && !this.destroyed) this.openPopupMenu(e.clientX, e.clientY);
  }

  /** 止まっているときの絵を描く */
  private drawRestPose() {
    const frame = restFrame(this.character);
    if (frame) this.player.draw(frame);
  }

  /** ヘルプモードを終え、helpcomplete で知らせる (キャラクターなら、キャラクターの helpContextId) */
  private completeHelp(name: string, cause: HelpCause, helpContextId?: number) {
    this.helpModeOn = false;
    this.emit("helpcomplete", {
      name,
      cause,
      helpContextId: cause === "character" ? this.helpContextId : helpContextId,
    });
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
          {
            caption: ja ? "音声コマンドを閉じる" : "Close Voice Commands Window",
            hint: ja ? "「コマンドを閉じて」" : '"close commands window"',
          },
          { caption: ja ? `${name}を隠す` : `Hide ${name}`, hint: ja ? "「隠れて」" : `"hide ${name}"` },
        ],
      });
    }
    const status = this.srStatus;
    return {
      title: ja ? "音声コマンド" : "Voice Commands",
      closeLabel: ja ? "閉じる" : "Close",
      notice:
        status === 0
          ? undefined
          : ja
            ? `音声認識が使えません (srStatus: ${status})`
            : `Speech input is not available (srStatus: ${status})`,
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
      ? caption
        ? `「${caption}」のコマンドをどうぞ`
        : "コマンドをどうぞ"
      : caption
        ? `for "${caption}" commands`
        : "for commands";
    this.tip.show(this.tipTitle(true), body);
  }

  /** 聞こえた文をヒントに出す (しばらくしたら、聞いていれば聞いている表示に戻し、いなければ消す) */
  private showHeardTip(best: VoiceMatch | undefined, transcript: string) {
    if (!this.listeningTip || this.hidden) return;
    const ja = this.isJapanese;
    const low = best?.command?.confidence !== undefined && best.confidence <= best.command.confidence;
    const body =
      low && best?.command?.confidenceText
        ? best.command.confidenceText
        : best
          ? ja
            ? `「${best.voice}」と聞こえました`
            : `Heard "${best.voice}"`
          : ja
            ? `「${transcript}」は分かりませんでした`
            : `Didn't understand "${transcript}"`;
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
    return {
      ...voiceParams(this.character.voice),
      gender: this.character.voice.gender,
      ...(lang ? { lang } : {}),
      ...(this.ttsVoice ? { voice: this.ttsVoice } : {}),
    };
  }

  /** agent.language から決めた読み上げ・吹き出しの言語 (BCP 47)。指定が無ければ undefined */
  private get speechLanguage(): string | undefined {
    const first = Array.isArray(this.language) ? this.language[0] : this.language;
    if (first === undefined) return undefined;
    return typeof first === "number" ? languageTag(first) : first;
  }

  /** 名前が変わったら、スクリーンリーダー向けの名前とタスクバーのアイコンの表示を合わせる */
  private refreshLabel() {
    this.element.setAttribute("aria-label", this.name ?? "");
    this.taskbar?.refresh();
  }

  /** 聞き取りの言語 (srModeId、無ければ読み上げの言語、それも無ければブラウザの言語) */
  private get recognitionLanguage(): string {
    return this.srLanguage ?? this.speechLanguage ?? (typeof navigator === "undefined" ? "en-US" : navigator.language);
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

  private listenTo(
    target: EventTarget,
    type: string,
    handler: (e: Event) => void,
    options: boolean | AddEventListenerOptions = false,
  ) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}
