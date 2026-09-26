import { decodeTrayIcon } from "./icon.js";
import type { Cursor } from "./cursor.js";
import type { AcsImage, Animation } from "./reader.js";
import { DEFAULT_BALLOON_STYLE, type BalloonStyle, type VoiceSettings } from "../character.js";
import { languageTag, pickLanguage, type Language } from "../language.js";

const STYLE_VOICE = 1 << 5;
const STYLE_BALLOON = 1 << 9;
/*
 * 吹き出しの動きの旗 (Character Editor の Word Balloon のページの設定)。公式の資料には無く、
 * 広く使われている ACS の解析資料による。実ファイル (Merlin 0x110220 など) とも合う
 */
const STYLE_BALLOON_SIZE_TO_TEXT = 1 << 16;
const STYLE_BALLOON_NO_AUTO_HIDE = 1 << 17;
const STYLE_BALLOON_NO_AUTO_PACE = 1 << 18;

/** Name, description and extra data in one language. */
type LocalizedText = { name: string; description: string; extraData: string };

/** @internal キャラクター情報のうち、ACS と ACF で並びが同じ部分 (大きさからアイコン・状態まで) */
export interface CharacterBody {
  width: number;
  height: number;
  transparentIndex: number;
  balloon: BalloonStyle;
  voice: VoiceSettings;
  /** [r, g, b] の配列 */
  palette: [number, number, number][];
  trayIcon: AcsImage | undefined;
  /** 状態名と、割り当てられたアニメーション名 (ファイルのまま。大文字のことが多い) */
  states: [string, string[]][];
}

/** @internal ACS と ACF のキャラクター情報 (版・GUID・言語ごとの名前と、CharacterBody) */
export interface CharacterInfo extends CharacterBody {
  version: string;
  guid: string;
  localized: Map<number, LocalizedText>;
}

/**
 * @internal 言語ごとの名前と紹介文を読む。言語 ID は Windows の LANGID で、0x0411 (ja-JP) のようにサブ言語込みのことが多いが、
 * 0x11 (主言語 ID のみ) のこともある。途中で読めなくなっても、そこまでに読めたものは使う
 */
export function readLocalized(c: Cursor): Map<number, LocalizedText> {
  const localized = new Map<number, LocalizedText>();
  try {
    const count = c.u16();
    for (let i = 0; i < count; i++) {
      const lang = c.u16();
      const name = c.string().trim();
      const description = c.string().trim();
      const extraData = c.string().trim();
      if (name || description || extraData) localized.set(lang, { name, description, extraData });
    }
  } catch {
    // 途中まで読めたものは使う
  }
  return localized;
}

/** @internal キャラクター情報の、大きさからアイコン・状態までを読む (ACS も ACF も同じ並び) */
export function readCharacterBody(c: Cursor): CharacterBody {
  const width = c.u16();
  const height = c.u16();
  const transparentIndex = c.u8();
  const style = c.u32();
  c.skip(4);
  const voice: VoiceSettings = {};
  if (style & STYLE_VOICE) {
    voice.engine = c.guid();
    voice.mode = c.guid();
    // 速さ・高さ。すべてのビットが 1 (-1) ならエンジン任せ
    const speed = c.u32();
    const pitch = c.u16();
    if (speed !== 0xffffffff && speed > 0) voice.speed = speed;
    if (pitch !== 0xffff && pitch > 0) voice.pitch = pitch;
    if (c.u8() !== 0) {
      const langId = c.u16();
      const dialect = c.string();
      const gender = c.u16(); // SAPI 4: 0 どちらでもない, 1 女性, 2 男性
      const age = c.u16();
      const style = c.string();
      if (langId) {
        voice.languageId = langId;
        voice.language = languageTag(langId);
      }
      if (dialect) voice.dialect = dialect;
      voice.gender = gender === 1 ? "female" : gender === 2 ? "male" : "neutral";
      if (age) voice.age = age;
      if (style) voice.style = style;
    }
  }
  const behavior = {
    enabled: (style & STYLE_BALLOON) !== 0,
    sizeToText: (style & STYLE_BALLOON_SIZE_TO_TEXT) !== 0,
    autoHide: (style & STYLE_BALLOON_NO_AUTO_HIDE) === 0,
    autoPace: (style & STYLE_BALLOON_NO_AUTO_PACE) === 0,
  };
  // 吹き出しを使わないキャラクターは、見た目は既定のまま、吹き出しを出さない
  let balloon: BalloonStyle = { ...DEFAULT_BALLOON_STYLE, ...behavior };
  if (style & STYLE_BALLOON) {
    const lines = c.u8();
    const charsPerLine = c.u8();
    // 色は COLORREF (R, G, B, 0 の順)
    const color = () => {
      const [r, g, b] = [c.u8(), c.u8(), c.u8()];
      c.skip(1);
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    };
    const foreground = color();
    const background = color();
    const border = color();
    const fontFamily = c.string();
    // LOGFONT と同じく、高さが負なら文字の高さ (px)
    const fontHeight = c.u32() | 0;
    const fontWeight = c.u32();
    const italic = c.u8() !== 0;
    c.skip(1);
    balloon = {
      ...balloon,
      lines,
      charsPerLine,
      foreground,
      background,
      border,
      fontFamily,
      fontSize: Math.abs(fontHeight) || 13,
      fontWeight: fontWeight || 400,
      italic,
    };
  }

  const palette: [number, number, number][] = [];
  const colorCount = c.u32();
  for (let i = 0; i < colorCount; i++) {
    const b = c.u8(),
      g = c.u8(),
      r = c.u8();
    c.skip(1);
    palette.push([r, g, b]);
  }

  // タスクトレイ用のアイコンと状態の一覧。読めなくてもキャラクター自体は使えるようにする
  let trayIcon: AcsImage | undefined;
  const states: [string, string[]][] = [];
  try {
    // タスクトレイ用のアイコン: 白黒のマスク DIB、色の DIB の順 (どちらも DWORD のサイズ付き)
    if (c.u8() !== 0) {
      const mask = c.bytes(c.u32());
      const color = c.bytes(c.u32());
      trayIcon = decodeTrayIcon(color, mask);
    }
    // 状態: WORD 個数、それぞれ 状態名 + WORD 個数 + アニメーション名
    const stateCount = c.u16();
    for (let i = 0; i < stateCount; i++) {
      const state = c.string();
      const names: string[] = [];
      const count = c.u16();
      for (let j = 0; j < count; j++) names.push(c.string());
      states.push([state, names]);
    }
  } catch {
    states.length = 0;
  }
  return { width, height, transparentIndex, balloon, voice, palette, trayIcon, states };
}

/**
 * Common base of Microsoft Agent characters (ACS and ACF), whose images use an 8-bit palette:
 * localized names and descriptions, states, and palette-to-RGBA conversion.
 */
export abstract class IndexedCharacter {
  /** Width of the character's frames in pixels. */
  readonly width: number;
  /** Height of the character's frames in pixels. */
  readonly height: number;
  /** Palette index of the transparent color. */
  readonly transparentIndex: number;
  /** Version of the character file (e.g. `"2.1"`). */
  readonly version: string;
  /** Balloon appearance and behavior. */
  readonly balloon: BalloonStyle;
  /**
   * Voice settings (Microsoft Agent's SAPI 4 values). Settings that are missing (as in Office Assistants) or left to
   * the speech engine are `undefined`.
   */
  readonly voice: VoiceSettings;
  /** The character's GUID. */
  readonly guid: string;
  /** The color palette, as `[r, g, b]` entries. */
  readonly palette: [number, number, number][];
  /**
   * Small icon for the taskbar / system tray (usually 16×16 for Microsoft Agent characters), if any.
   * Office Assistants (Clippit, the dolphin, ...) often have none.
   */
  readonly trayIcon: AcsImage | undefined;
  /**
   * Animations the author assigned to each state (Showing, Hiding, IdlingLevel1–3, GesturingLeft, ...).
   * Keys are upper-case state names; values use the spelling of the keys of `animations`.
   */
  readonly states = new Map<string, string[]>();
  /** Animations by name. */
  readonly animations = new Map<string, Animation>();
  /** 言語 ID (Windows の LANGID) ごとの名前と紹介文 */
  private readonly localized: Map<number, LocalizedText>;
  private readonly rawStates: [string, string[]][];

  /** @internal AcsCharacter / AcfCharacter が、読んだキャラクター情報を渡す */
  constructor(info: CharacterInfo) {
    this.width = info.width;
    this.height = info.height;
    this.transparentIndex = info.transparentIndex;
    this.version = info.version;
    this.balloon = info.balloon;
    this.voice = info.voice;
    this.guid = info.guid;
    this.palette = info.palette;
    this.trayIcon = info.trayIcon;
    this.localized = info.localized;
    this.rawStates = info.states;
  }

  /**
   * 状態と戻りアニメの名前を、実在するアニメーション名の表記に直す (animations を入れた後に呼ぶ)。
   * 状態のアニメーション名は大文字で入っている。戻りアニメの名前も大文字のことがある
   * (例: フィンフィンの MoveLeft → "MOVELEFTRETURN")。無い名前の状態は除く
   */
  protected resolveNames() {
    const byUpper = new Map([...this.animations.keys()].map((n) => [n.toUpperCase(), n]));
    for (const [state, names] of this.rawStates) {
      const resolved = names.map((n) => byUpper.get(n.toUpperCase())).filter((n): n is string => n !== undefined);
      if (resolved.length > 0) this.states.set(state.toUpperCase(), resolved);
    }
    for (const anim of this.animations.values()) {
      if (anim.returnAnimation)
        anim.returnAnimation = byUpper.get(anim.returnAnimation.toUpperCase()) ?? anim.returnAnimation;
    }
  }

  /** Names of the animations assigned to a state (e.g. `"IdlingLevel1"`, case-insensitive). Empty if none. */
  stateAnimations(state: string): string[] {
    return this.states.get(state.toUpperCase()) ?? [];
  }

  /** Languages the name and description are stored in, as BCP 47 tags (e.g. `["en", "ja-JP"]`). */
  get languages(): string[] {
    return [...this.localized.keys()].map(languageTag);
  }

  /** Name in the language that best matches the browser's. */
  get name(): string | undefined {
    return this.getName();
  }

  /** Description in the language that best matches the browser's. */
  get description(): string | undefined {
    return this.getDescription();
  }

  /**
   * Name in the given language (a BCP 47 tag or Windows language ID; default: the browser's languages), or the
   * closest one available. The name and description are chosen separately, so a description that exists only in
   * another language is still found.
   */
  getName(language?: Language | readonly Language[]): string | undefined {
    return this.pickText("name", language);
  }

  /** Description in the given language (default: the browser's languages), or the closest one available. */
  getDescription(language?: Language | readonly Language[]): string | undefined {
    return this.pickText("description", language);
  }

  /**
   * Extra text the author stored, in the given language (default: the browser's languages) or the closest one.
   * Same as Microsoft Agent's `ExtraData`.
   */
  getExtraData(language?: Language | readonly Language[]): string | undefined {
    return this.pickText("extraData", language);
  }

  private pickText(key: keyof LocalizedText, language?: Language | readonly Language[]): string | undefined {
    const available = [...this.localized].filter(([, v]) => v[key]).map(([id]) => id);
    const id = pickLanguage(available, language);
    return id === undefined ? undefined : this.localized.get(id)![key];
  }

  /** 8 ビットの色番号・下の行から並ぶ DIB (1 行は 4 バイト単位) → 上から下の RGBA (透過色は alpha=0) */
  protected toRgba(dib: Uint8Array, width: number, height: number): AcsImage {
    const stride = (width + 3) & ~3;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * stride;
      for (let x = 0; x < width; x++) {
        const idx = dib[srcRow + x]!;
        const o = (y * width + x) * 4;
        const [r, g, b] = this.palette[idx] ?? [0, 0, 0];
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = idx === this.transparentIndex ? 0 : 255;
      }
    }
    return { width, height, rgba };
  }
}
