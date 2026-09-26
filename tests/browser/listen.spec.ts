import type { Page } from "@playwright/test";
import { CHARACTERS, requireCharacters } from "../characters";
import { expect, test } from "./fixtures";

test.beforeEach(() => requireCharacters(CHARACTERS.merlin));

declare global {
  interface Window {
    /** テスト用の音声認識 (作られた順) */
    recs: FakeRecognition[];
    /** 聞こえたことにする (候補: [文, 確かさ]) */
    say(alternatives: [string, number][]): void;
    log: string[];
  }
  interface FakeRecognition {
    lang: string;
    fail(error: string): void;
  }
}

/** ブラウザの音声認識を、テスト用のものに差し替える (キャラクターを読み込む前に) */
async function fakeRecognition(page: Page) {
  await page.evaluate(() => {
    window.recs = [];
    window.log = [];
    class Fake extends EventTarget {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        window.recs.push(this as unknown as FakeRecognition);
      }
      stop() {
        setTimeout(() => this.onend?.(), 10);
      }
      abort() {}
      fail(error: string) {
        this.onerror?.({ error });
        setTimeout(() => this.onend?.(), 10);
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = Fake;
    window.say = (alternatives) => {
      const rec = window.recs.at(-1) as unknown as Fake;
      rec.onspeechstart?.();
      const result = Object.assign(
        alternatives.map(([transcript, confidence]) => ({ transcript, confidence })),
        { isFinal: true },
      );
      rec.onresult?.({ resultIndex: 0, results: [result] });
    };
  });
}

/** キャラクターを出し、声のコマンドを足して、イベントを window.log に記録する */
async function setup(page: Page, options: Record<string, unknown> = {}) {
  await fakeRecognition(page);
  await page.evaluate(async (options) => {
    const a = await window.loadAgent("Merlin.acs", { language: "en", ...options });
    (window as unknown as { a: typeof a }).a = a;
    a.moveTo(300, 200, 0);
    await a.show(true);
    a.commands.voiceCaption = "Test";
    a.commands.add("search", "Search", { voice: "[please] (search | find) [...]" });
    a.commands.add("quiet", "Quiet", { voice: "be quiet", confidence: 50, confidenceText: "Say it again?" });
    a.on("listenstart", (e) => window.log.push(`start ${e.detail.mode}`));
    a.on("listencomplete", (e) => window.log.push(`complete ${e.detail.cause}`));
    a.on("command", (e) => {
      const d = e.detail;
      window.log.push(
        `command ${d.name || "-"} ${d.source} ${d.confidence} "${d.voice}" ${d.count} ${d.alternatives.map((x) => x.name).join(",")}`,
      );
    });
  }, options);
}

const tipText = (page: Page) =>
  page.$eval(".msagent-listening-tip", (e) => [(e as HTMLElement).style.display, e.textContent]);
const log = (page: Page) => page.evaluate(() => window.log);

test("listen(true): 聞き始め、1 つ言い終えたら command を知らせてやめる。ヒントに聞いていること・聞こえた文を出す", async ({
  harness,
}) => {
  await setup(harness);
  expect(await harness.evaluate(() => window.a.listen(true))).toBe(true);
  expect(await harness.evaluate(() => [window.a.listening, window.recs[0]!.lang])).toEqual([true, "en"]);
  expect(await tipText(harness)).toEqual(["block", '-- Merlin is listening --for "Test" commands']);
  await harness.evaluate(() =>
    window.say([
      ["Please find my file", 0.9],
      ["please fine my file", 0.2],
    ]),
  );
  await harness.waitForFunction(() => !window.a.listening);
  expect(await log(harness)).toEqual([
    "start program",
    'command search voice 90 "Please find my file" 1 ',
    "complete finished",
  ]);
  expect(await tipText(harness)).toEqual(["block", '-- Merlin is not listening --Heard "Please find my file"']);
});

test("listen(false) でやめる。どのコマンドにも合わなければ name は空で count は 0。確かさが低ければ confidenceText", async ({
  harness,
}) => {
  await setup(harness);
  await harness.evaluate(() => window.a.listen(true));
  await harness.evaluate(() => window.say([["what time is it", 0.8]]));
  await harness.waitForFunction(() => !window.a.listening);
  expect(await tipText(harness)).toEqual([
    "block",
    '-- Merlin is not listening --Didn\'t understand "what time is it"',
  ]);
  await harness.evaluate(() => window.a.listen(true));
  await harness.evaluate(() => window.say([["be quiet", 0.4]]));
  await harness.waitForFunction(() => !window.a.listening);
  expect((await tipText(harness))[1]).toContain("Say it again?");
  await harness.evaluate(() => window.a.listen(true));
  expect(await harness.evaluate(() => window.a.listen(false))).toBe(true);
  await harness.waitForFunction(() => !window.a.listening);
  expect(await log(harness)).toEqual([
    "start program",
    'command - voice 80 "what time is it" 0 ',
    "complete finished",
    "start program",
    'command quiet voice 40 "be quiet" 1 ',
    "complete finished",
    "start program",
    "complete program",
  ]);
});

test("聞き取りキー: 押している間聞き (いくつ言ってもよい)、離したらやめる。Listening の状態のアニメーション", async ({
  harness,
}) => {
  await setup(harness, { listeningKey: "F8" });
  await harness.evaluate(() => {
    window.a.on("animationstart", (e) => window.log.push(`anim ${e.detail.name}`));
  });
  await harness.keyboard.down("F8");
  await harness.waitForFunction(() => window.a.listening);
  await harness.evaluate(() => window.say([["search", 0.9]]));
  await harness.evaluate(() => window.say([["find it", 0.7]]));
  expect(await harness.evaluate(() => [window.a.listening, window.a.listen(false)])).toEqual([true, false]);
  await harness.keyboard.up("F8");
  await harness.waitForFunction(() => !window.a.listening);
  const entries = await log(harness);
  expect(entries.filter((l) => !l.startsWith("anim"))).toEqual([
    "start key",
    'command search voice 90 "search" 1 ',
    'command search voice 70 "find it" 1 ',
    "complete key",
  ]);
  // マーリンの Listening / Hearing の状態のアニメーション
  expect(entries.filter((l) => l.startsWith("anim")).length).toBeGreaterThan(0);
});

test("listeningKeyTimeout: キーを離してもその秒数は聞き、話している途中なら言い終えるまで聞く", async ({ harness }) => {
  await setup(harness, { listeningKey: "F8", listeningKeyTimeout: 0.3 });
  // 離した後に言っても聞き取り、時間が来たらやめる
  await harness.keyboard.down("F8");
  await harness.waitForFunction(() => window.a.listening);
  await harness.keyboard.up("F8");
  expect(await harness.evaluate(() => window.a.listening)).toBe(true);
  await harness.evaluate(() => window.say([["search", 0.9]]));
  await harness.waitForFunction(() => !window.a.listening);

  // 時間が来たときに話している途中なら、言い終えてからやめる
  await harness.keyboard.down("F8");
  await harness.waitForFunction(() => window.a.listening);
  await harness.keyboard.up("F8");
  await harness.evaluate(() => (window.recs.at(-1) as unknown as { onspeechstart: () => void }).onspeechstart());
  await harness.waitForTimeout(600);
  expect(await harness.evaluate(() => window.a.listening)).toBe(true);
  await harness.evaluate(() => window.say([["find it", 0.7]]));
  await harness.waitForFunction(() => !window.a.listening);

  expect(await log(harness)).toEqual([
    "start key",
    'command search voice 90 "search" 1 ',
    "complete key",
    "start key",
    'command search voice 70 "find it" 1 ',
    "complete key",
  ]);
});

test("「hide Merlin」「隠れて」: msagent.js が用意したコマンドで隠れる (name は空、hide の cause は user)", async ({
  harness,
}) => {
  await setup(harness);
  await harness.evaluate(() => window.a.on("hide", (e) => window.log.push(`hide ${e.detail.cause}`)));
  await harness.evaluate(() => window.a.listen(true));
  await harness.evaluate(() => window.say([["Hide Merlin", 0.95]]));
  await harness.waitForFunction(() => !window.a.visible);
  expect(await log(harness)).toContain('command - voice 95 "Hide Merlin" 1 ');
  expect(await log(harness)).toContain("hide user");
  // globalVoiceCommandsEnabled = false なら隠れない
  await harness.evaluate(async () => {
    await window.a.show(true);
    window.a.commands.globalVoiceCommandsEnabled = false;
    window.a.listen(true);
    window.say([["隠れて", 0.9]]);
  });
  await harness.waitForFunction(() => !window.a.listening);
  expect(await harness.evaluate(() => window.a.visible)).toBe(true);
});

test("音声認識が無いブラウザでは listen は false、srStatus は 4。マイクを許可されなければ error で終わり、srStatus は 5", async ({
  harness,
}) => {
  const r = await harness.evaluate(async () => {
    // Chrome には本物 (webkitSpeechRecognition) があるので、消して試す
    const w = window as unknown as Record<string, unknown>;
    const real = w.webkitSpeechRecognition;
    w.SpeechRecognition = w.webkitSpeechRecognition = undefined;
    const a = await window.loadAgent("Merlin.acs");
    const result = [a.listen(true), a.srStatus];
    w.webkitSpeechRecognition = real;
    a.destroy();
    return result;
  });
  expect(r).toEqual([false, 4]);
  await setup(harness);
  await harness.evaluate(() => {
    window.a.listen(true);
    window.recs[0]!.fail("not-allowed");
  });
  await harness.waitForFunction(() => !window.a.listening);
  expect(await harness.evaluate(() => window.a.srStatus)).toBe(5);
  expect(await log(harness)).toEqual(["start program", "complete error"]);
});

test("ヘルプモードで声のコマンドを言うと、コマンドの代わりに helpcomplete。audioOutput.status は聞き取り中 5、聞こえている間 3", async ({
  harness,
}) => {
  await setup(harness);
  const r = await harness.evaluate(async () => {
    const a = window.a;
    const out = window.M.audioOutput;
    a.commands.get("search")!.helpContextId = 7;
    a.on("helpcomplete", (e) => window.log.push(`help ${e.detail.cause} ${e.detail.name} ${e.detail.helpContextId}`));
    a.helpModeOn = true;
    const statuses = [out.status];
    a.listen(true);
    statuses.push(out.status);
    const rec = window.recs[0] as unknown as { onspeechstart: () => void };
    rec.onspeechstart();
    statuses.push(out.status);
    window.say([["search", 0.9]]);
    return { statuses, help: a.helpModeOn };
  });
  await harness.waitForFunction(() => !window.a.listening);
  expect(r.statuses).toEqual([0, 5, 3]);
  expect(r.help).toBe(false);
  expect(await log(harness)).toEqual(["start program", "help command search 7", "complete finished"]);
});

test("聞き取り中にユーザーの声が聞こえている間は、キャラクターの声を出さない (吹き出しは出す)", async ({ harness }) => {
  await setup(harness, { voice: true });
  const r = await harness.evaluate(async () => {
    const utterances: string[] = [];
    speechSynthesis.speak = (u) => {
      utterances.push(u.text);
      setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 10);
    };
    const a = window.a;
    a.listen(true);
    (window.recs[0] as unknown as { onspeechstart: () => void }).onspeechstart();
    await a.speak("While you talk");
    const balloon = document.querySelector(".msagent-content")!.textContent;
    window.say([["nothing", 0.5]]);
    await new Promise((res) => setTimeout(res, 50));
    await a.speak("After you talk");
    return { utterances, balloon };
  });
  expect(r).toEqual({ utterances: ["After you talk"], balloon: "While you talk" });
});

test("音声コマンドの窓: 右クリックのメニュー・声・visible で開閉し、声のコマンドと全体のコマンドを並べる", async ({
  harness,
}) => {
  await setup(harness);
  const windowText = () =>
    harness.evaluate(() => {
      const w = document.querySelector<HTMLElement>(".msagent-commands-window");
      return w && w.style.display !== "none"
        ? [...w.querySelectorAll(".msagent-commands-window-section, li")].map((e) => e.firstChild!.textContent)
        : null;
    });
  // 右クリックのメニューから開く
  await harness.evaluate(() => window.a.showPopupMenu(100, 100));
  await harness.click(".msagent-menu >> text=Open Voice Commands");
  expect(await windowText()).toEqual([
    "Test",
    "Search",
    "Quiet",
    "Global Commands",
    "Close Voice Commands Window",
    "Hide Merlin",
  ]);
  expect(await harness.evaluate(() => [window.a.commandsWindow.visible, window.a.commandsWindow.width > 0])).toEqual([
    true,
    true,
  ]);
  // × で閉じる
  await harness.click(".msagent-commands-window-close");
  expect(await windowText()).toBeNull();
  // 声で開く・閉じる
  for (const said of ["what can I say", "close the commands window", "コマンドを見せて"]) {
    await harness.evaluate((said) => {
      window.a.listen(true);
      window.say([[said, 0.9]]);
    }, said);
    await harness.waitForFunction(() => !window.a.listening);
  }
  expect(await harness.evaluate(() => window.a.commandsWindow.visible)).toBe(true);
  // ヘルプモードで選ぶと、開かずにヘルプ
  await harness.evaluate(() => {
    window.a.commandsWindow.visible = false;
    window.a.on("helpcomplete", (e) => window.log.push(`help ${e.detail.cause}`));
    window.a.helpModeOn = true;
    window.a.showPopupMenu(100, 100);
  });
  await harness.click(".msagent-menu >> text=Open Voice Commands");
  expect(await harness.evaluate(() => window.a.commandsWindow.visible)).toBe(false);
  expect(await log(harness)).toContain("help openCommandsWindow");
});

test("srModeId: 代入した言語で聞き、undefined で読み上げの言語に戻す。音声認識が無ければ空", async ({ harness }) => {
  await setup(harness, { srModeId: "ja-JP" });
  const r = await harness.evaluate(async () => {
    const a = window.a;
    const ids = [a.srModeId];
    a.listen(true);
    a.listen(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    a.srModeId = undefined;
    ids.push(a.srModeId);
    a.listen(true);
    a.listen(false);
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
    ids.push(a.srModeId);
    return { ids, langs: window.recs.map((rec) => rec.lang) };
  });
  expect(r.ids).toEqual(["ja-JP", "en", ""]);
  expect(r.langs).toEqual(["ja-JP", "en"]);
});
