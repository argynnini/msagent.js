import { CHARACTERS, requireCharacters } from "../characters";
import { expect, test } from "./fixtures";

// 手元のジニーの ACA は Show と Greet だけ (ほかは 404 か、Merlin のものでチェックサムが合わない)
test("ACF: 先読みしたものは読み込みの時点で入り、ほかは再生するときに ACA を取り寄せる", async ({ harness }) => {
  requireCharacters(CHARACTERS.genie, CHARACTERS.genieShow, CHARACTERS.genieGreet);
  const result = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Genie.acf", { preload: ["Showing"] });
    a.on("animationstart", (e) => log.push(e.detail.name));
    const c = a.character as InstanceType<typeof window.M.AcfCharacter>;
    const before = { show: c.isLoaded("Show"), greet: c.isLoaded("Greet") };
    await a.show();
    await a.play("Greet");
    const d = a.canvas.getContext("2d")!.getImageData(0, 0, a.canvas.width, a.canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) opaque++;
    return { log, before, greet: c.isLoaded("Greet"), opaque };
  });
  expect(result.before).toEqual({ show: true, greet: false });
  expect(result.log).toEqual(["Show", "Greet"]);
  expect(result.greet).toBe(true);
  expect(result.opaque).toBeGreaterThan(1000);
});

test("ACF: get() は ACA を取り寄せる。無い・チェックサムが合わないものは failed (0x8004200F)", async ({ harness }) => {
  requireCharacters(CHARACTERS.genie, CHARACTERS.genieShow, CHARACTERS.genieGreet, CHARACTERS.merlinGestureUp);
  const result = await harness.evaluate(async () => {
    const a = await window.loadAgent("Genie.acf", { preload: [] });
    const requests = ["Greet", "Wave", "GestureUp", "NoSuchAnimation"].map((n) => a.get("animation", n));
    for (const r of requests) await r;
    return requests.map((r) => [r.status, r.number]);
  });
  expect(result).toEqual([
    ["complete", 0],
    ["failed", -2147213297],
    ["failed", -2147213297],
    ["failed", -2147213309],
  ]);
});

test("ACF: 先読みするものの ACA が無ければ、読み込みは失敗する", async ({ harness }) => {
  requireCharacters(CHARACTERS.genie);
  const error = await harness.evaluate(() => window.loadAgent("Genie.acf", { preload: ["RestPose"] }).then(() => "", (e) => String(e)));
  expect(error).toMatch(/RestPose/);
});
