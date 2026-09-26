import { expect, test } from "@playwright/test";
import { MOUTH_CLOSED, mouthForLevel, mouthSteps, stepsDuration } from "../../src/mouth";
import { findVoice, pickVoice, voiceParams } from "../../src/voice";

const voice = (name: string, lang: string, isDefault = false) => ({ name, lang, default: isDefault }) as SpeechSynthesisVoice;
const voices = [
  voice("Microsoft Haruka - Japanese (Japan)", "ja-JP", true),
  voice("Microsoft Ichiro - Japanese (Japan)", "ja-JP"),
  voice("Microsoft Zira - English (United States)", "en-US", true),
  voice("Microsoft David - English (United States)", "en-US"),
  voice("Google UK English Male", "en-GB"),
  voice("Microsoft Hedda - German (Germany)", "de-DE"),
  voice("Microsoft Helle - Danish (Denmark)", "da-DK"),
];
const pick = (lang: string, gender?: "male" | "female") => pickVoice(voices, lang, gender)?.name;

test("声は、言語 → 性別の順に合わせて選ぶ", () => {
  expect(pick("ja-JP", "male")).toBe("Microsoft Ichiro - Japanese (Japan)");
  expect(pick("ja", "female")).toBe("Microsoft Haruka - Japanese (Japan)");
  expect(pick("ja-JP")).toBe("Microsoft Haruka - Japanese (Japan)"); // 既定の声
  expect(pick("en-US", "male")).toBe("Microsoft David - English (United States)");
  // 合う性別の声が無ければ、その言語の声
  expect(pick("en-GB", "female")).toBe("Google UK English Male");
  // 言語の合う声が無ければ、ブラウザ任せ
  expect(pick("fr-FR", "male")).toBeUndefined();
});

test("声の名前の単語の一部 (Germany の man、Denmark の mark) で性別を間違えない", () => {
  expect(pick("de-DE", "male")).toBe("Microsoft Hedda - German (Germany)"); // 男性の声は無いので、その言語の声
  expect(pickVoice([voice("Microsoft Helle - Danish (Denmark)", "da-DK"), voice("Other", "da-DK")], "da", "female")?.name).toBe(
    "Microsoft Helle - Danish (Denmark)",
  );
});

test("ACS の声の設定 (語/分・Hz) を、ブラウザの速さ・高さに直す", () => {
  expect(voiceParams({ speed: 170, pitch: 100 })).toEqual({ rate: 1, pitch: 1 });
  expect(voiceParams({ speed: 156, pitch: 50 }).rate).toBeCloseTo(0.918, 2);
  expect(voiceParams({})).toEqual({ rate: 1, pitch: 1 });
  // 範囲に収める
  expect(voiceParams({ speed: 1000, pitch: 1000 })).toEqual({ rate: 2, pitch: 2 });
});

test("口の形: かなは母音から、ん・っは閉じる、小さいかなは前の拍に合わせる", () => {
  const shapes = (text: string) => mouthSteps(text, 100).map(([shape]) => shape);
  expect(shapes("あいうえお")).toEqual([4, 1, 6, 2, 5]);
  expect(shapes("カン")).toEqual([4, MOUTH_CLOSED]);
  expect(shapes("きゃ")).toEqual([4]);
  expect(shapes("mama")).toEqual([MOUTH_CLOSED, 4, MOUTH_CLOSED, 4]);
  expect(stepsDuration(mouthSteps("あい", 100))).toBe(200);
  // 句読点は、閉じた口の間
  expect(mouthSteps("あ、い", 100, 250)).toEqual([[4, 100], [MOUTH_CLOSED, 250], [1, 100]]);
});

test("音の大きさから口の形を決める", () => {
  expect(mouthForLevel(0)).toBe(MOUTH_CLOSED);
  expect(mouthForLevel(0.03)).toBe(1);
  // 本家と同じく、大きいほど 0 → 1 → 2 → 3 → 4
  expect(mouthForLevel(0.07)).toBe(2);
  expect(mouthForLevel(0.15)).toBe(3);
  expect(mouthForLevel(0.5)).toBe(4);
});

test("findVoice: voiceURI、無ければ名前 (大文字小文字は問わない) で探す", () => {
  const list = [
    { name: "Microsoft Haruka", voiceURI: "urn:a", lang: "ja-JP", default: true },
    { name: "urn:a", voiceURI: "urn:b", lang: "en-US", default: false },
  ] as unknown as SpeechSynthesisVoice[];
  expect(findVoice(list, "urn:a")?.voiceURI).toBe("urn:a");
  expect(findVoice(list, "microsoft haruka")?.voiceURI).toBe("urn:a");
  expect(findVoice(list, "nothing")).toBeUndefined();
});
