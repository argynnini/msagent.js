import { Cursor } from "../acs/cursor";
import { decompress } from "../acs/decompress";
import { IndexedCharacter, readCharacterBody, readLocalized } from "../acs/indexed";
import type { AcsImage, Animation, Branch, Frame, Overlay } from "../acs/reader";

/**
 * Microsoft Agent の HTTP 用のキャラクター: ACF (キャラクター情報とアニメーションの一覧) と、
 * アニメーションごとの ACA (画像・効果音・コマ)。形は docs/acf-aca-format.md
 */
const SIGNATURES = [0xabcdabc4, 0xabcdabc2];
/** 読める版は 2.1 だけ (これより古い版は、キャラクター情報の並びが違い、見本も無い) */
const VERSION = 0x20001;
const EMPTY_IMAGE: AcsImage = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };

/** ACF ファイルか (先頭の 4 バイトで見分ける) */
export function isAcfFile(data: ArrayBuffer): boolean {
  return data.byteLength >= 4 && SIGNATURES.includes(new DataView(data).getUint32(0, true));
}

/** ACS と同じ圧縮を展開する。c は、展開後のサイズ・圧縮後のサイズ (どちらも DWORD) の位置 */
function unpack(c: Cursor): ArrayBuffer {
  const size = c.u32();
  const packed = c.bytes(c.u32());
  return decompress(packed, size).buffer as ArrayBuffer;
}

export interface AcfOptions {
  /** ACA のファイル名 (ACF に書いてある相対パス) の基準の URL。省略時は、ページの URL */
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
 * ACF で読み込むキャラクター。アニメーションの一覧は最初から全部あるが、コマは空で、
 * prepare() (または addAnimationData()) で ACA を読み込んだときに入る
 */
export class AcfCharacter extends IndexedCharacter {
  private readonly entries = new Map<string, AcaEntry>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly loaded = new Set<string>();
  private readonly images: (RawImage | undefined)[] = [];
  private readonly imageCache = new Map<number, AcsImage>();
  private readonly sounds: Uint8Array[] = [];
  private readonly baseUrl: string | URL | undefined;

  constructor(buf: ArrayBuffer, options: AcfOptions = {}) {
    const header = new Cursor(buf);
    if (!SIGNATURES.includes(header.u32())) throw new Error("ACF ファイルではありません");
    const c = new Cursor(unpack(header), 0, false);
    const version = c.u32();
    if (version !== VERSION) {
      throw new Error(`この版の ACF は読めません: ${version >>> 16}.${version & 0xffff} (読めるのは 2.1)`);
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
      this.animations.set(e.name, { name: e.name, transitionType: e.returnAnimation ? 0 : 2, returnAnimation: e.returnAnimation, frames: [] });
    }
    this.resolveNames();
  }

  /** ACA の URL (ACF に書いてあるファイル名を、baseUrl から見た相対パスとして解決する) */
  animationUrl(name: string): URL | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const base = this.baseUrl ?? (typeof document !== "undefined" ? document.baseURI : undefined);
    return new URL(entry.file, base);
  }

  /** アニメーションのコマを読み込み済みか */
  isLoaded(name: string): boolean {
    return this.loaded.has(name);
  }

  /**
   * アニメーション (と、その戻りアニメ) の ACA を取り寄せて読み込む。読み込み済みのものは取り寄せない。
   * 無い名前は無視する。取り寄せ・読み込みに失敗したら reject
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
        if (!res.ok) throw new Error(`アニメーション ${name} を取得できません: ${res.status} ${res.url}`);
        this.addAnimationData(name, await res.arrayBuffer());
      })().finally(() => this.loading.delete(name));
      this.loading.set(name, promise);
    }
    return promise;
  }

  /**
   * ACA の中身を、アニメーション name のコマとして読み込む (fetch を使わずに渡すとき。File から読んだものなど)。
   * ACF に書いてあるチェックサムと合わなければ、別のキャラクター・別の版の ACA なので、例外にする (本家と同じ)
   */
  addAnimationData(name: string, data: ArrayBuffer): void {
    const anim = this.animations.get(name);
    const entry = this.entries.get(name);
    if (!anim || !entry) throw new Error(`アニメーションがありません: ${name}`);
    if (this.loaded.has(name)) return;
    const header = new Cursor(data, 0, false);
    const version = header.u32();
    if (version !== VERSION) throw new Error(`この版の ACA は読めません (${name})`);
    if (header.u32() !== entry.checksum) {
      throw new Error(`ACA のチェックサムが ACF と合いません (${name})。別のキャラクターか、別の版のファイルです`);
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
      const x = c.i16(), y = c.i16();
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
        const ox = c.i16(), oy = c.i16();
        const width = c.u16(), height = c.u16();
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

  /** 読み込み済みの画像の数 (ACA を読み込むたびに増える) */
  get imageCount() {
    return this.images.length;
  }

  /** 効果音 (WAV) の生データ。存在しなければ undefined */
  getSound(index: number): Uint8Array | undefined {
    return this.sounds[index];
  }

  getImage(index: number): AcsImage {
    const cached = this.imageCache.get(index);
    if (cached) return cached;
    if (index < 0 || index >= this.images.length) throw new Error(`画像 ${index} は存在しません`);
    const raw = this.images[index];
    const stride = raw ? (raw.width + 3) & ~3 : 0;
    const image = raw && raw.data.length >= stride * raw.height ? this.toRgba(raw.data, raw.width, raw.height) : EMPTY_IMAGE;
    this.imageCache.set(index, image);
    return image;
  }
}
