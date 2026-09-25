/**
 * テスト用に、言語情報つきの音声ファイル (.lwv) を作る (src/lwv.ts に書いた形: WAV の後ろに LIST 'WPMK')
 */

/** 単語・音素 1 つ: 開始・終わり (秒) と文字 (文字列なら ASCII、数の並びならそのままのバイト) */
export type LwvMark = [start: number, end: number, label: string | number[]];

/** wav (makeWav で作ったもの) の後ろに、言語 ID・単語・音素を足す */
export function makeLwv(wav: number[], lcid: number, words: LwvMark[], phonemes: LwvMark[]): number[] {
  const bytesPerSec = new DataView(new Uint8Array(wav).buffer).getUint32(28, true);
  const out: number[] = [];
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const u64 = (n: number) => [...u32(n), 0, 0, 0, 0];
  const id = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const chunk = (name: string, body: number[]) => [...id(name), ...u32(body.length), ...body, ...(body.length & 1 ? [0] : [])];
  const marks = (list: LwvMark[]) =>
    list.flatMap(([start, end, label]) => {
      const bytes = [...(typeof label === "string" ? id(label) : label), 0];
      while (bytes.length % 4) bytes.push(0);
      return [...u64(Math.round(start * bytesPerSec)), ...u64(Math.round(end * bytesPerSec)), ...u32(bytes.length), ...bytes];
    });
  const list = [...id("WPMK"), ...chunk("LCID", u32(lcid)), ...chunk("WMRK", marks(words)), ...chunk("PMRK", marks(phonemes))];
  out.push(...wav, ...chunk("LIST", list));
  return out;
}
