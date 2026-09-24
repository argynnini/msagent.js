/**
 * ACS に入っている効果音 (WAV) のデコーダ。
 * ブラウザの decodeAudioData は Microsoft ADPCM を扱えないので自前で PCM にする。
 * 対応: PCM (8/16bit) と Microsoft ADPCM (4bit)。いずれもモノラルのみ。
 */
export interface DecodedWav {
  sampleRate: number;
  samples: Float32Array<ArrayBuffer>;
}

const ADAPT_TABLE = [230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230];

export function decodeWav(data: Uint8Array): DecodedWav | undefined {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 12 || dv.getUint32(0, true) !== 0x46464952 /* RIFF */) return undefined;

  let fmt: { tag: number; channels: number; rate: number; blockAlign: number; bits: number; coefs: [number, number][] } | undefined;
  let pcm: Uint8Array | undefined;

  for (let p = 12; p + 8 <= data.length; ) {
    const id = String.fromCharCode(data[p]!, data[p + 1]!, data[p + 2]!, data[p + 3]!);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      const coefs: [number, number][] = [];
      const tag = dv.getUint16(body, true);
      if (tag === 2 && size >= 22) {
        const n = dv.getUint16(body + 20, true);
        for (let i = 0; i < n; i++) coefs.push([dv.getInt16(body + 22 + i * 4, true), dv.getInt16(body + 24 + i * 4, true)]);
      }
      fmt = {
        tag,
        channels: dv.getUint16(body + 2, true),
        rate: dv.getUint32(body + 4, true),
        blockAlign: dv.getUint16(body + 12, true),
        bits: dv.getUint16(body + 14, true),
        coefs,
      };
    } else if (id === "data") {
      pcm = data.subarray(body, Math.min(body + size, data.length));
    }
    p = body + size + (size & 1);
  }
  if (!fmt || !pcm || fmt.channels !== 1) return undefined;

  if (fmt.tag === 1) {
    if (fmt.bits === 16) {
      const n = pcm.length >> 1;
      const out = new Float32Array(n);
      const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) / 32768;
      return { sampleRate: fmt.rate, samples: out };
    }
    if (fmt.bits === 8) {
      return { sampleRate: fmt.rate, samples: Float32Array.from(pcm, (b) => (b - 128) / 128) };
    }
    return undefined;
  }

  if (fmt.tag === 2 && fmt.bits === 4 && fmt.coefs.length > 0) {
    return { sampleRate: fmt.rate, samples: decodeMsAdpcm(pcm, fmt.blockAlign, fmt.coefs) };
  }
  return undefined;
}

function decodeMsAdpcm(src: Uint8Array, blockAlign: number, coefs: [number, number][]): Float32Array<ArrayBuffer> {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const out: number[] = [];
  const clamp = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

  for (let start = 0; start + 7 <= src.length; start += blockAlign) {
    const end = Math.min(start + blockAlign, src.length);
    const [c1, c2] = coefs[src[start]!] ?? [256, 0];
    let delta = dv.getInt16(start + 1, true);
    let s1 = dv.getInt16(start + 3, true);
    let s2 = dv.getInt16(start + 5, true);
    out.push(s2, s1);

    const step = (nibble: number) => {
      const signed = nibble >= 8 ? nibble - 16 : nibble;
      const sample = clamp(((s1 * c1 + s2 * c2) >> 8) + signed * delta);
      delta = Math.max(16, (ADAPT_TABLE[nibble]! * delta) >> 8);
      s2 = s1;
      s1 = sample;
      out.push(sample);
    };
    for (let i = start + 7; i < end; i++) {
      step(src[i]! >> 4);
      step(src[i]! & 0x0f);
    }
  }
  return Float32Array.from(out, (v) => v / 32768);
}
