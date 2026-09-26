import { Cursor, type Location } from "./cursor";
import { decompress } from "./decompress";
import { IndexedCharacter, readCharacterBody, readLocalized, type CharacterInfo } from "./indexed";

export type { Location } from "./cursor";

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

const SIGNATURE = 0xabcdabc3;

/** 画像の先頭バイトが 0 なら「絵なし」 (本家 AgentDp2.dll も、この画像を飛ばして描く) */
const EMPTY_IMAGE: AcsImage = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };

/** ACS の頭と、キャラクター情報を読む */
function readAcsInfo(buf: ArrayBuffer) {
  const c = new Cursor(buf);
  if (c.u32() !== SIGNATURE) throw new Error("ACS ファイルではありません");
  const charLoc = c.location();
  const animLoc = c.location();
  const imageLoc = c.location();
  const audioLoc = c.location();

  c.pos = charLoc.offset;
  // 版: 下位 16 ビットが小さい番号、上位 16 ビットが大きい番号
  const minor = c.u16();
  const major = c.u16();
  const localizedLoc = c.location();
  const guid = c.guid();
  const body = readCharacterBody(c);
  const info: CharacterInfo = {
    ...body,
    version: `${major}.${minor}`,
    guid,
    localized: readLocalized(new Cursor(buf, localizedLoc.offset)),
  };
  return { info, animLoc, imageLoc, audioLoc };
}

export class AcsCharacter extends IndexedCharacter {
  private readonly imageLocations: Location[] = [];
  private readonly soundLocations: Location[] = [];
  private readonly imageCache = new Map<number, AcsImage>();
  private readonly buf: ArrayBuffer;

  constructor(buf: ArrayBuffer) {
    const { info, animLoc, imageLoc, audioLoc } = readAcsInfo(buf);
    super(info);
    this.buf = buf;
    const c = new Cursor(buf);

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
    this.resolveNames();
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
    // 先頭バイトが 0 の画像は「絵なし」で、中身はこの 1 バイトだけ (実例: フィンフィンの MoveLeftReturn の最後のコマ)。
    // 本家 (AgentDp2.dll) も、この画像を飛ばして描く。ヘッダーにも満たないサイズのものも、読むと次の画像にはみ出すので同じ扱い
    const MIN_HEADER_SIZE = 1 + 2 + 2 + 1 + 4; // present(u8) + width(u16) + height(u16) + compressed(u8) + dataSize(u32)
    if (loc.size < MIN_HEADER_SIZE || new Uint8Array(this.buf, loc.offset, 1)[0] === 0) {
      this.imageCache.set(index, EMPTY_IMAGE);
      return EMPTY_IMAGE;
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

    const image = this.toRgba(dib, width, height);
    this.imageCache.set(index, image);
    return image;
  }
}
