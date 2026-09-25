import { CHARACTERS, requireCharacters } from "../characters";
import { expect, makeWav, test } from "./fixtures";

// 文の中の \ は、JavaScript の文字列では "\\" と書く

/** 本当には読み上げず、読み上げた中身を記録する音声合成に差し替える (声ありのとき) */
const FAKE_SYNTH = `(log) => {
  speechSynthesis.speak = (u) => {
    log.push(\`utter "\${u.text}" lang=\${u.lang} r=\${u.rate.toFixed(2)} p=\${u.pitch.toFixed(2)} v=\${u.volume.toFixed(2)}\`);
    setTimeout(() => u.onend?.(), 50);
  };
}`;

test.beforeEach(() => requireCharacters(CHARACTERS.merlin));

test("声あり: 制御タグで部分ごとに速さ・高さ・音量を変え、目印を知らせ、吹き出しにはタグを除いた文", async ({ harness }) => {
  const r = await harness.evaluate(async (fake) => {
    const log: string[] = [];
    (0, eval)(fake)(log);
    const a = await window.loadAgent("Merlin.acs", { voice: true });
    await a.show(true);
    a.on("bookmark", (e) => log.push(`bookmark ${e.detail.id}`));
    let shown = "";
    a.on("speakend", (e) => (shown = e.detail.text));
    await a.speak('One \\Mrk=1\\two \\Pau=300\\three \\Map="four"="4"\\ \\Spd=85\\\\Vol=32768\\slow');
    await a.speak("\\Lst\\");
    return { log, shown };
  }, FAKE_SYNTH);
  expect(r.shown).toBe("One two three 4 slow");
  expect(r.log).toEqual([
    'utter "One " lang=en-US r=0.92 p=0.50 v=1.00',
    "bookmark 1",
    'utter "two " lang=en-US r=0.92 p=0.50 v=1.00',
    'utter "three " lang=en-US r=0.92 p=0.50 v=1.00',
    'utter "four" lang=en-US r=0.92 p=0.50 v=1.00',
    'utter "slow" lang=en-US r=0.50 p=0.50 v=0.50',
    // \Lst\: 直前の発言を繰り返す (目印は繰り返さない)
    'utter "One two " lang=en-US r=0.92 p=0.50 v=1.00',
    'utter "three " lang=en-US r=0.92 p=0.50 v=1.00',
    'utter "four" lang=en-US r=0.92 p=0.50 v=1.00',
    'utter "slow" lang=en-US r=0.50 p=0.50 v=0.50',
  ]);
});

test("読み上げの言語: agent.language を指定すればそれ、無ければ文から推測", async ({ harness }) => {
  const log = await harness.evaluate(async (fake) => {
    const log: string[] = [];
    (0, eval)(fake)(log);
    const a = await window.loadAgent("Merlin.acs", { voice: true });
    await a.show(true);
    await a.speak("こんにちは");
    await a.speak("Hello");
    a.language = "de";
    await a.speak("Guten Tag");
    a.language = 0x0411;
    await a.speak("Hello");
    return log.map((l) => l.replace(/ r=.*/, ""));
  }, FAKE_SYNTH);
  expect(log).toEqual(['utter "こんにちは" lang=ja-JP', 'utter "Hello" lang=en-US', 'utter "Guten Tag" lang=de', 'utter "Hello" lang=ja-JP']);
});

test("\"A|B|C\" は候補からランダムに 1 つ", async ({ harness }) => {
  const picked = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    const picked = new Set<string>();
    a.on("speakstart", (e) => picked.add(e.detail.text));
    const all = [];
    for (let i = 0; i < 20; i++) all.push(a.speak("A|B|C"));
    a.balloonStyle = { autoPace: false };
    await all.at(-1);
    return [...picked].sort();
  });
  expect(picked).toEqual(["A", "B", "C"]);
});

test("声なし: 間と目印も同じように扱う。think は目印だけを使う", async ({ harness }) => {
  const log = await harness.evaluate(async () => {
    const log: string[] = [];
    const t0 = performance.now();
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    a.on("bookmark", (e) => log.push(`bookmark ${e.detail.id} at ${Math.round((performance.now() - t0) / 100) * 100}`));
    a.on("speakend", (e) => log.push(`end "${e.detail.text}" thought=${e.detail.thought}`));
    const t1 = performance.now();
    await a.speak("Hi \\Pau=800\\\\Mrk=2\\there");
    log.push(`speak took >= 800: ${performance.now() - t1 >= 800}`);
    await a.think("Hmm \\Mrk=3\\\\Pau=500\\ok \\Spd=50\\done");
    return log.map((l) => l.replace(/ at \d+/, ""));
  });
  expect(log).toEqual(["bookmark 2", 'end "Hi there" thought=false', "speak took >= 800: true", "bookmark 3", 'end "Hmm ok done" thought=true']);
});

test("think: 雲形の吹き出しで、口は動かさない。speak はその後", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    let mouths = 0;
    const setMouth = a.player.setMouth.bind(a.player);
    a.player.setMouth = (m) => (m !== undefined && mouths++, setMouth(m));
    const order: string[] = [];
    a.on("speakstart", (e) => order.push(`start thought=${e.detail.thought}`));
    const t = a.think("考えています");
    await new Promise((res) => setTimeout(res, 200));
    const thinkClass = document.querySelector(".msagent-balloon")!.classList.contains("msagent-think");
    const mouthsDuringThink = mouths;
    await t;
    await a.speak("しゃべります");
    return { thinkClass, mouthsDuringThink, order, mouthsAfterSpeak: mouths };
  });
  expect(r.thinkClass).toBe(true);
  expect(r.mouthsDuringThink).toBe(0);
  expect(r.order).toEqual(["start thought=true", "start thought=false"]);
  expect(r.mouthsAfterSpeak).toBeGreaterThan(0);
});

test("口の画像が無いコマ (待機動作の後) でも、しゃべるときは Speaking の状態に切り替えて口を動かす", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    await a.play("Idle1_1");
    const before = a.player.hasMouth;
    const shapes = new Set<number>();
    const setMouth = a.player.setMouth.bind(a.player);
    a.player.setMouth = (m) => (m !== undefined && a.player.hasMouth && shapes.add(m), setMouth(m));
    await a.speak("あいうえお、かきくけこ");
    return { before, shapes: shapes.size };
  });
  expect(r.before).toBe(false);
  expect(r.shapes).toBeGreaterThanOrEqual(4);
});

test.describe("吹き出しの動き", () => {
  test("sizeToText: マーリンは文に合わせて伸び、クリッパーは行数で固定して上へ流す", async ({ harness }) => {
    requireCharacters(CHARACTERS.clippit);
    const r = await harness.evaluate(async () => {
      // \Spd\ で速く読み、少しずつ出す (autoPace) 文が 2 行を超えるまでを短くする
      const text = "\\Spd=1700\\This is a long sentence to check how the word balloon grows or scrolls when the text does not fit in two lines at all.";
      const merlin = await window.loadAgent("Merlin.acs");
      const clippit = await window.loadAgent("CLIPPIT.ACS");
      merlin.moveTo(150, 500, 0);
      clippit.moveTo(700, 500, 0);
      await Promise.all([merlin.show(true), clippit.show(true)]);
      merlin.speak(text, true);
      clippit.speak(text, true);
      await new Promise((res) => setTimeout(res, 2000));
      const measure = (el: Element) => ({ h: Math.round(el.getBoundingClientRect().height), scroll: el.scrollTop });
      const [m, c] = [...document.querySelectorAll(".msagent-content")].map(measure) as [ReturnType<typeof measure>, ReturnType<typeof measure>];
      return { m, c };
    });
    expect(r.m.h).toBeGreaterThan(40); // 3 行以上
    expect(r.m.scroll).toBe(0);
    expect(r.c.h).toBe(36); // 2 行
    expect(r.c.scroll).toBeGreaterThan(0);
  });

  test("autoPace / enabled / autoHide", async ({ harness }) => {
    const r = await harness.evaluate(async () => {
      const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
      const a = await window.loadAgent("Merlin.acs");
      await a.show(true);
      const content = document.querySelector(".msagent-content")!;
      // autoPace: false → 最初から全文
      a.balloonStyle = { autoPace: false };
      a.speak("All at once, please.");
      await sleep(100);
      const allAtOnce = content.textContent;
      a.stop();
      // autoPace: true → 少しずつ
      a.balloonStyle = {};
      a.speak("Little by little, one word at a time, please.");
      await sleep(400);
      const partial = content.textContent!.length;
      a.stop();
      // enabled: false → 吹き出しは出ないが、しゃべる
      a.balloonStyle = { enabled: false };
      a.speak("No balloon.");
      await sleep(100);
      const noBalloon = { visible: a.balloonVisible, speaking: a.speaking };
      a.stop();
      // autoHide: false → 読み終えても出したまま
      a.balloonStyle = { autoHide: false };
      await a.speak("Stay.");
      await sleep(2500);
      return { allAtOnce, partial, noBalloon, stays: a.balloonVisible };
    });
    expect(r.allAtOnce).toBe("All at once, please.");
    expect(r.partial).toBeGreaterThan(0);
    expect(r.partial).toBeLessThan("Little by little, one word at a time, please.".length);
    expect(r.noBalloon).toEqual({ visible: false, speaking: true });
    expect(r.stays).toBe(true);
  });
});

test("音声ファイルでしゃべる: 音の大きさで口を動かし、文は音の長さに合わせて出す", async ({ harness }) => {
  const r = await harness.evaluate(async (wav) => {
    const a = await window.loadAgent("Merlin.acs", { voice: true });
    a.moveTo(100, 100, 0);
    await a.show(true);
    const mouths: number[] = [];
    const setMouth = a.player.setMouth.bind(a.player);
    a.player.setMouth = (m) => (m !== undefined && mouths.at(-1) !== m && mouths.push(m), setMouth(m));
    const bookmarks: number[] = [];
    a.on("bookmark", (e) => bookmarks.push(e.detail.id));
    const t0 = performance.now();
    const status = await a.speak("Hello from a sound file. \\Mrk=5\\Here is the rest.", { url: new Uint8Array(wav).buffer });
    const broken = await a.speak("x", { url: new ArrayBuffer(10) });
    return { status, ms: performance.now() - t0, mouths, bookmarks, broken };
  }, makeWav(0.4, 0.8));
  expect(r.status).toBe("complete");
  expect(r.ms).toBeGreaterThan(1100);
  expect(r.mouths[0]).toBe(0); // 無音の間は閉じる
  expect(r.mouths).toContain(4); // 大きな音で開く
  expect(r.bookmarks).toEqual([5]);
  expect(r.broken).toBe("failed");
});

test("balloonVisible の代入: false は読み終えてから閉じ、true は最後の文をもう一度出す", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    const s = a.speak("Please keep talking until the end of this sentence.");
    await sleep(200);
    a.balloonVisible = false;
    const whileSpeaking = a.balloonVisible;
    await s;
    const afterSpeak = a.balloonVisible; // 自動で閉じる (autoHide) の 2 秒を待たずに閉じる
    a.balloonVisible = true;
    const reshown = [a.balloonVisible, document.querySelector(".msagent-content")!.textContent];
    await sleep(2500);
    const stays = a.balloonVisible; // 出し直したものは自動では閉じない
    a.balloonVisible = false;
    return { whileSpeaking, afterSpeak, reshown, stays, closed: a.balloonVisible };
  });
  expect(r).toEqual({
    whileSpeaking: true,
    afterSpeak: false,
    reshown: [true, "Please keep talking until the end of this sentence."],
    stays: true,
    closed: false,
  });
});
