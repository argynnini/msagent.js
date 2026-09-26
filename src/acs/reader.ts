import { Cursor, type Location } from "./cursor.js";
import { decompress } from "./decompress.js";
import { IndexedCharacter, readCharacterBody, readLocalized, type CharacterInfo } from "./indexed.js";

export type { Location } from "./cursor.js";

/** A mouth overlay of a frame, drawn over the frame's images while the character speaks. */
export interface Overlay {
  /** Mouth shape: `0` closed, `1`–`4` wide open (by degree), `5` medium, `6` narrow. */
  type: number;
  /** Replace the frame's top image instead of drawing on top of it. */
  replace: boolean;
  /** Index of the overlay image. */
  imageIndex: number;
  /** Left of the overlay in the frame, in pixels. */
  x: number;
  /** Top of the overlay in the frame, in pixels. */
  y: number;
  /** Width of the overlay image, in pixels. */
  width: number;
  /** Height of the overlay image, in pixels. */
  height: number;
}

/** One image drawn in a frame. Images are layered, first on top. */
export interface FrameImage {
  /** Index of the image (see `Character.getImage()`). */
  imageIndex: number;
  /** Left in the frame, in pixels. */
  x: number;
  /** Top in the frame, in pixels. */
  y: number;
  /** Width to draw at. Default: the image's own width. Used by ACT composite frames that scale images to a box. */
  width?: number;
  /** Height to draw at. Default: the image's own height. */
  height?: number;
}

/** A random branch from a frame to another frame. */
export interface Branch {
  /** Index of the frame to jump to. */
  frameIndex: number;
  /** Probability of taking this branch, in percent. */
  probability: number;
}

/** One frame of an animation. */
export interface Frame {
  /** Images to draw. */
  images: FrameImage[];
  /** Index of the sound effect to play, or `-1` for none. */
  soundIndex: number;
  /** How long the frame is shown, in milliseconds. */
  duration: number;
  /** Frame to jump to when the animation is asked to end (the exit branch), or `-1` if none. */
  exitFrame: number;
  /** Random branches to other frames. */
  branches: Branch[];
  /** Mouth overlays used while speaking. */
  overlays: Overlay[];
}

/** An animation: a sequence of frames. */
export interface Animation {
  /** Animation name. */
  name: string;
  /** How the animation returns to the rest pose: `0` via `returnAnimation`, `1` via exit branches, `2` not at all. */
  transitionType: number;
  /** Name of the return animation (for `transitionType` `0`), or `""`. */
  returnAnimation: string;
  /** The frames. Empty for an ACF animation that has not been downloaded yet. */
  frames: Frame[];
}

/** A decoded image. */
export interface AcsImage {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** RGBA pixels, row by row from the top. Transparent pixels have alpha `0`. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

const SIGNATURE = 0xabcdabc3;

/** 画像の先頭バイトが 0 なら「絵なし」 (本家 AgentDp2.dll も、この画像を飛ばして描く) */
const EMPTY_IMAGE: AcsImage = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };

/** ACS の頭と、キャラクター情報を読む */
function readAcsInfo(buf: ArrayBuffer) {
  const c = new Cursor(buf);
  if (c.u32() !== SIGNATURE) throw new Error("Not an ACS file");
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

/**
 * A Microsoft Agent character loaded from a single .acs file.
 *
 * ```js
 * const character = new AcsCharacter(await (await fetch("merlin.acs")).arrayBuffer());
 * const agent = new Agent(character);
 * ```
 */
export class AcsCharacter extends IndexedCharacter {
  private readonly imageLocations: Location[] = [];
  private readonly soundLocations: Location[] = [];
  private readonly imageCache = new Map<number, AcsImage>();
  private readonly buf: ArrayBuffer;

  /**
   * @param buf - The contents of the .acs file.
   * @throws If the data is not an ACS file.
   */
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
        const x = c.i16(),
          y = c.i16();
        const width = c.u16(),
          height = c.u16();
        if (hasRegion) c.skip(c.u32());
        overlays.push({ type, replace, imageIndex, x, y, width, height });
      }
      frames.push({ images, soundIndex, duration, exitFrame, branches, overlays });
    }
    return { name, transitionType, returnAnimation, frames };
  }

  /** Number of images. */
  get imageCount() {
    return this.imageLocations.length;
  }

  /** Raw data (WAV) of a sound effect, or `undefined` if it does not exist. */
  getSound(index: number): Uint8Array | undefined {
    const loc = this.soundLocations[index];
    return loc && new Uint8Array(this.buf, loc.offset, loc.size);
  }

  /**
   * Returns an image, decoded to RGBA (and cached).
   *
   * @throws If the index is out of range.
   */
  getImage(index: number): AcsImage {
    const cached = this.imageCache.get(index);
    if (cached) return cached;

    const loc = this.imageLocations[index];
    if (!loc) throw new Error(`Image ${index} does not exist`);
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
