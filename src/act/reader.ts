import { decompress } from "../acs/decompress";
import type { AcsImage, Animation, Frame, FrameImage } from "../acs/reader";
import type { Character } from "../character";
import { HALFTONE_PALETTE } from "./halftone";
import { renderWmf, WMF_PLACEABLE_KEY, wmfSize } from "./wmf";

/**
 * Office 97 のアシスタント (ACT 形式。例: ロッキー、カイル (Office 97 版)) を読む。
 * 形式は公開されていないので、実ファイルを解析して分かった範囲で読む。
 *
 * - 先頭: "LP"、名前 (Shift-JIS)、大きさ (twip とピクセル)、区画の目次。目次の位置は、名前の直後からの相対位置
 * - 画像: 目録 (区画 0) から引く。種類は 3 つ
 *   - MNAK: ACS と同じ圧縮 → 4 枚分のランレングス画像 (色番号は Windows のハーフトーン パレット、10 が透明)
 *   - DCIK: 同じ形式で 1 枚だけ
 *   - プレースブル WMF: ベクターの部品
 *   - 合成コマ (0x14 で始まる): 複数の画像を、それぞれの範囲 (twip) に重ねたもの
 * - 効果音 (区画 1): WAV が順に並ぶ
 * - アニメーション (区画 3): 6 バイトの命令の列。0: 画像を出す, 1: 分岐 (確率 0 は必ず飛ぶ), 2: 効果音。
 *   「画像なし・0 秒」は終わりの印 (1 つのアニメーションに、分岐で選ばれる複数の動きが続けて入っていて、その区切り)。
 *   ただし先頭のものは、見えない状態から始まる印 (Greeting / Appear)。列の終わりを越えても終わる。
 *   ACS のような「終わらせるときの道筋」は無い
 * - 種類の表 (区画 4 の先頭): Office の msoAnimationType の番号 → アニメーション
 * - 文章 (区画 5) と、その位置の表 (区画 6)。1 つ目が名前、2 つ目が紹介文
 */

const SIGNATURE = 0x504c; // "LP"
const TRANSPARENT_INDEX = 10;
/** 命令 0 の画像番号がこれなら「何も出さない」 */
const NO_IMAGE = 0xffff;
const COMPOSITE_TAG = 0x14;

const OP_IMAGE = 0;
const OP_BRANCH = 1;
const OP_SOUND = 2;

/** Office の msoAnimationType の番号 → 名前 (ACS のアニメーション名に近い形) */
const ANIMATION_TYPES: Record<number, string> = {
  1: "Idle",
  2: "Greeting",
  3: "Goodbye",
  4: "BeginSpeaking",
  5: "RestPose",
  6: "CharacterSuccessMajor",
  11: "GetAttentionMajor",
  12: "GetAttentionMinor",
  13: "Searching",
  18: "Printing",
  19: "GestureRight",
  22: "WritingNotingSomething",
  23: "WorkingAtSomething",
  24: "Thinking",
  25: "SendingMail",
  26: "ListensToComputer",
  31: "Disappear",
  32: "Appear",
  100: "GetArtsy",
  101: "GetTechy",
  102: "GetWizardy",
  103: "CheckingSomething",
  104: "LookDown",
  105: "LookDownLeft",
  106: "LookDownRight",
  107: "LookLeft",
  108: "LookRight",
  109: "LookUp",
  110: "LookUpLeft",
  111: "LookUpRight",
  112: "Saving",
  113: "GestureDown",
  114: "GestureLeft",
  115: "GestureUp",
  116: "EmptyTrash",
};

/** 先頭が "LP" なら ACT とみなす */
export function isActFile(data: ArrayBuffer): boolean {
  return data.byteLength >= 2 && new DataView(data).getUint16(0, true) === SIGNATURE;
}

/** 合成コマの 1 層: 画像番号と、描く範囲 (twip) */
interface Layer {
  id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export class ActCharacter implements Character {
  readonly width: number;
  readonly height: number;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly animations = new Map<string, Animation>();
  readonly trayIcon = undefined;
  readonly voice = {};

  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  /** 画像の目録 (ファイル内の位置と、MNAK の何枚目か) */
  private readonly entries: { at: number; part: number }[] = [];
  private readonly imageEnd: number;
  /** 画像データの始まりの一覧 (昇順。各画像の終わり = 次の画像の始まり、を引くため) */
  private readonly imageStarts: number[];
  private readonly sounds: { at: number; size: number }[] = [];
  private readonly states = new Map<string, string[]>();
  /** 1 twip あたりの画素 */
  private readonly scale: number;
  private readonly imageCache = new Map<number, AcsImage>();
  private readonly chunkCache = new Map<number, Uint8Array>();
  /** WMF の部品を描く大きさ (合成コマで使われている範囲から決める) */
  private readonly wmfDrawSize = new Map<number, { width: number; height: number }>();

  constructor(buf: ArrayBuffer) {
    const v = (this.view = new DataView(buf));
    this.bytes = new Uint8Array(buf);
    if (!isActFile(buf)) throw new Error("ACT ファイルではありません");

    // --- 先頭 ---
    const nameLength = v.getUint16(0x08, true);
    const base = v.getUint16(0x0a, true); // 名前の直後。目次の位置はここからの相対
    const rawName = this.bytes.subarray(0x12, 0x12 + Math.max(0, nameLength - 1));
    const sectionCount = v.getUint16(base + 2, true);
    const frameTwipsW = v.getUint16(base + 8, true);
    const frameTwipsH = v.getUint16(base + 10, true);
    const framePixelsW = v.getUint16(base + 12, true);
    const framePixelsH = v.getUint16(base + 14, true);
    const imageBase = v.getUint32(base + 38, true) + base;
    const sections: number[] = [];
    for (let i = 0; i < sectionCount; i++) sections.push(v.getUint32(base + 42 + i * 4, true) + base);
    const sectionEnd = (i: number) => sections[i + 1] ?? buf.byteLength;

    // --- 画像の目録 (区画 0) ---
    this.imageEnd = sections[0]!;
    for (let at = sections[0]!; at + 4 <= sections[1]!; at += 4) {
      const e = v.getUint32(at, true);
      this.entries.push({ at: (e & 0x3fffffff) + imageBase, part: e >>> 30 });
    }
    this.imageStarts = [...new Set(this.entries.map((e) => e.at))].sort((a, b) => a - b);

    // 大きさ: ラスター画像があれば、その画素に合わせる (例: ロッキーは 124x93 の画像を 2490x1875 twip に描く)。
    // ベクター (WMF) だけなら、ヘッダーの画素 (96 dpi) に合わせる
    const raster = this.entries.findIndex((e) => this.kind(e.at) === "MNAK");
    const rasterWidth = raster >= 0 ? this.getImage(raster).width : 0;
    this.scale = rasterWidth > 0 ? rasterWidth / frameTwipsW : framePixelsW / frameTwipsW;
    this.width = Math.round(frameTwipsW * this.scale);
    this.height = Math.round(frameTwipsH * this.scale);
    if (!this.width || !this.height) throw new Error(`大きさを読めません (${framePixelsW}x${framePixelsH})`);

    // --- 効果音 (区画 1): WAV (RIFF) が、詰め物なしで順に並ぶ ---
    for (let at = sections[1]!; at + 8 <= sectionEnd(1); ) {
      if (v.getUint32(at, false) !== 0x52494646) break; // "RIFF"
      const size = v.getUint32(at + 4, true) + 8;
      this.sounds.push({ at, size });
      at += size;
    }

    // --- アニメーション (区画 3) と種類の表 (区画 4 の先頭) ---
    const programs: [number, number, number][][] = [];
    let at = sections[3]!;
    while (at + 10 <= buf.byteLength && v.getUint8(at) === 0 && v.getUint8(at + 1) === 1) {
      const count = v.getUint16(at + 2, true);
      const ops: [number, number, number][] = [];
      let q = at + 10;
      for (let r = 0; r < count - 1; r++, q += 6) ops.push([v.getUint16(q, true), v.getUint16(q + 2, true), v.getUint16(q + 4, true)]);
      programs.push(ops);
      at = q;
    }
    const names: string[] = programs.map((_, i) => `Animation${i}`);
    const typeCount = v.getUint32(at, true);
    for (let i = 0; i < typeCount; i++) {
      const row = at + 4 + i * 6;
      const type = v.getUint16(row, true), n = v.getUint16(row + 2, true), first = v.getUint16(row + 4, true);
      const typeName = ANIMATION_TYPES[type] ?? `Type${type}`;
      for (let k = 0; k < n; k++) if (first + k < names.length) names[first + k] = k === 0 ? typeName : `${typeName}_${k + 1}`;
    }
    programs.forEach((ops, i) => this.animations.set(names[i]!, this.toAnimation(names[i]!, ops)));

    // 状態: Office 97 の待機動作は Idle 1 つの中で分岐するので、どの段階も Idle にする
    const idle = this.animations.has("Idle") ? ["Idle"] : [];
    for (const level of [1, 2, 3]) this.states.set(`IDLINGLEVEL${level}`, idle);
    const pick = (...cands: string[]) => cands.filter((n) => this.animations.has(n));
    this.states.set("SHOWING", pick("Appear"));
    this.states.set("HIDING", pick("Disappear", "Goodbye"));

    // --- 名前と紹介文 ---
    const texts = this.readTexts(sections[5]!, sectionEnd(5), sections[6]!, sectionEnd(6));
    this.name = texts[0] || decodeShiftJis(rawName) || undefined;
    this.description = texts[1] || undefined;
  }

  get imageCount() {
    return this.entries.length;
  }

  stateAnimations(state: string): string[] {
    return this.states.get(state.toUpperCase()) ?? [];
  }

  getSound(index: number): Uint8Array | undefined {
    const s = this.sounds[index];
    return s && this.bytes.subarray(s.at, s.at + s.size);
  }

  getImage(index: number): AcsImage {
    const cached = this.imageCache.get(index);
    if (cached) return cached;
    const entry = this.entries[index];
    if (!entry) throw new Error(`画像 ${index} は存在しません`);
    let image: AcsImage;
    switch (this.kind(entry.at)) {
      case "MNAK":
      case "DCIK":
        image = this.readRaster(entry.at, entry.part);
        break;
      case "WMF": {
        const data = this.bytes.subarray(entry.at, this.nextImageStart(entry.at));
        const size = this.wmfDrawSize.get(index) ?? wmfSize(data) ?? { width: 1, height: 1 };
        image = renderWmf(data, size.width, size.height);
        break;
      }
      default:
        // 合成コマは画像ではなく、フレームの中で層に分けて描く
        image = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };
    }
    this.imageCache.set(index, image);
    return image;
  }

  private kind(at: number): "MNAK" | "DCIK" | "WMF" | "COMPOSITE" | undefined {
    if (at + 4 > this.bytes.length) return undefined;
    const tag = String.fromCharCode(...this.bytes.subarray(at, at + 4));
    if (tag === "MNAK" || tag === "DCIK") return tag;
    if (this.view.getUint32(at, true) === WMF_PLACEABLE_KEY) return "WMF";
    if (this.view.getUint16(at, true) === COMPOSITE_TAG) return "COMPOSITE";
    return undefined;
  }

  /** 画像データの終わり (次の画像の始まり。圧縮データの長さを知るため) */
  private nextImageStart(at: number): number {
    // 二分探索で、at より後ろの最初の始まり
    let lo = 0, hi = this.imageStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.imageStarts[mid]! <= at) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(this.imageStarts[lo] ?? this.imageEnd, this.imageEnd);
  }

  /** MNAK (4 枚) / DCIK (1 枚) の part 枚目を RGBA にする */
  private readRaster(at: number, part: number): AcsImage {
    const v = this.view;
    const multi = this.kind(at) === "MNAK";
    const size = v.getUint32(at + 4, true);
    const parts = multi ? v.getUint32(at + 8, true) : 1;
    const offsets = [0];
    for (let k = 1; k < parts; k++) offsets.push(v.getUint32(at + 12 + (k - 1) * 4, true));
    const dataStart = multi ? at + 12 + (parts - 1) * 4 : at + 8;
    let out = this.chunkCache.get(at);
    if (!out) {
      out = decompress(this.bytes.subarray(dataStart, this.nextImageStart(at)), size);
      this.chunkCache.set(at, out);
    }
    // 各枚: 幅・高さ・(1) の DWORD 3 つ、そのあとランレングス (n < 0x80: 次の 1 バイトを n 個 / それ以外: 下位 7 ビット個の生バイト)。下から上へ
    const o = offsets[part] ?? 0;
    const d = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const width = d.getUint32(o, true), height = d.getUint32(o + 4, true);
    const indices = new Uint8Array(width * height);
    let s = o + 12, n = 0;
    while (n < indices.length && s < out.length) {
      const t = out[s++]!;
      if (t < 0x80) {
        indices.fill(out[s++]!, n, Math.min(indices.length, n + t));
        n += t;
      } else {
        for (let k = 0; k < (t & 0x7f) && n < indices.length; k++) indices[n++] = out[s++]!;
      }
    }
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = indices[(height - 1 - y) * width + x]!;
        if (idx === TRANSPARENT_INDEX) continue;
        const [r, g, b] = HALFTONE_PALETTE[idx]!;
        const q = (y * width + x) * 4;
        rgba[q] = r;
        rgba[q + 1] = g;
        rgba[q + 2] = b;
        rgba[q + 3] = 255;
      }
    }
    return { width, height, rgba };
  }

  private layers(at: number): Layer[] {
    const v = this.view;
    const count = v.getUint16(at + 2, true);
    const layers: Layer[] = [];
    for (let k = 0; k < count; k++) {
      const o = at + 4 + k * 10;
      layers.push({ id: v.getUint16(o, true), left: v.getInt16(o + 2, true), top: v.getInt16(o + 4, true), right: v.getInt16(o + 6, true), bottom: v.getInt16(o + 8, true) });
    }
    return layers;
  }

  /** 画像番号 → フレームに描く画像 (先頭が最前面)。合成コマは層に分ける */
  private frameImages(id: number): FrameImage[] {
    const entry = this.entries[id];
    if (!entry) return [];
    if (this.kind(entry.at) !== "COMPOSITE") return [{ imageIndex: id, x: 0, y: 0 }];
    // 合成コマの層は、先に書かれたものが奥
    return this.layers(entry.at)
      .reverse()
      .map((l) => {
        const x = Math.round(l.left * this.scale), y = Math.round(l.top * this.scale);
        const width = Math.round((l.right - l.left) * this.scale), height = Math.round((l.bottom - l.top) * this.scale);
        const layerEntry = this.entries[l.id];
        if (layerEntry && this.kind(layerEntry.at) === "WMF" && !this.wmfDrawSize.has(l.id)) this.wmfDrawSize.set(l.id, { width, height });
        return { imageIndex: l.id, x, y, width, height };
      });
  }

  /**
   * 命令の列を、ACS と同じフレームの列にする (命令 1 つ = フレーム 1 つで、番号がそのまま分岐先になる)。
   * 画像を出す命令以外 (分岐・効果音) は、画像なし・0 秒のフレーム (プレイヤーは描かずに次へ進む)。
   * ACT には終わらせるときの道筋が無い (ループを抜けられない) ので、どのフレームも終了分岐を「列の外」にして、
   * 終わらせる指示 (release) が来たら、今のフレームで終わるようにする
   */
  private toAnimation(name: string, ops: [number, number, number][]): Animation {
    const frames: Frame[] = ops.map(([op, a, b], i) => {
      const frame: Frame = { images: [], soundIndex: -1, duration: 0, exitFrame: ops.length, branches: [], overlays: [] };
      if (op === OP_IMAGE) {
        if (a !== NO_IMAGE) {
          frame.images = this.frameImages(a);
          frame.duration = b;
        } else if (b > 0) {
          // 「何も出さない」に時間があれば、その間は消える (例: カイルが水に潜っている間)
          frame.duration = b;
        } else if (i > 0) {
          // 0 秒なら、ここで終わり (列の外へ飛ぶ)。先頭のものは、見えない状態から始まる印なので何もしない
          frame.branches = [{ frameIndex: ops.length, probability: 100 }];
        }
      } else if (op === OP_BRANCH) {
        // 確率は 65536 分の b (%)。0 は必ず飛ぶ
        frame.branches = [{ frameIndex: a, probability: b === 0 ? 100 : (b / 65536) * 100 }];
      } else if (op === OP_SOUND) {
        frame.soundIndex = a;
      }
      return frame;
    });
    return { name, transitionType: 2, returnAnimation: "", frames };
  }

  /** 文章 (UTF-16) を、区画 6 にある (位置 u32, 長さ u16) の表で切り分ける。表が見つからなければ空 */
  private readTexts(textStart: number, textEnd: number, tableStart: number, tableEnd: number): string[] {
    const v = this.view;
    const textBytes = textEnd - textStart;
    // 表の始まり: 1 件目が位置 0、2 件目が 1 件目の長さの位置、になっているところ
    for (let at = tableStart; at + 12 <= tableEnd; at += 2) {
      const len0 = v.getUint16(at + 4, true);
      if (v.getUint32(at, true) !== 0 || len0 === 0 || v.getUint32(at + 6, true) !== len0) continue;
      const texts: string[] = [];
      for (let q = at; q + 6 <= tableEnd; q += 6) {
        const off = v.getUint32(q, true), len = v.getUint16(q + 4, true);
        if (off + len > textBytes || len % 2) break;
        texts.push(new TextDecoder("utf-16le").decode(this.bytes.subarray(textStart + off, textStart + off + len)));
      }
      if (texts.length >= 2) return texts;
    }
    return [];
  }
}

function decodeShiftJis(bytes: Uint8Array): string {
  try {
    return new TextDecoder("shift_jis").decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
}
