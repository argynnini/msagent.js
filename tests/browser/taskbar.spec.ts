import { CHARACTERS, requireCharacters } from "../characters";
import { expect, test } from "./fixtures";

test("name / description: 代入すると変わり、undefined でキャラクターファイルのものに戻る", async ({ harness }) => {
  requireCharacters(CHARACTERS.merlin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs", { language: "ja", taskbarIcon: true });
    const icon = document.querySelector<HTMLElement>(".msagent-taskbar-icon")!;
    const before = [a.name, icon.title];
    a.name = "メルリン";
    a.description = "説明";
    const changed = [a.name, a.description, icon.title];
    a.name = undefined;
    a.description = undefined;
    return { before, changed, restored: [a.name, a.description!.length > 10] };
  });
  expect(r.before).toEqual(["マーリン", "マーリン"]);
  expect(r.changed).toEqual(["メルリン", "説明", "メルリン"]);
  expect(r.restored).toEqual(["マーリン", true]);
});

test("タスクバーのアイコン: クリックで出し直し、隠れている間の右クリックは「表示」と音声コマンドだけ", async ({
  harness,
}) => {
  requireCharacters(CHARACTERS.merlin);
  await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs", { language: "ja", taskbarIcon: true });
    a.on("click", (e) => log.push(`click:${e.detail.source}:${e.detail.button}`));
    a.on("show", (e) => log.push(`show:${e.detail.cause}`));
    Object.assign(window, { a, log });
  });
  // Merlin にはタスクトレイ用のアイコンがある
  expect(await harness.$eval(".msagent-taskbar-icon", (e) => e.firstElementChild!.tagName)).toBe("IMG");

  await harness.click(".msagent-taskbar-icon");
  await harness.waitForFunction(() => window.a.visible);
  await harness.evaluate(() => window.a.hide(true));

  await harness.click(".msagent-taskbar-icon", { button: "right" });
  const items = await harness.$$eval(".msagent-menu .msagent-menu-item", (els) => els.map((e) => e.textContent));
  expect(items.at(-1)).toBe("表示(S)");
  expect(items.some((t) => t!.includes("隠す"))).toBe(false);
  await harness.click(".msagent-menu >> text=表示");
  await harness.waitForFunction(() => window.a.visible);

  // 見えているときの右クリックは、キャラクターと同じメニュー
  await harness.click(".msagent-taskbar-icon", { button: "right" });
  expect(await harness.$$eval(".msagent-menu .msagent-menu-item", (els) => els.at(-1)!.textContent)).toBe("隠す(H)");
  await harness.keyboard.press("Escape");

  const log = await harness.evaluate(() => window.log);
  expect(log).toEqual([
    "click:taskbarIcon:left",
    "show:user",
    "click:taskbarIcon:right",
    "show:user",
    "click:taskbarIcon:right",
  ]);
});

test("タスクバーのアイコン: アイコンの無いキャラクターは止まっているときの絵。消す・破棄すると取り除く", async ({
  harness,
}) => {
  requireCharacters(CHARACTERS.merlin, CHARACTERS.clippit);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs", { taskbarIcon: true });
    const b = await window.loadAgent("CLIPPIT.ACS", { taskbarIcon: true });
    const count = () => document.querySelectorAll(".msagent-taskbar-icon").length;
    const tags = [...document.querySelectorAll(".msagent-taskbar-icon")].map((e) => e.firstElementChild!.tagName);
    const two = count();
    a.taskbarIcon = false;
    const afterOff = [count(), a.taskbarIcon, b.taskbarIcon];
    b.destroy();
    return { tags, two, afterOff, tray: document.querySelector(".msagent-taskbar") === null };
  });
  expect(r.tags).toEqual(["IMG", "CANVAS"]);
  expect(r.two).toBe(2);
  expect(r.afterOff).toEqual([1, false, true]);
  expect(r.tray).toBe(true);
});
