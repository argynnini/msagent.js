import { decompress } from "./decompress";
import { decodeTrayIcon } from "./icon";
import { DEFAULT_BALLOON_STYLE, type BalloonStyle, type VoiceSettings } from "../character";
import { languageTag, pickLanguage, type Language } from "../language";

export interface Location {
  offset: number;
  size: number;
}

export interface Overlay {
  type: number;
  replace: boolean;
  imageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameImage {
  imageIndex: number;
  x: number;
  y: number;
  /** 描く大きさ (省略時は画像そのままの大きさ)。ACT の合成コマで、範囲に合わせて拡大・縮小するときに使う */
  width?: number;
  height?: number;
}

export interface Branch {
  frameIndex: number;
  probability: number;
}

export interface Frame {
  images: FrameImage[];
  soundIndex: number;
  /** 表示時間 (ms) */
  duration: number;
  /** 終了分岐先。なければ -1 */
  exitFrame: number;
  branches: Branch[];
  overlays: Overlay[];
}

export interface Animation {
  name: string;
  /** 0: 戻りアニメを使う, 1: 終了分岐を使う, 2: 戻りなし */
  transitionType: number;
  returnAnimation: string;
  frames: Frame[];
}

export interface AcsImage {
  width: number;
  height: number;
  /** RGBA (透過色は alpha=0) */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

class Cursor {
  private readonly view: DataView;
  pos: number;
  constructor(readonly buf: ArrayBuffer, pos = 0) {
    this.view = new DataView(buf);
    this.pos = pos;
  }
  u8() { return this.view.getUint8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  skip(n: number) { this.pos += n; }
  bytes(n: number) { const v = new Uint8Array(this.buf, this.pos, n); this.pos += n; return v; }
  /** GUID ("{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" の形) */
  guid(): string {
    const hex = (v: number, n: number) => v.toString(16).padStart(n, "0");
    const d1 = hex(this.u32(), 8), d2 = hex(this.u16(), 4), d3 = hex(this.u16(), 4);
    const d4 = [...this.bytes(8)].map((b) => hex(b, 2)).join("");
    return `{${d1}-${d2}-${d3}-${d4.slice(0, 4)}-${d4.slice(4)}}`.toUpperCase();
  }
  location(): Location { return { offset: this.u32(), size: this.u32() }; }
  /** DWORD 文字数 + UTF-16LE (文字数 > 0 のとき終端 NUL 付き) */
  string(): string {
    const len = this.u32();
    if (len === 0) return "";
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u16());
    this.skip(2);
    return s;
  }
}

const SIGNATURE = 0xabcdabc3;
const STYLE_VOICE = 1 << 5;
const STYLE_BALLOON = 1 << 9;
/*
 * 吹き出しの動きの旗 (Character Editor の Word Balloon のページの設定)。公式の資料には無く、
 * 広く使われている ACS の解析資料による。実ファイル (Merlin 0x110220 など) とも合う
 */
const STYLE_BALLOON_SIZE_TO_TEXT = 1 << 16;
const STYLE_BALLOON_NO_AUTO_HIDE = 1 << 17;
const STYLE_BALLOON_NO_AUTO_PACE = 1 << 18;

export class AcsCharacter {
  readonly width: number;
  readonly height: number;
  readonly transparentIndex: number;
  /** 言語 ID (Windows の LANGID) ごとの名前と紹介文 */
  private readonly localized = new Map<number, { name: string; description: string }>();
  /** 吹き出しの見た目と動き */
  readonly balloon: BalloonStyle;
  /**
   * 読み上げの声の設定 (Microsoft Agent の音声合成 = SAPI 4 の値)。音声の設定が無い (Office アシスタントなど)、
   * またはエンジン任せ (-1) の項目は undefined
   */
  readonly voice: VoiceSettings = {};
  /** キャラクターの GUID */
  readonly guid: string;
  /** [r, g, b] の配列 */
  readonly palette: [number, number, number][] = [];
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

  private readonly imageLocations: Location[] = [];
  private readonly soundLocations: Location[] = [];
  private readonly imageCache = new Map<number, AcsImage>();

  constructor(private readonly buf: ArrayBuffer) {
    const c = new Cursor(buf);
    if (c.u32() !== SIGNATURE) throw new Error("ACS ファイルではありません");
    const charLoc = c.location();
    const animLoc = c.location();
    const imageLoc = c.location();
    const audioLoc = c.location();

    // --- キャラクター情報 ---
    c.pos = charLoc.offset;
    c.skip(4); // version
    const localizedLoc = c.location();
    this.guid = c.guid();
    this.width = c.u16();
    this.height = c.u16();
    this.transparentIndex = c.u8();
    const style = c.u32();
    c.skip(4);
    if (style & STYLE_VOICE) {
      this.voice.engine = c.guid();
      this.voice.mode = c.guid();
      // 速さ・高さ。すべてのビットが 1 (-1) ならエンジン任せ
      const speed = c.u32();
      const pitch = c.u16();
      if (speed !== 0xffffffff && speed > 0) this.voice.speed = speed;
      if (pitch !== 0xffff && pitch > 0) this.voice.pitch = pitch;
      if (c.u8() !== 0) {
        const langId = c.u16();
        const dialect = c.string();
        const gender = c.u16(); // SAPI 4: 0 どちらでもない, 1 女性, 2 男性
        const age = c.u16();
        const style = c.string();
        if (langId) {
          this.voice.languageId = langId;
          this.voice.language = languageTag(langId);
        }
        if (dialect) this.voice.dialect = dialect;
        this.voice.gender = gender === 1 ? "female" : gender === 2 ? "male" : "neutral";
        if (age) this.voice.age = age;
        if (style) this.voice.style = style;
      }
    }
    const behavior = {
      enabled: (style & STYLE_BALLOON) !== 0,
      sizeToText: (style & STYLE_BALLOON_SIZE_TO_TEXT) !== 0,
      autoHide: (style & STYLE_BALLOON_NO_AUTO_HIDE) === 0,
      autoPace: (style & STYLE_BALLOON_NO_AUTO_PACE) === 0,
    };
    // 吹き出しを使わないキャラクターは、見た目は既定のまま、吹き出しを出さない
    this.balloon = { ...DEFAULT_BALLOON_STYLE, ...behavior };
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
      const height = c.u32() | 0;
      const fontWeight = c.u32();
      const italic = c.u8() !== 0;
      c.skip(1);
      this.balloon = {
        ...this.balloon,
        lines, charsPerLine, foreground, background, border, fontFamily,
        fontSize: Math.abs(height) || 13, fontWeight: fontWeight || 400, italic,
      };
    }
    this.readNames(localizedLoc);

    const colorCount = c.u32();
    for (let i = 0; i < colorCount; i++) {
      const b = c.u8(), g = c.u8(), r = c.u8();
      c.skip(1);
      this.palette.push([r, g, b]);
    }

    // タスクトレイ用のアイコンと状態の一覧。読めなくてもキャラクター自体は使えるようにする
    const rawStates: [string, string[]][] = [];
    try {
      // タスクトレイ用のアイコン: 白黒のマスク DIB、色の DIB の順 (どちらも DWORD のサイズ付き)
      if (c.u8() !== 0) {
        const mask = c.bytes(c.u32());
        const color = c.bytes(c.u32());
        this.trayIcon = decodeTrayIcon(color, mask);
      }
      // 状態: WORD 個数、それぞれ 状態名 + WORD 個数 + アニメーション名
      const stateCount = c.u16();
      for (let i = 0; i < stateCount; i++) {
        const state = c.string();
        const names: string[] = [];
        const count = c.u16();
        for (let j = 0; j < count; j++) names.push(c.string());
        rawStates.push([state, names]);
      }
    } catch {
      rawStates.length = 0;
    }

    // --- 画像一覧 ---
    c.pos = imageLoc.offset;
    const imageCount = c.u32();
    for (let i = 0; i < imageCount; i++) {
      this.imageLocations.push(c.location());
      c.skip(4); // checksum
    }

    // --- 効果音一覧 ---
    c.pos = audioLoc.offset;
    const soundCount = c.u32();
    for (let i = 0; i < soundCount; i++) {
      this.soundLocations.push(c.location());
      c.skip(4); // checksum
    }

    // --- アニメーション ---
    c.pos = animLoc.offset;
    const animCount = c.u32();
    const entries: { name: string; loc: Location }[] = [];
    for (let i = 0; i < animCount; i++) {
      const name = c.string();
      const loc = c.location();
      entries.push({ name, loc });
    }
    for (const e of entries) {
      this.animations.set(e.name, this.readAnimation(e.loc));
    }

    // 状態のアニメーション名は大文字で入っているので、実在するアニメーション名の表記に直す (無いものは除く)
    const byUpper = new Map([...this.animations.keys()].map((n) => [n.toUpperCase(), n]));
    for (const [state, names] of rawStates) {
      const resolved = names.map((n) => byUpper.get(n.toUpperCase())).filter((n): n is string => n !== undefined);
      if (resolved.length > 0) this.states.set(state.toUpperCase(), resolved);
    }
    // 戻りアニメの名前も大文字で入っていることがある (例: フィンフィンの MoveLeft → "MOVELEFTRETURN") ので、同じく直す
    for (const anim of this.animations.values()) {
      if (anim.returnAnimation) anim.returnAnimation = byUpper.get(anim.returnAnimation.toUpperCase()) ?? anim.returnAnimation;
    }
  }

  /** 状態 (例: "IdlingLevel1"、大文字小文字は問わない) に割り当てられたアニメーション名。無ければ空 */
  stateAnimations(state: string): string[] {
    return this.states.get(state.toUpperCase()) ?? [];
  }

  /**
   * 多言語のキャラクター情報から、名前と紹介文を取り出す。
   * 名前・紹介文はそれぞれ別に、日本語 → 英語 → 先頭の言語の順で選ぶ (例えば紹介文だけ日本語が
   * 空で英語にしかない、といった ACS でも拾えるように、同じ言語の組に固定しない)
   */
  /**
   * 言語ごとの名前と紹介文を読む。言語 ID は Windows の LANGID で、0x0411 (ja-JP) のようにサブ言語込みのことが多いが、
   * 0x11 (主言語 ID のみ) のこともある。読めなくてもキャラクター自体は使えるようにする
   */
  private readNames(loc: Location) {
    try {
      const c = new Cursor(this.buf, loc.offset);
      const count = c.u16();
      for (let i = 0; i < count; i++) {
        const lang = c.u16();
        const name = c.string().trim();
        const description = c.string().trim();
        c.string(); // extra
        if (name || description) this.localized.set(lang, { name, description });
      }
    } catch {
      // 途中まで読めたものは使う
    }
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

  /** 指定した言語 (BCP 47 か LANGID。省略時はブラウザの言語) の名前。無ければ近い言語 */
  getName(language?: Language | readonly Language[]): string | undefined {
    return this.pickText("name", language);
  }

  /** 指定した言語 (BCP 47 か LANGID。省略時はブラウザの言語) の紹介文。無ければ近い言語 */
  getDescription(language?: Language | readonly Language[]): string | undefined {
    return this.pickText("description", language);
  }

  private pickText(key: "name" | "description", language?: Language | readonly Language[]): string | undefined {
    const available = [...this.localized].filter(([, v]) => v[key]).map(([id]) => id);
    const id = pickLanguage(available, language);
    return id === undefined ? undefined : this.localized.get(id)![key];
  }

  private readAnimation(loc: Location): Animation {
    const c = new Cursor(this.buf, loc.offset);
    const name = c.string();
    const transitionType = c.u8();
    const returnAnimation = c.string();
    const frameCount = c.u16();
    const frames: Frame[] = [];
    for (let f = 0; f < frameCount; f++) {
      const images: FrameImage[] = [];
      const imageCount = c.u16();
      for (let i = 0; i < imageCount; i++) {
        images.push({ imageIndex: c.u32(), x: c.i16(), y: c.i16() });
      }
      const soundIndex = c.i16();
      const duration = c.u16() * 10;
      const exitFrame = c.i16();
      const branches: Branch[] = [];
      const branchCount = c.u8();
      for (let i = 0; i < branchCount; i++) {
        branches.push({ frameIndex: c.u16(), probability: c.u16() });
      }
      const overlays: Overlay[] = [];
      const overlayCount = c.u8();
      for (let i = 0; i < overlayCount; i++) {
        const type = c.u8();
        const replace = c.u8() !== 0;
        const imageIndex = c.u16();
        c.skip(1);
        const hasRegion = c.u8() !== 0;
        const x = c.i16(), y = c.i16();
        const width = c.u16(), height = c.u16();
        if (hasRegion) c.skip(c.u32());
        overlays.push({ type, replace, imageIndex, x, y, width, height });
      }
      frames.push({ images, soundIndex, duration, exitFrame, branches, overlays });
    }
    return { name, transitionType, returnAnimation, frames };
  }

  get imageCount() {
    return this.imageLocations.length;
  }

  /** 効果音 (WAV) の生データ。存在しなければ undefined */
  getSound(index: number): Uint8Array | undefined {
    const loc = this.soundLocations[index];
    return loc && new Uint8Array(this.buf, loc.offset, loc.size);
  }

  getImage(index: number): AcsImage {
    const cached = this.imageCache.get(index);
    if (cached) return cached;

    const loc = this.imageLocations[index];
    if (!loc) throw new Error(`画像 ${index} は存在しません`);
    // 使われていない画像スロットは、ヘッダーにも満たないサイズ (実例: 1 byte) で入っていることがある。
    // そのまま読むと、次の画像のデータにはみ出して幅・高さがでたらめな値になる (巨大確保でクラッシュする)
    const MIN_HEADER_SIZE = 1 + 2 + 2 + 1 + 4; // skip(1) + width(u16) + height(u16) + compressed(u8) + dataSize(u32)
    if (loc.size < MIN_HEADER_SIZE) {
      const empty: AcsImage = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };
      this.imageCache.set(index, empty);
      return empty;
    }
    const c = new Cursor(this.buf, loc.offset);
    c.skip(1);
    const width = c.u16();
    const height = c.u16();
    const compressed = c.u8() !== 0;
    const dataSize = c.u32();
    const raw = c.bytes(dataSize);

    const stride = (width + 3) & ~3;
    const dib = compressed ? decompress(raw, stride * height) : raw;

    // 8bit インデックス・ボトムアップ DIB → 上から下の RGBA
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
    const image = { width, height, rgba };
    this.imageCache.set(index, image);
    return image;
  }
}
