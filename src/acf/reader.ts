import { Cursor } from "../acs/cursor.js";
import { decompress } from "../acs/decompress.js";
import { IndexedCharacter, readCharacterBody, readLocalized } from "../acs/indexed.js";
import type { AcsImage, Branch, Frame, Overlay } from "../acs/reader.js";

/**
 * Microsoft Agent の HTTP 用のキャラクター: ACF (キャラクター情報とアニメーションの一覧) と、
 * アニメーションごとの ACA (画像・効果音・コマ)。形は docs/acf-aca-format.ja.md
 */
const SIGNATURES = [0xabcdabc4, 0xabcdabc2];
/** 読める版は 2.1 だけ (これより古い版は、キャラクター情報の並びが違い、見本も無い) */
const VERSION = 0x20001;
const EMPTY_IMAGE: AcsImage = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };

/** Whether the data is an ACF file (checked by its first 4 bytes). */
export function isAcfFile(data: ArrayBuffer): boolean {
  return data.byteLength >= 4 && SIGNATURES.includes(new DataView(data).getUint32(0, true));
}

/** ACS と同じ圧縮を展開する。c は、展開後のサイズ・圧縮後のサイズ (どちらも DWORD) の位置 */
function unpack(c: Cursor): ArrayBuffer {
  const size = c.u32();
  const packed = c.bytes(c.u32());
  return decompress(packed, size).buffer as ArrayBuffer;
}

/** Options for {@link AcfCharacter}. */
export interface AcfOptions {
  /** URL the animation (.aca) file names in the .acf are resolved against. Default: the page URL. */
  baseUrl?: string | URL;
}

/** ACF の一覧の 1 件 */
interface AcaEntry {
  file: string;
  checksum: number;
}

/** 色番号のままの画像 (描くときに RGBA にする) */
interface RawImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * A Microsoft Agent character for the web: an .acf file (character data and the list of animations) plus one .aca
 * file per animation (its images, sounds and frames). See docs/acf-aca-format.md for the format.
 *
 * All animations are listed from the start, but their frames are empty until the .aca is loaded with `prepare()`
 * (or `addAnimationData()`). `msagent.load()` and `agent.get()` do this for you.
 */
export class AcfCharacter extends IndexedCharacter {
  private readonly entries = new Map<string, AcaEntry>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly loaded = new Set<string>();
  private readonly images: (RawImage | undefined)[] = [];
  private readonly imageCache = new Map<number, AcsImage>();
  private readonly sounds: Uint8Array[] = [];
  private readonly baseUrl: string | URL | undefined;

  /**
   * @param buf - The contents of the .acf file.
   * @throws If the data is not an ACF file, or not version 2.1.
   */
  constructor(buf: ArrayBuffer, options: AcfOptions = {}) {
    const header = new Cursor(buf);
    if (!SIGNATURES.includes(header.u32())) throw new Error("Not an ACF file");
    const c = new Cursor(unpack(header), 0, false);
    const version = c.u32();
    if (version !== VERSION) {
      throw new Error(`Unsupported ACF version: ${version >>> 16}.${version & 0xffff} (only 2.1 is supported)`);
    }
    // アニメーションの一覧: 名前、ACA のファイル名、戻りアニメの名前、ACA のチェックサム
    const list: { name: string; file: string; returnAnimation: string; checksum: number }[] = [];
    const count = c.u16();
    for (let i = 0; i < count; i++) {
      list.push({ name: c.string(), file: c.string(), returnAnimation: c.string(), checksum: c.u32() });
    }
    const guid = c.guid();
    const localized = readLocalized(c);
    super({ ...readCharacterBody(c), version: "2.1", guid, localized });

    this.baseUrl = options.baseUrl;
    for (const e of list) {
      this.entries.set(e.name, { file: e.file, checksum: e.checksum });
      // コマは ACA を読み込むまで空。戻りアニメの有無は、ACA の transitionType で決まる
      this.animations.set(e.name, {
        name: e.name,
        transitionType: e.returnAnimation ? 0 : 2,
        returnAnimation: e.returnAnimation,
        frames: [],
      });
    }
    this.resolveNames();
  }

  /** URL of an animation's .aca file (its file name in the .acf, resolved against `baseUrl`), or `undefined` if there is no such animation. */
  animationUrl(name: string): URL | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const base = this.baseUrl ?? (typeof document !== "undefined" ? document.baseURI : undefined);
    return new URL(entry.file, base);
  }

  /** Whether an animation's frames have been loaded. */
  isLoaded(name: string): boolean {
    return this.loaded.has(name);
  }

  /**
   * Downloads and loads the .aca files of animations and their return animations. Animations already loaded are
   * skipped, and unknown names are ignored.
   *
   * @throws If a download or the parsing fails.
   */
  async prepare(names: readonly string[]): Promise<void> {
    const wanted = new Set<string>();
    for (const name of names) {
      const anim = this.animations.get(name);
      if (!anim) continue;
      wanted.add(name);
      if (anim.returnAnimation && this.animations.has(anim.returnAnimation)) wanted.add(anim.returnAnimation);
    }
    await Promise.all([...wanted].map((name) => this.fetchAnimation(name)));
  }

  private fetchAnimation(name: string): Promise<void> {
    if (this.loaded.has(name)) return Promise.resolve();
    let promise = this.loading.get(name);
    if (!promise) {
      promise = (async () => {
        const url = this.animationUrl(name)!;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch animation ${name}: ${res.status} ${res.url}`);
        this.addAnimationData(name, await res.arrayBuffer());
      })().finally(() => this.loading.delete(name));
      this.loading.set(name, promise);
    }
    return promise;
  }

  /**
   * Loads the contents of an .aca file as the frames of an animation, without fetching (e.g. from a `File`).
   *
   * @throws If there is no such animation, or the checksum does not match the .acf (the .aca belongs to another
   *   character or another version), like Microsoft Agent.
   */
  addAnimationData(name: string, data: ArrayBuffer): void {
    const anim = this.animations.get(name);
    const entry = this.entries.get(name);
    if (!anim || !entry) throw new Error(`Animation not found: ${name}`);
    if (this.loaded.has(name)) return;
    const header = new Cursor(data, 0, false);
    const version = header.u32();
    if (version !== VERSION) throw new Error(`Unsupported ACA version (${name})`);
    if (header.u32() !== entry.checksum) {
      throw new Error(
        `ACA checksum does not match the ACF (${name}): the file belongs to another character or another version`,
      );
    }
    const body = header.u8() === 1 ? unpack(header) : data.slice(header.pos);
    const { transitionType, frames } = this.readAca(new Cursor(body, 0, false));
    anim.transitionType = transitionType;
    anim.frames.push(...frames);
    this.loaded.add(name);
  }

  /** ACA の展開後の中身: 効果音、画像、アニメーション (画像・効果音の番号は、このキャラクター全体の番号に直す) */
  private readAca(c: Cursor): { transitionType: number; frames: Frame[] } {
    const soundBase = this.sounds.length;
    const soundCount = c.u16();
    for (let i = 0; i < soundCount; i++) this.sounds.push(c.bytes(c.u32()));

    // 画像はコマ全体の 1 枚絵 (ACS で何枚かを重ねていたコマも、重ねた結果になっている)。大きさはキャラクターと同じ
    const imageBase = this.images.length;
    const imageCount = c.u16();
    for (let i = 0; i < imageCount; i++) {
      const size = c.u32();
      if (size === 0) {
        this.images.push(undefined);
        continue;
      }
      c.skip(1); // 意味は分からない (見本では常に 0)
      this.images.push({ data: c.bytes(size), width: this.width, height: this.height });
      c.skip(c.u32()); // 形 (RGNDATA)
    }

    const transitionType = c.u8();
    const frameCount = c.u16();
    const frames: Frame[] = [];
    for (let f = 0; f < frameCount; f++) {
      const image = c.i16();
      const sound = c.i16();
      const duration = c.u16() * 10;
      const x = c.i16(),
        y = c.i16();
      const exitFrame = c.i16();
      const branches: Branch[] = [];
      const branchCount = c.u8();
      for (let i = 0; i < branchCount; i++) branches.push({ frameIndex: c.u16(), probability: c.u16() });
      const overlays: Overlay[] = [];
      const overlayCount = c.u8();
      if (overlayCount > 0 && c.u8() !== 0) {
        // 意味は分からない (見本では常に 0)。0 でなければ、サイズ付きのデータが 2 つ続く
        c.skip(c.u32());
        c.skip(c.u32());
      }
      for (let i = 0; i < overlayCount; i++) {
        const type = c.u8();
        const size = c.u32();
        if (size === 0) continue;
        const replace = c.u8() !== 0;
        const hasRegion = c.u8() !== 0;
        const ox = c.i16(),
          oy = c.i16();
        const width = c.u16(),
          height = c.u16();
        // 口の画像は、必要な範囲だけ切り出して、置く位置が付いている
        this.images.push({ data: c.bytes(size), width, height });
        if (hasRegion) c.skip(c.u32());
        overlays.push({ type, replace, imageIndex: this.images.length - 1, x: ox, y: oy, width, height });
      }
      frames.push({
        images: image >= 0 ? [{ imageIndex: imageBase + image, x, y }] : [],
        soundIndex: sound >= 0 ? soundBase + sound : -1,
        duration,
        exitFrame,
        branches,
        overlays,
      });
    }
    return { transitionType, frames };
  }

  /** Number of images loaded so far (grows as .aca files are loaded). */
  get imageCount() {
    return this.images.length;
  }

  /** Raw data (WAV) of a sound effect, or `undefined` if it does not exist (or is not loaded yet). */
  getSound(index: number): Uint8Array | undefined {
    return this.sounds[index];
  }

  /**
   * Returns an image, decoded to RGBA (and cached).
   *
   * @throws If the index is out of range.
   */
  getImage(index: number): AcsImage {
    const cached = this.imageCache.get(index);
    if (cached) return cached;
    if (index < 0 || index >= this.images.length) throw new Error(`Image ${index} does not exist`);
    const raw = this.images[index];
    const stride = raw ? (raw.width + 3) & ~3 : 0;
    const image =
      raw && raw.data.length >= stride * raw.height ? this.toRgba(raw.data, raw.width, raw.height) : EMPTY_IMAGE;
    this.imageCache.set(index, image);
    return image;
  }
}
