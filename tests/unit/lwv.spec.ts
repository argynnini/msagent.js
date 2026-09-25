import { expect, test } from "@playwright/test";
import { ipaAt, readLwv } from "../../src/lwv";
import { mouthForIpa } from "../../src/mouth";
import { makeWav } from "../browser/fixtures";
import { makeLwv } from "../lwv";

const buffer = (bytes: number[]) => new Uint8Array(bytes).buffer;

test("readLwv: 単語と音素の時刻 (バイトの位置 → 秒)・IPA・言語 ID を読む", () => {
  const lwv = readLwv(
    buffer(
      makeLwv(makeWav(1, 0), 0x0409, [[0, 0.5, "hello"], [0.5, 1, "world"]], [
        [0, 0.25, "0x0068"],
        [0.25, 0.5, "0x0259"],
        [0.5, 1, "0x0074+0x0283"],
      ]),
    ),
  )!;
  expect(lwv.language).toBe(0x0409);
  expect(lwv.words).toEqual([{ start: 0, end: 0.5, text: "hello" }, { start: 0.5, end: 1, text: "world" }]);
  expect(lwv.phonemes.map((p) => p.ipa)).toEqual([[0x68], [0x259], [0x74, 0x283]]);
  expect(lwv.phonemes[2]).toMatchObject({ start: 0.5, end: 1 });
});

test("readLwv: 単語は言語 ID の文字コードで読み、2 つの音をつないだ IPA の文字 (ʧ など) は分ける", () => {
  // 「こんにちは」の Shift_JIS
  const sjis = [0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd];
  const lwv = readLwv(buffer(makeLwv(makeWav(0.5, 0), 0x0411, [[0, 0.5, sjis]], [[0, 0.5, "0x02A7"]])))!;
  expect(lwv.words[0]!.text).toBe("こんにちは");
  expect(lwv.phonemes[0]!.ipa).toEqual([0x74, 0x283]);
});

test("readLwv: 言語情報の無い WAV や、WAV でないものは undefined", () => {
  expect(readLwv(buffer(makeWav(0.1, 0)))).toBeUndefined();
  expect(readLwv(new ArrayBuffer(8))).toBeUndefined();
});

test("ipaAt: 時刻の音。無いところは無音 (_)、2 つの音の音素は時間を等分する", () => {
  const phonemes = [{ start: 0.2, end: 0.4, ipa: [0x74, 0x283] }];
  expect(ipaAt(phonemes, 0.1)).toBe(0x5f);
  expect(ipaAt(phonemes, 0.25)).toBe(0x74);
  expect(ipaAt(phonemes, 0.35)).toBe(0x283);
  expect(ipaAt(phonemes, 0.4)).toBe(0x5f);
});

test("mouthForIpa: 本家の表と同じ口の形", () => {
  const shape = (s: string) => [...s].map((c) => mouthForIpa(c.codePointAt(0)!));
  expect(shape("_bmp")).toEqual([0, 0, 0, 0]); // 閉じる
  expect(shape("iɪfv")).toEqual([1, 1, 1, 1]);
  expect(shape("dtse")).toEqual([2, 2, 2, 2]);
  expect(shape("əɑʌ")).toEqual([3, 3, 3]);
  expect(shape("aæh")).toEqual([4, 4, 4]);
  expect(shape("ɔʃɹ")).toEqual([5, 5, 5]); // 中くらい
  expect(shape("ouw")).toEqual([6, 6, 6]); // すぼめる
  expect(mouthForIpa(0x3042)).toBeUndefined(); // 表に無い
});
