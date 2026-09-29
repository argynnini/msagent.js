import { CHARACTERS, requireCharacters } from "../characters";
import { expect, test } from "./fixtures";

test.beforeEach(() => requireCharacters(CHARACTERS.merlin));

test("scale / width: 足もと (下端の真ん中) をそろえて大きさを変え、拡大しても当たり判定は合う", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    a.moveTo(500, 300, 0);
    await a.show(true);
    const foot = () => {
      const b = a.element.getBoundingClientRect();
      return [Math.round(b.left + b.width / 2), Math.round(b.bottom), b.width];
    };
    const before = foot();
    a.scale = 2;
    const twice = foot();
    a.width = 64;
    const small = [...foot(), a.scale];
    a.scale = 2;
    const b = a.element.getBoundingClientRect();
    return {
      before,
      twice,
      small,
      center: a.hitTest(b.left + b.width / 2, b.top + b.height * 0.6),
      corner: a.hitTest(b.left + 2, b.top + 2),
    };
  });
  expect(r.twice).toEqual([r.before[0], r.before[1], 256]);
  expect(r.small).toEqual([r.before[0], r.before[1], 64, 0.5]);
  expect(r.center).toBe(true);
  expect(r.corner).toBe(false);
});

test("balloonStyle: ファイルの設定の上に重ね、undefined で戻す。load の balloon でも指定できる", async ({
  harness,
}) => {
  const r = await harness.evaluate(async () => {
    const css = () => {
      const b = getComputedStyle(document.querySelector(".msagent-balloon")!);
      const c = getComputedStyle(document.querySelector(".msagent-content")!);
      return { bg: b.backgroundColor, border: b.borderTopColor, size: c.fontSize, maxWidth: c.maxWidth };
    };
    const a = await window.loadAgent("Merlin.acs");
    const file = css();
    a.balloonStyle = { background: "#222222", fontSize: 16 };
    const over = css();
    const kept = a.balloonStyle.border;
    a.balloonStyle = undefined;
    const reset = css();
    const b = await window.loadAgent("Merlin.acs", { balloon: { background: "#ffe0f0" } });
    return { file, over, kept, reset, loaded: b.balloonStyle.background };
  });
  expect(r.file).toEqual({ bg: "rgb(255, 255, 225)", border: "rgb(0, 0, 0)", size: "13px", maxWidth: "229px" });
  expect(r.over).toMatchObject({ bg: "rgb(34, 34, 34)", border: "rgb(0, 0, 0)", size: "16px" });
  expect(r.kept).toBe("#000000");
  expect(r.reset).toEqual(r.file);
  expect(r.loaded).toBe("#ffe0f0");
});

test("プロパティ: visible / left / top / 原因 / 版 / おまけの文字 / 手前に出す", async ({ harness }) => {
  requireCharacters(CHARACTERS.finfin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    const b = await window.loadAgent("finfin.acs");
    const before = { visible: a.visible, visibilityCause: a.visibilityCause, moveCause: a.moveCause };
    a.left = 100;
    a.top = 200;
    await a.show(true);
    b.moveTo(160, 220, 0);
    await b.show(true);
    const activeAfterShow = [a.active, b.active];
    const activated = a.activate();
    return {
      before,
      after: { visible: a.visible, visibilityCause: a.visibilityCause, moveCause: a.moveCause, pos: [a.left, a.top] },
      version: a.version,
      extraData: a.extraData!.length > 0,
      activeAfterShow,
      activated,
      activeAfterActivate: [a.active, b.active],
    };
  });
  expect(r.before).toEqual({ visible: false, visibilityCause: "none", moveCause: "none" });
  expect(r.after).toEqual({ visible: true, visibilityCause: "program", moveCause: "moveTo", pos: [100, 200] });
  expect(r.version).toBe("2.1");
  expect(r.extraData).toBe(true);
  expect(r.activeAfterShow).toEqual([false, true]);
  expect(r.activated).toBe(true);
  expect(r.activeAfterActivate).toEqual([true, false]);
});

test("activateinput / deactivateinput: 手前のキャラクターが変わると知らせ、隠れたら見えている残りに移す", async ({
  harness,
}) => {
  requireCharacters(CHARACTERS.merlin, CHARACTERS.finfin, CHARACTERS.clippit);
  const r = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs");
    const b = await window.loadAgent("finfin.acs");
    const c = await window.loadAgent("CLIPPIT.ACS");
    for (const [name, agent] of [
      ["a", a],
      ["b", b],
      ["c", c],
    ] as const) {
      agent.on("activateinput", () => log.push(`+${name}`));
      agent.on("deactivateinput", () => log.push(`-${name}`));
    }
    const step = (label: string) => log.push(`|${label}`);
    step("show a");
    await a.show(true);
    step("show b");
    await b.show(true);
    step("show c");
    await c.show(true);
    step("activate a (もう手前でも、2 回目は何も出ない)");
    a.activate();
    a.activate();
    step("hide a → c (b より手前)");
    await a.hide(true);
    step("destroy c → b");
    c.destroy();
    step("hide b → なし");
    await b.hide(true);
    return { log, active: [a.active, b.active, c.active] };
  });
  expect(r.log).toEqual([
    "|show a",
    "+a",
    "|show b",
    "-a",
    "+b",
    "|show c",
    "-b",
    "+c",
    "|activate a (もう手前でも、2 回目は何も出ない)",
    "-c",
    "+a",
    "|hide a → c (b より手前)",
    "-a",
    "+c",
    "|destroy c → b",
    "-c",
    "+b",
    "|hide b → なし",
    "-b",
  ]);
  expect(r.active).toEqual([false, false, false]);
});

test("ブラウザの窓が小さくなったら、画面の中に戻して move (reposition)", async ({ harness }) => {
  const moved = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    a.moveTo(1000, 700, 0);
    await a.show(true);
    const log: string[] = [];
    a.on("move", (e) => log.push(e.detail.by));
    (window as unknown as { a2: typeof a; log2: string[] }).a2 = a;
    (window as unknown as { log2: string[] }).log2 = log;
  });
  expect(moved).toBeUndefined();
  await harness.setViewportSize({ width: 800, height: 600 });
  await harness.waitForTimeout(200);
  const r = await harness.evaluate(() => {
    const w = window as unknown as { a2: import("../../src/index").Agent; log2: string[] };
    const b = w.a2.element.getBoundingClientRect();
    return { log: w.log2, inside: b.right <= 800 && b.bottom <= 600, cause: w.a2.moveCause };
  });
  expect(r).toEqual({ log: ["reposition"], inside: true, cause: "reposition" });
});

test("待機状態: 何もしないと idlestart、次の命令で idlecomplete。idleOn = false なら待機動作をしない", async ({
  harness,
}) => {
  test.slow();
  const r = await harness.evaluate(async () => {
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs", { idle: true });
    const b = await window.loadAgent("Merlin.acs", { idle: true });
    a.moveTo(100, 300, 0);
    b.moveTo(600, 300, 0);
    await Promise.all([a.show(true), b.show(true)]);
    b.idleOn = false;
    let bIdle = 0;
    b.on("animationstart", (e) => e.detail.idle && bIdle++);
    a.on("idlestart", () => log.push(`idlestart idling=${a.idling}`));
    a.on("idlecomplete", () => log.push("idlecomplete"));
    const before = a.idling;
    await sleep(10000);
    await a.play("Wave");
    return { log, bIdle, before, after: a.idling };
  });
  // agent.idling は idlestart から idlecomplete まで true
  expect(r.log).toEqual(["idlestart idling=true", "idlecomplete"]);
  expect([r.before, r.after]).toEqual([false, false]);
  expect(r.bIdle).toBe(0);
});

test("load: 設定をまとめて渡したときも、後ろの引数のコールバックを呼ぶ", async ({ harness }) => {
  const r = await harness.evaluate(
    () =>
      new Promise<string>((resolve) => {
        window.M.default.load({ name: "/characters/Merlin.acs", voice: false, idle: false }, (agent) =>
          resolve(agent.name ?? ""),
        );
      }),
  );
  expect(r).toBeTruthy();
});
