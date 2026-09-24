/**
 * Microsoft Agent (ACS) の画像データ圧縮を展開する。
 *
 * 先頭 1 バイト (0x00) の後に LSB ファーストのビット列が続く。
 *   0 + 8bit                : リテラル 1 バイト
 *   1 + オフセット + 長さ   : LZ 参照 (offset 全ビット 1 が終端)
 */
class BitReader {
  private pos = 0;
  private bit = 0;
  constructor(private readonly data: Uint8Array) {}

  readBit(): number {
    const byte = this.data[this.pos];
    if (byte === undefined) throw new Error("圧縮データが途中で終わっています");
    const v = (byte >> this.bit) & 1;
    if (++this.bit === 8) {
      this.bit = 0;
      this.pos++;
    }
    return v;
  }

  readBits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v += this.readBit() * 2 ** i;
    return v;
  }
}

const OFFSET_BITS = [6, 9, 12, 20];
const OFFSET_BASE = [1, 0x41, 0x241, 0x1241];

export function decompress(src: Uint8Array, expectedSize: number): Uint8Array {
  const out = new Uint8Array(expectedSize);
  let o = 0;
  const r = new BitReader(src.subarray(1));

  while (o < expectedSize) {
    if (r.readBit() === 0) {
      out[o++] = r.readBits(8);
      continue;
    }

    let n = 0;
    while (n < 3 && r.readBit() === 1) n++;
    const raw = r.readBits(OFFSET_BITS[n]!);
    if (n === 3 && raw === 0xfffff) break;
    const offset = raw + OFFSET_BASE[n]!;

    let k = 0;
    while (k < 12 && r.readBit() === 1) k++;
    // 20 ビットオフセットの一致だけ最小長が 1 大きい
    const length = r.readBits(k) + 2 ** k + (n === 3 ? 2 : 1);

    if (offset > o) throw new Error("圧縮データが不正です (参照位置が範囲外)");
    for (let i = 0; i < length && o < expectedSize; i++, o++) {
      out[o] = out[o - offset]!;
    }
  }
  return out;
}
