import { expect, test } from "@playwright/test";
import { parseCharacter } from "../../src/agent";
import { languageTag, pickLanguage } from "../../src/language";
import { CHARACTERS, readCharacter, requireCharacters } from "../characters";

test.describe("言語の選び方 (ファイルが無くてもできるもの)", () => {
  // マーリンと同じ並び (英語は主言語だけの 0x0009)
  const available = [0x0009, 0x0401, 0x0404, 0x0407, 0x0411, 0x0804, 0x0408, 0x0416, 0x0816];

  test("完全に一致 → 同じ主言語 → 英語 → 最初、の順", () => {
    expect(pickLanguage(available, "ja")).toBe(0x0411);
    expect(pickLanguage(available, "zh-TW")).toBe(0x0404);
    expect(pickLanguage(available, "zh-CN")).toBe(0x0804);
    expect(pickLanguage(available, "pt-PT")).toBe(0x0816);
    expect(pickLanguage(available, 0x0408)).toBe(0x0408);
    expect(pickLanguage(available, "xx")).toBe(0x0009);
    expect(pickLanguage(available, ["xx", "de"])).toBe(0x0407);
    expect(pickLanguage([0x0411], "fr")).toBe(0x0411);
  });

  test("言語 ID → BCP 47", () => {
    expect(languageTag(0x0411)).toBe("ja-JP");
    expect(languageTag(0x0404)).toBe("zh-TW");
    expect(languageTag(0x0009)).toBe("en");
  });
});

test.describe("ACS / ACT の読み込み", () => {
  test("マーリン: 名前・紹介文 (言語ごと)・声・吹き出し・GUID・版", () => {
    requireCharacters(CHARACTERS.merlin);
    const c = parseCharacter(readCharacter(CHARACTERS.merlin));
    expect([c.width, c.height]).toEqual([128, 128]);
    expect(c.getName("ja")).toBe("マーリン");
    expect(c.getName("zh-TW")).toBe("梅林");
    expect(c.getName("zh-CN")).toBe("默林");
    expect(c.getName(0x0408)).toBe("Ο Μάγος");
    expect(c.getName("xx")).toBe("Merlin");
    expect(c.languages.length).toBe(30);
    expect(c.getDescription("de")).toMatch(/^Ich bin Euer weiser/);
    expect(c.voice).toMatchObject({ speed: 156, pitch: 50, language: "en-US", gender: "male", age: 30, style: "Business" });
    expect(c.balloon).toMatchObject({
      background: "#ffffe1", foreground: "#000000", border: "#000000", fontFamily: "MS Sans Serif", fontSize: 13,
      lines: 2, charsPerLine: 32, enabled: true, sizeToText: true, autoHide: true, autoPace: true,
    });
    expect(c.guid).toBe("{4E574F44-B521-11D0-9E9A-00C04FD7081F}");
    expect(c.version).toBe("2.1");
    expect(c.stateAnimations("Speaking")).toEqual(["RestPose"]);
  });

  test("フィンフィン: 戻りアニメの名前を、実在する表記に直す (MOVELEFTRETURN → MoveLeftReturn)", () => {
    requireCharacters(CHARACTERS.finfin);
    const c = parseCharacter(readCharacter(CHARACTERS.finfin));
    expect(c.animations.get("MoveLeft")!.returnAnimation).toBe("MoveLeftReturn");
    expect(c.animations.get("GestureLeft")!.returnAnimation).toBe("GestureLeftReturn");
    expect(c.balloon).toMatchObject({ background: "#ffffd2", sizeToText: false });
    expect(c.voice.gender).toBe("female");
  });

  test("クリッパー: 声の設定なし、吹き出しは行数固定", () => {
    requireCharacters(CHARACTERS.clippit);
    const c = parseCharacter(readCharacter(CHARACTERS.clippit));
    expect(c.voice).toEqual({});
    expect(c.balloon).toMatchObject({ sizeToText: false, charsPerLine: 28 });
    expect(c.stateAnimations("GesturingLeft")).toEqual(["GestureLeft"]);
  });

  test("Rocky (.act): 状態 (Showing = Appear など)、言語ごとの名前・吹き出し・版は無い", () => {
    requireCharacters(CHARACTERS.rocky);
    const c = parseCharacter(readCharacter(CHARACTERS.rocky));
    expect(c.name).toBe("Rocky");
    expect(c.stateAnimations("Showing")).toEqual(["Appear"]);
    expect(c.stateAnimations("Hiding")).toEqual(["Disappear", "Goodbye"]);
    expect(c.languages).toEqual([]);
    expect(c.balloon).toBeUndefined();
    expect(c.version).toBeUndefined();
  });
});
