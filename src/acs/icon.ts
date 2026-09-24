import type { AcsImage } from "./reader";

/** BITMAPINFOHEADER のあとに色テーブル・画素が続く DIB (ファイルヘッダーなし) を読む */
interface Dib {
  width: number;
  height: number;
  /** (x, y) の色 [r, g, b]。y は上から */
  pixel(x: number, y: number): [number, number, number];
}

function readDib(data: Uint8Array): Dib {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerSize = v.getUint32(0, true);
  const width = v.getInt32(4, true);
  const rawHeight = v.getInt32(8, true);
  const bitCount = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  const colorsUsed = v.getUint32(32, true);
  if (compression !== 0) throw new Error(`圧縮された DIB (${compression}) には対応していません`);
  if (![1, 4, 8, 24, 32].includes(bitCount)) throw new Error(`${bitCount} bit の DIB には対応していません`);

  const height = Math.abs(rawHeight);
  // 高さが正ならボトムアップ (最終行から格納)
  const bottomUp = rawHeight > 0;
  const tableCount = bitCount <= 8 ? colorsUsed || 1 << bitCount : 0;
  const table: [number, number, number][] = [];
  for (let i = 0; i < tableCount; i++) {
    const o = headerSize + i * 4;
    table.push([data[o + 2]!, data[o + 1]!, data[o]!]);
  }
  const bitsOffset = headerSize + tableCount * 4;
  const stride = Math.ceil((width * bitCount) / 32) * 4;
  if (bitsOffset + stride * height > data.length) throw new Error("DIB のデータが足りません");

  return {
    width,
    height,
    pixel(x, y) {
      const row = bitsOffset + (bottomUp ? height - 1 - y : y) * stride;
      if (bitCount >= 24) {
        const o = row + x * (bitCount / 8);
        return [data[o + 2]!, data[o + 1]!, data[o]!];
      }
      const bit = x * bitCount;
      const index = (data[row + (bit >> 3)]! >> (8 - bitCount - (bit & 7))) & ((1 << bitCount) - 1);
      return table[index] ?? [0, 0, 0];
    },
  };
}

/** アイコンなどの画像を PNG の data URL にする (<img> や favicon に使う。ブラウザ専用) */
export function imageToDataUrl(image: AcsImage): string {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  return c.toDataURL("image/png");
}

/**
 * タスクトレイ用のアイコン (Windows のアイコンと同じ、色の DIB + 白黒のマスク DIB) を RGBA にする。
 * マスクのビットが 1 の画素は透明。読めなければ undefined
 */
export function decodeTrayIcon(color: Uint8Array, mask: Uint8Array): AcsImage | undefined {
  try {
    const c = readDib(color);
    const m = readDib(mask);
    const { width, height } = c;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = c.pixel(x, y);
        // マスクが色より小さいことはまず無いが、はみ出す分は不透明にする
        const transparent = x < m.width && y < m.height && m.pixel(x, y)[0] !== 0;
        const o = (y * width + x) * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = transparent ? 0 : 255;
      }
    }
    return { width, height, rgba };
  } catch {
    return undefined;
  }
}
