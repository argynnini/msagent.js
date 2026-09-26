import type { AcsImage, Animation } from "./acs/reader.js";
import type { Language } from "./language.js";

/**
 * Voice settings stored in a character file (Microsoft Agent's SAPI 4 text-to-speech values).
 * Settings that are missing, or left to the speech engine, are `undefined`.
 */
export interface VoiceSettings {
  /** Speaking speed in words per minute. */
  speed?: number;
  /** Pitch in Hz. */
  pitch?: number;
  /** Language as a BCP 47 tag (e.g. `"en-US"`). */
  language?: string;
  /** Language as a Windows language ID (e.g. `0x0409`). */
  languageId?: number;
  /** Dialect, if any. */
  dialect?: string;
  /** Gender of the voice. */
  gender?: "neutral" | "female" | "male";
  /** Age of the voice. */
  age?: number;
  /** Speaking style (e.g. `"Business"`). */
  style?: string;
  /** GUID of the speech engine (e.g. L&H TruVoice). */
  engine?: string;
  /** GUID of the engine's voice (the TTS mode). */
  mode?: string;
}

/**
 * Word balloon appearance, as set in the Microsoft Agent Character Editor and stored in the character file.
 * Also used to override it with `agent.balloonStyle`.
 */
export interface BalloonStyle {
  /** Number of lines. */
  lines: number;
  /** Characters per line (determines the width unless `width` is set). */
  charsPerLine: number;
  /** Text color (a CSS color, e.g. `"#000000"`). */
  foreground: string;
  /** Background color (a CSS color, e.g. `"#ffffe1"`). */
  background: string;
  /** Border color (a CSS color). */
  border: string;
  /** Font family. */
  fontFamily: string;
  /** Font size in CSS pixels. */
  fontSize: number;
  /** Font weight (`400` normal, `700` bold). */
  fontWeight: number;
  /** Italic text. */
  italic: boolean;
  /** Underlined text. */
  underline: boolean;
  /** Struck-through text. */
  strikethrough: boolean;
  /** Use the balloon. If `false`, `speak()` is voice only and `think()` shows nothing. */
  enabled: boolean;
  /** Fit the height to the text. If `false`, the height is fixed at `lines` lines and overflowing text scrolls up. */
  sizeToText: boolean;
  /**
   * Close the balloon automatically after speaking. If `false`, it stays until the next `speak()` / `think()`,
   * `hide()`, or the character is clicked or dragged.
   */
  autoHide: boolean;
  /** Reveal the words gradually along with the speech. If `false`, the whole text is shown at once. */
  autoPace: boolean;
  /** Balloon width in CSS pixels, including border and padding. Takes precedence over `charsPerLine`. (msagent.js extension) */
  width?: number | undefined;
  /**
   * Balloon height in CSS pixels, including border and padding. Fixes the height (overflowing text scrolls up),
   * taking precedence over `sizeToText` and `lines`. (msagent.js extension)
   */
  height?: number | undefined;
}

/**
 * Default balloon appearance, used when the character file has no balloon settings (such as .act files):
 * light yellow with a black border, like the Office Assistant.
 */
export const DEFAULT_BALLOON_STYLE: Readonly<BalloonStyle> = {
  lines: 2,
  charsPerLine: 28,
  foreground: "#000000",
  background: "#ffffe1",
  border: "#000000",
  fontFamily: "Microsoft Sans Serif",
  fontSize: 13,
  fontWeight: 400,
  italic: false,
  underline: false,
  strikethrough: false,
  enabled: true,
  sizeToText: true,
  autoHide: true,
  autoPace: true,
};

/**
 * A parsed character file. ACS and ACF (Microsoft Agent) and ACT (Office 97 Assistant) characters all have this shape.
 * Create one with `parseCharacter()`, or use `agent.character`.
 */
export interface Character {
  /** Width of the character's frames in pixels. */
  readonly width: number;
  /** Height of the character's frames in pixels. */
  readonly height: number;
  /** Name in the language that best matches the browser's. Use `getName()` to choose the language. */
  readonly name: string | undefined;
  /** Description in the language that best matches the browser's. Use `getDescription()` to choose the language. */
  readonly description: string | undefined;
  /** Languages the name and description are stored in, as BCP 47 tags (e.g. `["en", "ja-JP"]`). May be empty. */
  readonly languages: readonly string[];
  /** Name in the given language, or the closest one available. Default: the browser's languages. */
  getName(language?: Language | readonly Language[]): string | undefined;
  /** Description in the given language, or the closest one available. Default: the browser's languages. */
  getDescription(language?: Language | readonly Language[]): string | undefined;
  /** Extra text the author stored, in the given language or the closest one. Same as Microsoft Agent's `ExtraData`. */
  getExtraData(language?: Language | readonly Language[]): string | undefined;
  /** Version of the character file (e.g. `"2.1"`), if known. Same as Microsoft Agent's `Version`. */
  readonly version: string | undefined;
  /** Balloon appearance stored in the file, if any. */
  readonly balloon: BalloonStyle | undefined;
  /** Animations by name. */
  readonly animations: Map<string, Animation>;
  /** Small icon for the taskbar / system tray, if any. */
  readonly trayIcon: AcsImage | undefined;
  /** Voice settings. */
  readonly voice: VoiceSettings;
  /** The character's GUID (e.g. `"{4E574F44-B521-11D0-9E9A-00C04FD7081F}"`), if any. */
  readonly guid: string | undefined;
  /** Number of images. */
  readonly imageCount: number;
  /** Names of the animations assigned to a state (e.g. `"IdlingLevel1"`, case-insensitive). Empty if none. */
  stateAnimations(state: string): string[];
  /**
   * Returns an image, decoded to RGBA.
   *
   * @throws If the index is out of range.
   */
  getImage(index: number): AcsImage;
  /** Raw data (WAV) of a sound effect, or `undefined` if it does not exist. */
  getSound(index: number): Uint8Array | undefined;
  /**
   * Downloads the frames of animations (ACF characters only; ACS and ACT files are complete, so they lack this method).
   * Until then, those animations in `animations` have no frames.
   */
  prepare?(names: readonly string[]): Promise<void>;
}
