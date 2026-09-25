import { CHARACTERS, requireCharacters } from "../characters";
import { expect, opaquePoint, test } from "./fixtures";

test.beforeEach(async ({ harness }) => {
  requireCharacters(CHARACTERS.merlin);
  await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    (window as unknown as { a: typeof a }).a = a;
    a.moveTo(500, 300, 0);
    await a.show(true);
  });
});

test("透明な部分は押せず、下のページに届く。絵の部分は押せる", async ({ harness }) => {
  // キャラクターの真下にボタンを広げる
  await harness.evaluate(() => {
    const r = window.a.element.getBoundingClientRect();
    const b = document.getElementById("under")!;
    Object.assign(b.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    (window as unknown as { underClicks: number }).underClicks = 0;
    b.onclick = () => (window as unknown as { underClicks: number }).underClicks++;
  });
  const underClicks = () => harness.evaluate(() => (window as unknown as { underClicks: number }).underClicks);
  await harness.mouse.move(503, 303);
  await harness.mouse.click(503, 303);
  expect(await underClicks()).toBe(1);
  const pt = await opaquePoint(harness);
  await harness.mouse.move(...pt);
  await harness.mouse.click(...pt);
  expect(await underClicks()).toBe(1);
});

test("絵をつかむとドラッグで動き、透明な部分からは動かない。ドラッグの後は click が来ない", async ({ harness }) => {
  const pt = await opaquePoint(harness);
  await harness.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { log: string[] }).log = log;
    for (const t of ["click", "dragstart", "dragend", "move"] as const) window.a.on(t, () => log.push(t));
  });
  await harness.mouse.move(...pt);
  await harness.mouse.down();
  await harness.mouse.move(pt[0] - 200, pt[1] - 50, { steps: 5 });
  await harness.mouse.up();
  expect(await harness.evaluate(() => [window.a.left, window.a.top])).toEqual([300, 250]);
  await harness.mouse.move(303, 253);
  await harness.mouse.down();
  await harness.mouse.move(400, 350, { steps: 5 });
  await harness.mouse.up();
  expect(await harness.evaluate(() => [window.a.left, window.a.top])).toEqual([300, 250]);
  expect(await harness.evaluate(() => (window as unknown as { log: string[] }).log)).toEqual(["dragstart", "dragend", "move"]);
  expect(await harness.evaluate(() => window.a.moveCause)).toBe("drag");
});

test("click: 左・右・中ボタンと Shift。dblclick は preventDefault で animate しない", async ({ harness }) => {
  const pt = await opaquePoint(harness);
  await harness.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { log: string[] }).log = log;
    window.a.autoPopupMenu = false;
    window.a.on("click", (e) => log.push(`${e.detail.button}${e.detail.shift ? "+shift" : ""}`));
    window.a.on("dblclick", (e) => (e.preventDefault(), log.push("dblclick")));
    window.a.on("requeststart", (e) => log.push(`request ${e.detail.request.type}`));
  });
  await harness.mouse.move(...pt);
  await harness.mouse.click(...pt);
  await harness.keyboard.down("Shift");
  await harness.mouse.click(...pt);
  await harness.keyboard.up("Shift");
  await harness.mouse.click(...pt, { button: "right" });
  await harness.waitForTimeout(400);
  await harness.mouse.dblclick(...pt);
  await harness.waitForTimeout(400);
  await harness.mouse.click(...pt, { button: "middle" });
  expect(await harness.evaluate(() => (window as unknown as { log: string[] }).log)).toEqual([
    "left",
    "left+shift",
    "right",
    "left",
    "left",
    "dblclick",
    "middle",
  ]);
});

test("右クリックのメニュー: 足した項目・区切り・隠す。アクセスキー・矢印キー・Esc・外のクリック", async ({ harness }) => {
  await harness.evaluate(() => {
    const a = window.a;
    const log: string[] = [];
    (window as unknown as { log: string[] }).log = log;
    a.commands.add("search", "検索(&S)");
    a.commands.add("help", "ヘルプ(&H)", { enabled: false });
    a.commands.add("secret", "見えない", { visible: false });
    a.commands.add("about", "情報(&A)");
    a.commands.defaultCommand = "search";
    a.on("command", (e) => log.push(e.detail.name));
    a.on("hide", (e) => log.push(`hide ${e.detail.cause}`));
  });
  const pt = await opaquePoint(harness);
  await harness.mouse.move(...pt);
  await harness.mouse.click(...pt, { button: "right" });
  const items = await harness.$$eval(".msagent-menu > *", (els) =>
    els.map((e) =>
      e.classList.contains("msagent-menu-separator")
        ? "---"
        : `${e.textContent}${(e as HTMLButtonElement).disabled ? " (灰色)" : ""}${(e as HTMLElement).style.fontWeight === "700" ? " (太字)" : ""}`,
    ),
  );
  expect(items).toEqual(["検索(S) (太字)", "ヘルプ(H) (灰色)", "情報(A)", "---", "音声コマンドを開く(O)", "隠す(H)"]);
  await harness.keyboard.press("a"); // アクセスキー
  await harness.mouse.click(...pt, { button: "right" });
  await harness.keyboard.press("ArrowDown"); // 検索 → 情報 (灰色は飛ばす)
  await harness.keyboard.press("Enter");
  await harness.mouse.click(...pt, { button: "right" });
  await harness.keyboard.press("Escape");
  expect(await harness.$(".msagent-menu")).toBeNull();
  await harness.mouse.click(...pt, { button: "right" });
  await harness.mouse.click(10, 880);
  expect(await harness.$(".msagent-menu")).toBeNull();
  // autoPopupMenu = false なら出ない。showPopupMenu では出せる
  await harness.evaluate(() => (window.a.autoPopupMenu = false));
  await harness.mouse.click(...pt, { button: "right" });
  expect(await harness.$(".msagent-menu")).toBeNull();
  // commands.fontName / fontSize (ポイント) で、メニューの文字を変える
  await harness.evaluate(() => {
    window.a.commands.fontName = "Georgia";
    window.a.commands.fontSize = 12;
  });
  expect(await harness.evaluate(() => window.a.showPopupMenu(300, 300))).toBe(true);
  expect(await harness.$eval(".msagent-menu", (e) => [(e as HTMLElement).style.fontFamily, (e as HTMLElement).style.fontSize])).toEqual(["Georgia", "12pt"]);
  await harness.click(".msagent-menu >> text=隠す");
  await harness.waitForFunction(() => !window.a.visible);
  expect(await harness.evaluate(() => (window as unknown as { log: string[] }).log)).toEqual(["about", "about", "hide user"]);
});

declare global {
  interface Window {
    a: import("../../src/index").Agent;
  }
}

test("右クリックのメニューは、何度手前に出したキャラクターよりも手前に出る", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    for (let i = 0; i < 5; i++) a.activate();
    a.showPopupMenu(100, 100);
    const menu = document.querySelector<HTMLElement>(".msagent-menu")!;
    return { menu: Number(getComputedStyle(menu).zIndex), agent: Number(getComputedStyle(a.element).zIndex) };
  });
  expect(r.menu).toBeGreaterThan(r.agent);
});

test("ヘルプモード: キャラクターを押すと click / ドラッグの代わりに helpcomplete。メニューの項目も同じ。終わるとふつうに戻る", async ({ harness }) => {
  await harness.evaluate(() => {
    const a = window.a;
    const log: string[] = [];
    (window as unknown as { log: string[] }).log = log;
    a.helpContextId = 10;
    a.commands.add("search", "検索(&S)", { helpContextId: 42 });
    for (const type of ["click", "dragstart", "command", "hide"] as const) a.on(type, () => log.push(type));
    a.on("helpcomplete", (e) => log.push(`help ${e.detail.cause} ${e.detail.name || "-"} ${e.detail.helpContextId ?? "-"}`));
    a.helpModeOn = true;
  });
  const pt = await opaquePoint(harness);
  const before = await harness.evaluate(() => [window.a.left, window.a.top]);
  // 押してドラッグしても動かず、helpcomplete だけ来て、ヘルプモードが終わる
  await harness.mouse.move(...pt);
  expect(await harness.$eval(".msagent", (e) => getComputedStyle(e).cursor)).toBe("help");
  await harness.mouse.down();
  await harness.mouse.move(pt[0] + 40, pt[1] + 40, { steps: 4 });
  await harness.mouse.up();
  expect(await harness.evaluate(() => [window.a.left, window.a.top, window.a.helpModeOn])).toEqual([...before, false]);
  // メニューの項目・「隠す」も、ヘルプモードならヘルプ (コマンドは実行しない・隠れない)
  await harness.evaluate(() => (window.a.helpModeOn = true));
  await harness.mouse.click(...pt, { button: "right" });
  await harness.click(".msagent-menu >> text=検索");
  await harness.evaluate(() => (window.a.helpModeOn = true));
  await harness.mouse.click(...pt, { button: "right" });
  await harness.click(".msagent-menu >> text=隠す");
  // ヘルプモードでなければ、ふつうのクリック
  await harness.mouse.click(...pt);
  expect(await harness.evaluate(() => [window.a.visible, (window as unknown as { log: string[] }).log])).toEqual([
    true,
    ["help character - 10", "click", "help command search 42", "click", "help hide - -", "click"],
  ]);
});
