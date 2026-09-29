import { CHARACTERS, requireCharacters } from "../characters";
import { makeLwv } from "../lwv";
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

test("声あり: 制御タグで部分ごとに速さ・高さ・音量を変え、目印を知らせ、吹き出しにはタグを除いた文", async ({
  harness,
}) => {
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

test("声あり: SAPI 5 のタグでも、部分ごとに速さ・言語を変え、目印 (名前でもよい) を知らせ、吹き出しにはタグを除いた文", async ({
  harness,
}) => {
  const r = await harness.evaluate(async (fake) => {
    const log: string[] = [];
    (0, eval)(fake)(log);
    const a = await window.loadAgent("Merlin.acs", { voice: true });
    await a.show(true);
    a.on("bookmark", (e) => log.push(`bookmark ${e.detail.id} ${e.detail.mark}`));
    let shown = "";
    a.on("speakend", (e) => (shown = e.detail.text));
    await a.speak(
      'Hello <rate absspeed="-10">slow</rate> <bookmark mark="chapter"/><lang langid="407">Guten Tag</lang> &amp; <bookmark mark="2"/>bye',
    );
    return { log, shown };
  }, FAKE_SYNTH);
  expect(r.shown).toBe("Hello slow Guten Tag & bye");
  expect(r.log).toEqual([
    'utter "Hello " lang=en-US r=0.92 p=0.50 v=1.00',
    'utter "slow" lang=en-US r=0.31 p=0.50 v=1.00',
    "bookmark NaN chapter",
    'utter "Guten Tag" lang=de-DE r=0.92 p=0.50 v=1.00',
    'utter " & " lang=en-US r=0.92 p=0.50 v=1.00',
    "bookmark 2 2",
    'utter "bye" lang=en-US r=0.92 p=0.50 v=1.00',
  ]);
});

test("tags: false なら、タグも文字としてそのまま読んで出す (キャラクターごと・1 回ごと)", async ({ harness }) => {
  const r = await harness.evaluate(async (fake) => {
    const log: string[] = [];
    (0, eval)(fake)(log);
    const a = await window.loadAgent("Merlin.acs", { voice: true, tags: false });
    await a.show(true);
    const shown: string[] = [];
    a.on("speakend", (e) => shown.push(e.detail.text));
    a.on("bookmark", (e) => log.push(`bookmark ${e.detail.id}`));
    await a.speak('a \\Mrk=1\\<silence msec="100"/>b');
    await a.speak("\\Lst\\");
    await a.speak('c<silence msec="10"/>d', { tags: true });
    a.tags = true;
    await a.speak("e\\Pau=10\\f", { tags: false });
    await a.think("<emph>g</emph>", { tags: false });
    return { log: log.map((l) => l.replace(/ lang=.*/, "")), shown };
  }, FAKE_SYNTH);
  expect(r.shown).toEqual(['a \\Mrk=1\\<silence msec="100"/>b', "\\Lst\\", "cd", "e\\Pau=10\\f", "<emph>g</emph>"]);
  expect(r.log).toEqual([
    'utter "a \\Mrk=1\\<silence msec="100"/>b"',
    'utter "\\Lst\\"',
    'utter "c"',
    'utter "d"',
    'utter "e\\Pau=10\\f"',
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
  expect(log).toEqual([
    'utter "こんにちは" lang=ja-JP',
    'utter "Hello" lang=en-US',
    'utter "Guten Tag" lang=de',
    'utter "Hello" lang=ja-JP',
  ]);
});

test('"A|B|C" は候補からランダムに 1 つ', async ({ harness }) => {
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
  expect(log).toEqual([
    "bookmark 2",
    'end "Hi there" thought=false',
    "speak took >= 800: true",
    "bookmark 3",
    'end "Hmm ok done" thought=true',
  ]);
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

test("口の画像が無いコマ (待機動作の後) でも、しゃべるときは Speaking の状態に切り替えて口を動かす", async ({
  harness,
}) => {
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

test("speak(text, { mouth: false }) は口を動かさず、口の画像が無いコマでも Speaking の状態に切り替えない", async ({
  harness,
}) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    await a.play("Idle1_1");
    let mouths = 0;
    const setMouth = a.player.setMouth.bind(a.player);
    a.player.setMouth = (m) => (m !== undefined && mouths++, setMouth(m));
    const log: string[] = [];
    a.on("animationstart", (e) => log.push(e.detail.name));
    a.on("speakend", (e) => log.push(`end ${e.detail.text}`));
    await a.speak("あいうえお、かきくけこ", { mouth: false });
    const quiet = mouths;
    await a.speak("あいうえお");
    return { quiet, log, mouths };
  });
  expect(r.quiet).toBe(0);
  expect(r.log[0]).toBe("end あいうえお、かきくけこ");
  expect(r.mouths).toBeGreaterThan(0); // 次の speak は、いつもどおり口を動かす
});

test.describe("吹き出しの動き", () => {
  test("sizeToText: マーリンは文に合わせて伸び、クリッパーは行数で固定して上へ流す", async ({ harness }) => {
    requireCharacters(CHARACTERS.clippit);
    const r = await harness.evaluate(async () => {
      // \Spd\ で速く読み、少しずつ出す (autoPace) 文が 2 行を超えるまでを短くする
      const text =
        "\\Spd=1700\\This is a long sentence to check how the word balloon grows or scrolls when the text does not fit in two lines at all.";
      const merlin = await window.loadAgent("Merlin.acs");
      const clippit = await window.loadAgent("CLIPPIT.ACS");
      merlin.moveTo(150, 500, 0);
      clippit.moveTo(700, 500, 0);
      await Promise.all([merlin.show(true), clippit.show(true)]);
      merlin.speak(text, true);
      clippit.speak(text, true);
      await new Promise((res) => setTimeout(res, 2000));
      const measure = (el: Element) => ({ h: Math.round(el.getBoundingClientRect().height), scroll: el.scrollTop });
      const [m, c] = [...document.querySelectorAll(".msagent-content")].map(measure) as [
        ReturnType<typeof measure>,
        ReturnType<typeof measure>,
      ];
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
  const r = await harness.evaluate(
    async (wav) => {
      const a = await window.loadAgent("Merlin.acs", { voice: true });
      a.moveTo(100, 100, 0);
      await a.show(true);
      const mouths: number[] = [];
      const setMouth = a.player.setMouth.bind(a.player);
      a.player.setMouth = (m) => (m !== undefined && mouths.at(-1) !== m && mouths.push(m), setMouth(m));
      const bookmarks: number[] = [];
      a.on("bookmark", (e) => bookmarks.push(e.detail.id));
      const t0 = performance.now();
      const status = await a.speak("Hello from a sound file. \\Mrk=5\\Here is the rest.", {
        url: new Uint8Array(wav).buffer,
      });
      const broken = await a.speak("x", { url: new ArrayBuffer(10) });
      return { status, ms: performance.now() - t0, mouths, bookmarks, broken };
    },
    makeWav(0.4, 0.8),
  );
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

test(".lwv でしゃべる: 口は音素から、吹き出しは単語の時刻に合わせて出す。文が空ならファイルの単語", async ({
  harness,
}) => {
  const r = await harness.evaluate(
    async (lwv) => {
      const a = await window.loadAgent("Merlin.acs");
      a.moveTo(100, 100, 0);
      await a.show(true);
      const mouths: number[] = [];
      const setMouth = a.player.setMouth.bind(a.player);
      a.player.setMouth = (m) => (m !== undefined && mouths.at(-1) !== m && mouths.push(m), setMouth(m));
      const content = document.querySelector(".msagent-content")!;
      const seen: string[] = [];
      new MutationObserver(() => seen.at(-1) !== content.textContent && seen.push(content.textContent!)).observe(
        content,
        {
          childList: true,
          characterData: true,
          subtree: true,
        },
      );
      const status = await a.speak("", { url: new Uint8Array(lwv).buffer });
      return { status, mouths, seen };
    },
    makeLwv(
      makeWav(1.2, 0),
      0x0409,
      [
        [0, 0.4, "ah"],
        [0.4, 0.8, "oo"],
        [0.8, 1.2, "mm"],
      ],
      [
        [0, 0.4, "0x0061"], // a → 4
        [0.4, 0.8, "0x0075"], // u → 6
        [0.8, 1.2, "0x006D"], // m → 0
      ],
    ),
  );
  expect(r.status).toBe("complete");
  // 音は無音なので、音の大きさではなく音素で口が動く
  expect(r.mouths).toEqual([4, 6, 0]);
  expect(r.seen.filter(Boolean)).toEqual(["ah", "ah oo", "ah oo mm"]);
});

test("1 回ごとに声を切り替える: speak(text, { voice: false }) は吹き出しだけ、think(text, { voice: true }) は考えごとの吹き出しのまま声に出す", async ({
  harness,
}) => {
  const r = await harness.evaluate(async (fake) => {
    const log: string[] = [];
    (0, eval)(fake)(log);
    const a = await window.loadAgent("Merlin.acs", { voice: true });
    await a.show(true);
    a.on("speakstart", (e) => log.push(`start ${e.detail.thought ? "think" : "speak"} ${e.detail.text}`));
    const balloon = document.querySelector(".msagent-balloon")!;
    await a.speak("Silent words", { voice: false });
    const think = a.think("Thinking aloud", { voice: true });
    await new Promise((res) => setTimeout(res, 10));
    const thinkBalloon = balloon.classList.contains("msagent-think");
    await think;
    // agent.voice が false でも、think の { voice: true } は声に出す
    a.voice = false;
    await a.think("Still aloud", { voice: true });
    await a.think("Quiet thought");
    return { log, thinkBalloon };
  }, FAKE_SYNTH);
  expect(r.thinkBalloon).toBe(true);
  expect(r.log).toEqual([
    "start speak Silent words",
    "start think Thinking aloud",
    'utter "Thinking aloud" lang=en-US r=0.92 p=0.50 v=1.00',
    "start think Still aloud",
    'utter "Still aloud" lang=en-US r=0.92 p=0.50 v=1.00',
    "start think Quiet thought",
  ]);
});

test("think の間は考える動き (Thinking) を再生し、考え終えたら元の姿勢に戻す", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    a.on("animationstart", (e) => log.push(`start ${e.detail.name}`));
    a.on("speakend", () => log.push("think end"));
    await a.think("Hmm, let me think.");
    const done = performance.now();
    // 考える動きは、止めるように言ってから、終了分岐で自然に終わる
    while (a.player.requestedAnimation && performance.now() - done < 8000)
      await new Promise((res) => setTimeout(res, 100));
    return { log, holding: a.player.isHolding, playing: a.player.requestedAnimation, endMs: performance.now() - done };
  });
  expect(r.log[0]).toBe("start Thinking");
  expect(r.log).toContain("think end");
  // 考え終えたら、繰り返しをやめて戻る
  expect(r.holding).toBe(false);
  expect(r.playing).toBeUndefined();
});

test("pace: 1 回ごとに、文字を少しずつ出すか (吹き出しの autoPace) を変える", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    const content = document.querySelector(".msagent-content")!;
    const text = "Little by little, one word at a time, please.";
    const shownAfter = async (request: ReturnType<typeof a.speak>) => {
      await sleep(300);
      const shown = content.textContent!.length;
      a.stop(request);
      return shown;
    };
    const speakAll = await shownAfter(a.speak(text, { pace: false }));
    const speakPaced = await shownAfter(a.speak(text));
    const thinkAll = await shownAfter(a.think(text, { pace: false }));
    // 吹き出しの設定が autoPace: false でも、pace: true なら少しずつ
    a.balloonStyle = { autoPace: false };
    const speakForced = await shownAfter(a.speak(text, { pace: true }));
    return { length: text.length, speakAll, speakPaced, thinkAll, speakForced };
  });
  expect(r.speakAll).toBe(r.length);
  expect(r.thinkAll).toBe(r.length);
  expect(r.speakPaced).toBeLessThan(r.length);
  expect(r.speakForced).toBeLessThan(r.length);
});

test("音を止められている (まだページを操作していない) 間の音声ファイルは流さず、声なしと同じ時間でしゃべって終わる", async ({
  harness,
}) => {
  const r = await harness.evaluate(
    async (wav) => {
      const started: string[] = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        started.push("start");
        return start.apply(this, args);
      };
      // 自動再生の制限: suspended のままで、resume() も終わらない
      Object.defineProperty(BaseAudioContext.prototype, "state", { configurable: true, get: () => "suspended" });
      AudioContext.prototype.resume = () => new Promise<void>(() => {});
      const a = await window.loadAgent("Merlin.acs", { voice: true });
      await a.show(true);
      let shown = "";
      a.on("speakend", (e) => (shown = e.detail.text));
      const status = await a.speak("Hello from a sound file.", { url: new Uint8Array(wav).buffer });
      return { status, shown, started };
    },
    makeWav(0.4, 0.8),
  );
  expect(r.status).toBe("complete"); // 操作されるまで止まったままにならない
  expect(r.shown).toBe("Hello from a sound file.");
  expect(r.started).toEqual([]); // 音は流さない (あとで遅れて鳴らない)
});

test("think(text, { animation: false }) は考える動きを再生せず、いまの姿勢のまま", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    a.on("animationstart", (e) => log.push(`start ${e.detail.name}`));
    a.on("speakend", () => log.push("think end"));
    await a.think("Hmm, let me think.", { animation: false });
    return { log, playing: a.player.requestedAnimation };
  });
  expect(r.log).toEqual(["think end"]);
  expect(r.playing).toBeUndefined();
});

test("balloonStyle の width / height (px): 吹き出しの大きさを決め、はみ出した分は上へ流す。外すと文に合わせる", async ({
  harness,
}) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    a.moveTo(300, 300, 0);
    await a.show(true);
    const balloon = document.querySelector<HTMLElement>(".msagent-balloon")!;
    const content = balloon.querySelector<HTMLElement>(".msagent-content")!;
    a.balloonStyle = { width: 320, height: 60, autoPace: false };
    a.speak("One two three four five six seven eight nine ten. ".repeat(4), true);
    await new Promise((res) => setTimeout(res, 100));
    const fixed = { w: balloon.offsetWidth, h: balloon.offsetHeight, scrolled: content.scrollTop > 0 };
    a.balloonStyle = { autoPace: false };
    const free = { w: balloon.offsetWidth, h: balloon.offsetHeight };
    a.closeBalloon();
    return { fixed, free };
  });
  expect(r.fixed).toEqual({ w: 320, h: 60, scrolled: true });
  // 外すと、charsPerLine の幅・文の量の高さに戻る
  expect(r.free.w).not.toBe(320);
  expect(r.free.h).toBeGreaterThan(60);
});

test("少しずつ出すときも、吹き出しは最初から全文の入る大きさ (出しながら伸びない)", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    a.moveTo(300, 300, 0);
    await a.show(true);
    const balloon = document.querySelector<HTMLElement>(".msagent-balloon")!;
    const sizes = new Set<string>();
    const shown: number[] = [];
    const watch = new MutationObserver(() => {
      sizes.add(`${balloon.offsetWidth}x${balloon.offsetHeight} ${balloon.style.left},${balloon.style.top}`);
      shown.push(balloon.textContent!.length);
    });
    watch.observe(balloon, { childList: true, characterData: true, subtree: true });
    await a.speak("This sentence is long enough to wrap onto a few lines in the word balloon of Merlin.");
    await a.think("And this thought is also quite long, so it wraps as well.");
    watch.disconnect();
    return { sizes: [...sizes], growing: shown.some((n, i) => i > 0 && n > shown[i - 1]!) };
  });
  expect(r.growing).toBe(true); // 少しずつ出している
  // speak と think で 1 つずつ (文字を足しても大きさ・位置が変わらない)
  expect(r.sizes.length).toBeLessThanOrEqual(2);
});

test("audioOutput: enabled = false なら全キャラクターの声を出さない。status は声に出してしゃべっている間 4、ほかは 0", async ({
  harness,
}) => {
  const r = await harness.evaluate(async (fake) => {
    const log: string[] = [];
    (0, eval)(fake)(log);
    const out = window.M.audioOutput;
    const a = await window.loadAgent("Merlin.acs", { voice: true });
    await a.show(true);
    const statuses: number[] = [out.status];
    const s = a.speak("Out loud");
    await new Promise((res) => setTimeout(res, 20));
    statuses.push(out.status);
    await s;
    statuses.push(out.status);
    out.enabled = false;
    await a.speak("Not out loud", { voice: true });
    await a.think("Not out loud either", { voice: true });
    out.enabled = true;
    return { log, statuses, same: window.M.default.audioOutput === out };
  }, FAKE_SYNTH);
  expect(r.statuses).toEqual([0, 4, 0]);
  expect(r.log).toEqual(['utter "Out loud" lang=en-US r=0.92 p=0.50 v=1.00']);
  expect(r.same).toBe(true);
});

test("ttsModeId: 代入した声で読み (タグで言語を変えた部分は除く)、undefined で言語と性別から選ぶ", async ({
  harness,
}) => {
  const r = await harness.evaluate(async () => {
    const log: string[] = [];
    // 声の一覧と発話を差し替える (本物の SpeechSynthesisVoice でないと voice に入れられないので、発話も差し替える)
    const voices = [
      { name: "Zira", voiceURI: "urn:zira", lang: "en-US", default: true },
      { name: "David", voiceURI: "urn:david", lang: "en-US", default: false },
      { name: "Haruka", voiceURI: "urn:haruka", lang: "ja-JP", default: true },
      { name: "Hedda", voiceURI: "urn:hedda", lang: "de-DE", default: true },
    ];
    speechSynthesis.getVoices = () => voices as unknown as SpeechSynthesisVoice[];
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class {
      lang = "";
      rate = 1;
      pitch = 1;
      volume = 1;
      voice: { name: string } | null = null;
      onstart?: () => void;
      onend?: () => void;
      onboundary?: () => void;
      onerror?: () => void;
      constructor(readonly text: string) {}
    };
    speechSynthesis.speak = (u) => {
      log.push(`${u.text.trim()}: ${u.voice?.name} ${u.lang}`);
      setTimeout(() => u.onend?.(new Event("end") as SpeechSynthesisEvent), 20);
    };
    const a = await window.loadAgent("Merlin.acs", { voice: true, ttsModeId: "haruka", language: "en-US" });
    await a.show(true);
    const ids = [a.ttsModeId];
    await a.speak('Hello <lang langid="407">Guten Tag</lang>');
    a.ttsModeId = undefined;
    ids.push(a.ttsModeId);
    await a.speak("Hello");
    a.ttsModeId = "no such voice";
    ids.push(a.ttsModeId);
    a.voice = false;
    ids.push(a.ttsModeId);
    return { log, ids };
  });
  expect(r.log).toEqual(["Hello: Haruka ja-JP", "Guten Tag: Hedda de-DE", "Hello: David en-US"]);
  // マーリンは男性の声 (言語は language)。見つからない声は、言語と性別から選ぶ。声に出さないなら ""
  expect(r.ids).toEqual(["urn:haruka", "urn:david", "urn:david", ""]);
});

test("スクリーンリーダー: 吹き出しの全文を見えない status に 1 度だけ入れ、閉じたら空にする。キャラクターは名前の付いた絵", async ({
  harness,
}) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs", { voice: false, language: "en-US" });
    await a.show(true);
    const live = document.querySelector<HTMLElement>(".msagent-live")!;
    const seen: string[] = [];
    new MutationObserver(() => seen.push(live.textContent ?? "")).observe(live, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const attrs = {
      role: live.getAttribute("role"),
      balloonHidden: document.querySelector(".msagent-balloon")!.getAttribute("aria-hidden"),
      agentRole: a.element.getAttribute("role"),
      label: a.element.getAttribute("aria-label"),
    };
    await a.speak("Hello there, how are you?");
    const spoken = { text: live.textContent, lang: live.lang };
    a.closeBalloon();
    const closed = live.textContent;
    a.name = "Wizard";
    const renamed = a.element.getAttribute("aria-label");
    a.destroy();
    return { attrs, spoken, closed, renamed, seen, removed: !live.isConnected };
  });
  expect(r.attrs).toEqual({ role: "status", balloonHidden: "true", agentRole: "img", label: "Merlin" });
  expect(r.spoken).toEqual({ text: "Hello there, how are you?", lang: "en-US" });
  expect(r.closed).toBe("");
  // 少しずつ出しても、読ませる文は全文の 1 度だけ
  expect(r.seen.filter((s) => s)).toEqual(["Hello there, how are you?"]);
  expect(r.renamed).toBe("Wizard");
  expect(r.removed).toBe(true);
});
