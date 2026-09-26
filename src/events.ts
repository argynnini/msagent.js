import type { ListenCause, ListenMode } from "./listen.js";
import type { AgentRequest } from "./request.js";

/**
 * Details of a `click` / `dblclick`: the position, the button and the modifier keys.
 * Same idea as the `Button` / `Shift` arguments of Microsoft Agent's `Click`.
 */
export interface PointerDetail {
  /** Viewport x in CSS pixels (`clientX`). */
  x: number;
  /** Viewport y in CSS pixels (`clientY`). */
  y: number;
  /** Which mouse button was pressed. */
  button: "left" | "middle" | "right";
  /** Whether Shift was held. */
  shift: boolean;
  /** Whether Ctrl was held. */
  ctrl: boolean;
  /** Whether Alt was held. */
  alt: boolean;
  /** What was clicked: the character or its taskbar icon (clicks on the icon fire `click` too, like Microsoft Agent). */
  source: "character" | "taskbarIcon";
  /** The original mouse event. */
  originalEvent: MouseEvent;
}

/**
 * What showed or hid the character: the program, or the user (e.g. the popup menu, a voice command or the taskbar icon).
 * Same idea as Microsoft Agent's `VisibilityCause`.
 */
export type VisibilityCause = "program" | "user";

/**
 * What last moved the character: nothing yet, the user dragging it, the program (`moveTo()` / `left` / `top`), or
 * being moved back inside a shrunken viewport. Same idea as Microsoft Agent's `MoveCause`.
 */
export type MoveCause = "none" | "drag" | "moveTo" | "reposition";

/** A runner-up voice command match. Same as Microsoft Agent's `Alt1Name` / `Alt1Confidence` / `Alt1Voice`, etc. */
export interface CommandAlternative {
  /** Name of the matched command. */
  name: string;
  /** Recognition confidence, 0–100. */
  confidence: number;
  /** The text that was heard. */
  voice: string;
}

/**
 * Details of a `command` event. Same idea as the `UserInput` of Microsoft Agent's `Command` event.
 *
 * From the popup menu, `source` is `"menu"`, `confidence` is `100` and `voice` is `""`.
 */
export interface CommandDetail {
  /**
   * Name of the chosen command. For voice input, the best match; `""` if nothing matched or it was one of the
   * built-in global commands (such as "hide").
   */
  name: string;
  /** Whether the command was chosen from the popup menu or by voice. */
  source: "menu" | "voice";
  /** Recognition confidence, 0–100. */
  confidence: number;
  /** The text that was heard. */
  voice: string;
  /** Number of matching commands (`0` if speech matched nothing). */
  count: number;
  /** The second and third best matches. */
  alternatives: CommandAlternative[];
}

/**
 * What was chosen in Help mode. Same idea as the `Cause` of Microsoft Agent's `HelpComplete`.
 *
 * - `"command"`: an item of `agent.commands` (from the menu or by voice)
 * - `"hide"`: Hide
 * - `"character"`: the character was clicked or dragged
 * - `"openCommandsWindow"` / `"closeCommandsWindow"`: opening or closing the Voice Commands Window
 */
export type HelpCause = "command" | "hide" | "character" | "openCommandsWindow" | "closeCommandsWindow";

/** Details of a `helpcomplete` event. */
export interface HelpDetail {
  /** Name of the chosen command, or `""` for built-in items and the character. */
  name: string;
  /** What was chosen. */
  cause: HelpCause;
  /** `helpContextId` of the chosen command (or of the character), to decide which help to show. */
  helpContextId: number | undefined;
}

/** Events fired by an `Agent` (listen with `agent.on()`), and the type of each `event.detail`. */
export interface AgentEventMap {
  /** The character's image was clicked with any button. Not fired after a drag. */
  click: PointerDetail;
  /** The character was double-clicked. Call `event.preventDefault()` to skip the default `animate()`. */
  dblclick: PointerDetail;
  /** The user started dragging the character. `x` / `y` is its top-left corner. */
  dragstart: { x: number; y: number };
  /** The user finished dragging the character. `x` / `y` is its top-left corner. */
  dragend: { x: number; y: number };
  /**
   * The character moved. `by`: `"drag"` (the user), `"moveTo"` (the program), or `"reposition"` (moved back inside a
   * shrunken viewport, like Microsoft Agent does when the screen resolution changes).
   */
  move: { x: number; y: number; by: Exclude<MoveCause, "none"> };
  /** The displayed size changed (`scale` / `width` / `height`). `width` / `height` are in CSS pixels. */
  resize: { width: number; height: number; scale: number };
  /** The character was shown. */
  show: { cause: VisibilityCause };
  /** The character was hidden. */
  hide: { cause: VisibilityCause };
  /** A request (`show`, `play`, `speak`, ...) started. */
  requeststart: { request: AgentRequest };
  /** A request finished; check `request.status` for the result. */
  requestcomplete: { request: AgentRequest };
  /** The balloon opened. */
  balloonshow: Record<string, never>;
  /** The balloon closed. */
  balloonhide: Record<string, never>;
  /**
   * The character became the frontmost one, which receives input such as the listening key. Happens when it is shown,
   * clicked, dragged or `activate()`d. Same as Microsoft Agent's `ActivateInput`.
   */
  activateinput: Record<string, never>;
  /**
   * The character is no longer the frontmost one: another character became active, or this one was hidden or
   * destroyed (input then moves to the frontmost remaining visible character). Same as Microsoft Agent's
   * `DeactivateInput`.
   */
  deactivateinput: Record<string, never>;
  /** The character entered the idle state. Same as Microsoft Agent's `IdleStart`. */
  idlestart: Record<string, never>;
  /** The character left the idle state because a request started. Same as Microsoft Agent's `IdleComplete`. */
  idlecomplete: Record<string, never>;
  /** A command from `agent.commands` was chosen from the popup menu or by voice. Same as Microsoft Agent's `Command`. */
  command: CommandDetail;
  /**
   * In Help mode (`agent.helpModeOn`), the character, a menu item or a voice command was chosen, and Help mode ended.
   * `click` / `dragstart` / `command` are not fired while in Help mode. Same as Microsoft Agent's `HelpComplete`.
   */
  helpcomplete: HelpDetail;
  /** Listening for voice commands started. Same as Microsoft Agent's `ListenStart`. */
  listenstart: { mode: ListenMode };
  /** Listening for voice commands ended. Same as Microsoft Agent's `ListenComplete`. */
  listencomplete: { cause: ListenCause };
  /** An animation started. `idle`: whether it is an idle animation. Return animations count as animations too. */
  animationstart: { name: string; idle: boolean };
  /** An animation ended. `idle`: whether it is an idle animation. */
  animationend: { name: string; idle: boolean };
  /**
   * Speaking started. `text` is the text shown in the balloon (without tags); `thought` is `true` for `think()`.
   */
  speakstart: { text: string; thought: boolean };
  /** Speaking ended, including when it was stopped. */
  speakend: { text: string; thought: boolean };
  /**
   * Speech reached a bookmark (`\Mrk=number\` or SAPI 5 `<bookmark mark="..."/>`). Same as Microsoft Agent's `Bookmark`.
   * `id` is the number (`NaN` for a non-numeric SAPI 5 mark) and `mark` is the text as written.
   */
  bookmark: { id: number; mark: string };
}

/** A listener for an `Agent` event. The data is in `event.detail`. */
export type AgentEventListener<K extends keyof AgentEventMap> = (event: CustomEvent<AgentEventMap[K]>) => void;

/** イベントを出す関数 (cancelable で preventDefault() されたら false) */
export type Emit = <K extends keyof AgentEventMap>(type: K, detail: AgentEventMap[K], cancelable?: boolean) => boolean;

/** マウスのイベントから、click / dblclick の detail を作る */
export function pointerDetail(e: MouseEvent, source: PointerDetail["source"] = "character"): PointerDetail {
  const button = e.button === 1 ? "middle" : e.button === 2 ? "right" : "left";
  return {
    x: e.clientX,
    y: e.clientY,
    button,
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    source,
    originalEvent: e,
  };
}
