import { test as base, type Page } from "@playwright/test";
import type { Agent, AgentOptions } from "../../src/index";
import { characterPath } from "../characters";

declare global {
  interface Window {
    /** ライブラリ (src/index.ts) */
    M: typeof import("../../src/index");
    /** テスト用: 名前でキャラクターを読む (声と待機動作は既定で切る) */
    loadAgent(name: string, options?: AgentOptions): Promise<Agent>;
    ready: boolean;
  }
}

/**
 * テスト用のページ (tests/harness) を開く。/characters/<名前> の中身は、MSAGENT_CHARACTERS のファイルを返す
 */
export const test = base.extend<{ harness: Page }>({
  harness: async ({ page }, use) => {
    await page.route("**/characters/*", async (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
      const path = characterPath(name);
      await (path ? route.fulfill({ path }) : route.fulfill({ status: 404 }));
    });
    await page.goto("/tests/harness/index.html");
    await page.waitForFunction(() => window.ready);
    await use(page);
  },
});

export { expect } from "@playwright/test";

/** キャラクターの絵のある点 (画面上の位置) を 1 つ探す (真ん中より下から) */
export async function opaquePoint(page: Page, agentExpr = "window.a"): Promise<[number, number]> {
  return page.evaluate((expr) => {
    const a = (0, eval)(expr) as Agent;
    const r = a.element.getBoundingClientRect();
    const c = a.canvas;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const sx = r.width / c.width;
    const sy = r.height / c.height;
    for (let y = (c.height / 2) | 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3]) return [r.left + (x + 3) * sx, r.top + (y + 2) * sy] as [number, number];
    }
    throw new Error("絵が見つかりません");
  }, agentExpr);
}

/** 16bit / 16kHz / モノラルの WAV を作る (前半 silentSec 秒は無音、残りは大きな音) */
export function makeWav(silentSec: number, loudSec: number): number[] {
  const rate = 16000;
  const n = Math.round(rate * (silentSec + loudSec));
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, i < rate * silentSec ? 0 : Math.round(Math.sin(i / 8) * 20000), true);
  return [...new Uint8Array(buf)];
}
