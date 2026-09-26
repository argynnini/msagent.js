import { decodeTrayIcon } from "./icon";
import type { Cursor } from "./cursor";
import type { AcsImage, Animation } from "./reader";
import { DEFAULT_BALLOON_STYLE, type BalloonStyle, type VoiceSettings } from "../character";
import { languageTag, pickLanguage, type Language } from "../language";

const STYLE_VOICE = 1 << 5;
const STYLE_BALLOON = 1 << 9;
/*
 * 吹き出しの動きの旗 (Character Editor の Word Balloon のページの設定)。公式の資料には無く、
 * 広く使われている ACS の解析資料による。実ファイル (Merlin 0x110220 など) とも合う
 */
const STYLE_BALLOON_SIZE_TO_TEXT = 1 << 16;
const STYLE_BALLOON_NO_AUTO_HIDE = 1 << 17;
const STYLE_BALLOON_NO_AUTO_PACE = 1 << 18;

type LocalizedText = { name: string; description: string; extraData: string };

/** キャラクター情報のうち、ACS と ACF で並びが同じ部分 (大きさからアイコン・状態まで) */
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

/** ACS と ACF のキャラクター情報 (版・GUID・言語ごとの名前と、CharacterBody) */
export interface CharacterInfo extends CharacterBody {
  version: string;
  guid: string;
  localized: Map<number, LocalizedText>;
}

/**
 * 言語ごとの名前と紹介文を読む。言語 ID は Windows の LANGID で、0x0411 (ja-JP) のようにサブ言語込みのことが多いが、
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

/** キャラクター情報の、大きさからアイコン・状態までを読む (ACS も ACF も同じ並び) */
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
      lines, charsPerLine, foreground, background, border, fontFamily,
      fontSize: Math.abs(fontHeight) || 13, fontWeight: fontWeight || 400, italic,
    };
  }

  const palette: [number, number, number][] = [];
  const colorCount = c.u32();
  for (let i = 0; i < colorCount; i++) {
    const b = c.u8(), g = c.u8(), r = c.u8();
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
 * 8 ビットの色番号の画像を使うキャラクター (ACS と ACF) の共通部分:
 * 言語ごとの名前・紹介文、状態、パレットの色での画像の変換
 */
export abstract class IndexedCharacter {
  readonly width: number;
  readonly height: number;
  readonly transparentIndex: number;
  /** キャラクターファイルの版 (例: "2.1") */
  readonly version: string;
  /** 吹き出しの見た目と動き */
  readonly balloon: BalloonStyle;
  /**
   * 読み上げの声の設定 (Microsoft Agent の音声合成 = SAPI 4 の値)。音声の設定が無い (Office アシスタントなど)、
   * またはエンジン任せ (-1) の項目は undefined
   */
  readonly voice: VoiceSettings;
  /** キャラクターの GUID */
  readonly guid: string;
  /** [r, g, b] の配列 */
  readonly palette: [number, number, number][];
  /**
   * タスクトレイ用の小さなアイコン (Microsoft Agent のキャラクターは 16x16 が多い)。
   * Office アシスタント (クリッパー・イルカなど) には入っていないことが多い。無ければ undefined
   */
  readonly trayIcon: AcsImage | undefined;
  /**
   * 状態 (Showing / Hiding / IdlingLevel1〜3 / GesturingLeft など) ごとに、キャラクター作者が割り当てたアニメーション名。
   * キーは大文字の状態名、値は animations のキーの表記 (ファイルでは大文字で入っているので、実在する名前に直してある)
   */
  readonly states = new Map<string, string[]>();
  readonly animations = new Map<string, Animation>();
  /** 言語 ID (Windows の LANGID) ごとの名前と紹介文 */
  private readonly localized: Map<number, LocalizedText>;
  private readonly rawStates: [string, string[]][];

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
      if (anim.returnAnimation) anim.returnAnimation = byUpper.get(anim.returnAnimation.toUpperCase()) ?? anim.returnAnimation;
    }
  }

  /** 状態 (例: "IdlingLevel1"、大文字小文字は問わない) に割り当てられたアニメーション名。無ければ空 */
  stateAnimations(state: string): string[] {
    return this.states.get(state.toUpperCase()) ?? [];
  }

  get languages(): string[] {
    return [...this.localized.keys()].map(languageTag);
  }

  /** 名前 (ブラウザの言語に一番合うもの) */
  get name(): string | undefined {
    return this.getName();
  }

  /** 紹介文 (ブラウザの言語に一番合うもの) */
  get description(): string | undefined {
    return this.getDescription();
  }

  /**
   * 指定した言語 (BCP 47 か LANGID。省略時はブラウザの言語) の名前。無ければ近い言語。
   * 名前・紹介文はそれぞれ別に選ぶ (紹介文だけ日本語が空で英語にしかない、といったファイルでも拾えるように、同じ言語の組に固定しない)
   */
  getName(language?: Language | readonly Language[]): string | undefined {
    return this.pickText("name", language);
  }

  /** 指定した言語 (BCP 47 か LANGID。省略時はブラウザの言語) の紹介文。無ければ近い言語 */
  getDescription(language?: Language | readonly Language[]): string | undefined {
    return this.pickText("description", language);
  }

  /** 指定した言語 (省略時はブラウザの言語) の、作者が入れたおまけの文字 (本家の ExtraData)。無ければ近い言語 */
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
