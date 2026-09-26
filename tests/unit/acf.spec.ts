import { expect, test } from "@playwright/test";
import { AcfCharacter } from "../../src/acf/reader";
import { parseCharacter } from "../../src/agent";
import { CHARACTERS, readCharacter, requireCharacters } from "../characters";

function genie(): AcfCharacter {
  const c = parseCharacter(readCharacter(CHARACTERS.genie), { baseUrl: "https://example.com/genie/" });
  expect(c).toBeInstanceOf(AcfCharacter);
  return c as AcfCharacter;
}

test.describe("ACF / ACA の読み込み", () => {
  test("ジニー (.acf): 名前・声・吹き出し・状態・アニメーションの一覧", () => {
    requireCharacters(CHARACTERS.genie);
    const c = genie();
    expect([c.width, c.height]).toEqual([128, 128]);
    expect(c.version).toBe("2.1");
    expect(c.getName("ja")).toBe("ジニー");
    expect(c.getName("xx")).toBe("Genie");
    expect(c.languages.length).toBe(30);
    expect(c.voice).toMatchObject({
      speed: 157,
      pitch: 64,
      language: "en-US",
      gender: "male",
      age: 30,
      style: "Business",
    });
    expect(c.balloon).toMatchObject({
      background: "#ffffe1",
      fontFamily: "MS Sans Serif",
      fontSize: 13,
      lines: 2,
      charsPerLine: 28,
    });
    expect(c.palette.length).toBe(256);
    expect(c.trayIcon).toBeDefined();
    expect(c.animations.size).toBe(76);
    expect(c.stateAnimations("Showing")).toEqual(["Show"]);
    expect(c.stateAnimations("IdlingLevel1")).toContain("Idle1_4");
    // コマは ACA を読み込むまで空。ACA の場所は baseUrl から見た相対パス
    expect(c.animations.get("Show")!.frames).toEqual([]);
    expect(c.isLoaded("Show")).toBe(false);
    expect(c.animationUrl("Show")!.href).toBe("https://example.com/genie/Show.aca");
  });

  test("ロビィ (.acf)", () => {
    requireCharacters(CHARACTERS.robby);
    const c = parseCharacter(readCharacter(CHARACTERS.robby));
    expect(c.getName("ja")).toBe("ロビィ");
    expect(c.animations.size).toBe(68);
    expect(c.voice).toMatchObject({ speed: 155, pitch: 82 });
  });

  test("ACA: 効果音・コマ全体の 1 枚絵・終了分岐", () => {
    requireCharacters(CHARACTERS.genie, CHARACTERS.genieShow);
    const c = genie();
    c.addAnimationData("Show", readCharacter(CHARACTERS.genieShow));
    const show = c.animations.get("Show")!;
    expect(c.isLoaded("Show")).toBe(true);
    expect(show.transitionType).toBe(2);
    expect(show.frames.length).toBe(11);
    expect(show.frames[0]).toMatchObject({
      images: [{ imageIndex: 0, x: 0, y: 0 }],
      soundIndex: 0,
      duration: 50,
      exitFrame: 1,
    });
    expect(show.frames[10]!.exitFrame).toBe(-2);
    const img = c.getImage(show.frames[5]!.images[0]!.imageIndex);
    expect([img.width, img.height]).toEqual([128, 128]);
    // 透明色と、そうでない色の両方がある
    const alpha = new Set<number>();
    for (let i = 3; i < img.rgba.length; i += 4) alpha.add(img.rgba[i]!);
    expect([...alpha].sort()).toEqual([0, 255]);
    expect(new TextDecoder().decode(c.getSound(0)!.subarray(0, 4))).toBe("RIFF");
  });

  test("ACA: 口の画像は切り出した範囲と位置を持ち、番号はキャラクター全体で通し", () => {
    requireCharacters(CHARACTERS.genie, CHARACTERS.genieShow, CHARACTERS.genieGreet);
    const c = genie();
    c.addAnimationData("Show", readCharacter(CHARACTERS.genieShow));
    const before = c.imageCount;
    c.addAnimationData("Greet", readCharacter(CHARACTERS.genieGreet));
    const greet = c.animations.get("Greet")!;
    expect(greet.frames.length).toBe(15);
    expect(greet.frames[0]!.images[0]!.imageIndex).toBe(before);
    expect(greet.frames[9]!.branches).toEqual([{ frameIndex: 14, probability: 100 }]);
    const overlays = greet.frames[9]!.overlays;
    expect(overlays.map((o) => o.type)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(overlays[0]).toMatchObject({ x: 54, y: 47, width: 25, height: 18 });
    const mouth = c.getImage(overlays[0]!.imageIndex);
    expect([mouth.width, mouth.height]).toEqual([25, 18]);
  });

  test("ACA: ACF とチェックサムが合わない (別のキャラクターの) ものは読まない", () => {
    requireCharacters(CHARACTERS.genie, CHARACTERS.merlinGestureUp);
    const c = genie();
    expect(() => c.addAnimationData("GestureUp", readCharacter(CHARACTERS.merlinGestureUp))).toThrow(/checksum/);
    expect(c.isLoaded("GestureUp")).toBe(false);
    expect(c.animations.get("GestureUp")!.frames).toEqual([]);
  });
});

test("ACS: 先頭バイトが 0 の画像は絵なし (フィンフィンの MoveLeftReturn の最後のコマ)", () => {
  requireCharacters(CHARACTERS.finfin);
  const c = parseCharacter(readCharacter(CHARACTERS.finfin));
  const last = c.animations.get("MoveLeftReturn")!.frames.at(-1)!;
  const empty = c.getImage(last.images[0]!.imageIndex);
  expect([empty.width, empty.height]).toEqual([0, 0]);
  const next = c.getImage(last.images[0]!.imageIndex + 1);
  expect([next.width, next.height]).toEqual([128, 128]);
});
