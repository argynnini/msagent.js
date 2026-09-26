import { expect, test, type Page } from "@playwright/test";
import type { Agent } from "../../src/index";
import { CHARACTERS, characterPath, requireCharacters } from "../characters";

declare global {
  interface Window {
    /** デモが読み込んだキャラクター */
    agent: Agent;
  }
}

/** デモのページを開き、キャラクターファイルを選ぶ (読み上げは切る) */
async function openDemo(page: Page, name: string) {
  await page.goto("/example/index.html");
  await page.click("#voice");
  await page.setInputFiles("#file", characterPath(name)!);
  await page.waitForFunction(() => window.agent?.visible);
  await page.evaluate(() => {
    window.agent.stop();
    window.agent.closeBalloon();
  });
}

for (const name of [CHARACTERS.merlin, CHARACTERS.finfin, CHARACTERS.rocky, CHARACTERS.kairuAct]) {
  test(`${name}: 読み込み・話す・考える・隠す / 出す`, async ({ page }) => {
    requireCharacters(name);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openDemo(page, name);
    await page.fill("#text", "テストです");
    await page.click("text=話す");
    await page.click("#think");
    // 退場のアニメーションは長いものがある (.act のカイルの Disappear は最大 7 秒ほど)
    const visible = () => page.evaluate(() => window.agent.visible);
    await page.click("#visible"); // すぐ隠す
    await expect.poll(visible, { timeout: 15_000 }).toBe(false);
    await page.click("#visible");
    await expect.poll(visible, { timeout: 15_000 }).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("ステージのクリックで移動し、操作パネル (言語の選択など) のクリックでは動かない", async ({ page }) => {
  requireCharacters(CHARACTERS.merlin);
  await openDemo(page, CHARACTERS.merlin);
  await page.evaluate(() => {
    const w = window as unknown as { moves: number };
    w.moves = 0;
    window.agent.on("requeststart", (e) => e.detail.request.type === "moveTo" && w.moves++);
  });
  const moves = () => page.evaluate(() => (window as unknown as { moves: number }).moves);
  await page.selectOption("#lang", "de-DE");
  await page.click("summary >> nth=0");
  await page.click(".events");
  await page.waitForTimeout(500);
  expect(await moves()).toBe(0);
  // ステージ (キャラクターの絵から離れた、左上の隅) をクリック
  await page.locator("#drop").click({ position: { x: 30, y: 20 } });
  await expect.poll(moves).toBe(1);
});

test("移動にかける時間 (ms) の入力が moveTo の duration になる。「指す」のときは入力できない", async ({ page }) => {
  requireCharacters(CHARACTERS.merlin);
  await openDemo(page, CHARACTERS.merlin);
  await page.evaluate(() => {
    const w = window as unknown as { durations: number[] };
    w.durations = [];
    const moveTo = window.agent.moveTo.bind(window.agent);
    window.agent.moveTo = (x, y, d) => (w.durations.push(d!), moveTo(x, y, d));
  });
  const points: [number, number][] = [
    [700, 130],
    [1080, 380],
    [700, 380],
  ];
  for (const [i, v] of ["0", "2500", ""].entries()) {
    await page.fill("#duration", v);
    await page.mouse.click(...points[i]!);
  }
  expect(await page.evaluate(() => (window as unknown as { durations: number[] }).durations)).toEqual([0, 2500, 1000]);
  await page.click(".seg >> text=指す");
  expect(await page.$eval("#duration", (el) => (el as HTMLInputElement).disabled)).toBe(true);
});

test("「話す」は空欄なら自己紹介 (選んだ言語)", async ({ page }) => {
  requireCharacters(CHARACTERS.merlin);
  await openDemo(page, CHARACTERS.merlin);
  await page.selectOption("#lang", "de-DE");
  await page.click("text=話す");
  await expect.poll(() => page.textContent(".msagent-content")).toMatch(/^Ich/);
});
