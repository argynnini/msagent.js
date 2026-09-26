import { CHARACTERS, requireCharacters } from "../characters";
import { expect, test } from "./fixtures";

/** アニメーションの始まりを記録する */
const recordAnimations = `(a, log) => a.on("animationstart", (e) => log.push(e.detail.name))`;

test("Rocky (.act): 登場・退場で、状態に割り当てられたアニメーション (Appear / Disappear・Goodbye) を使う", async ({
  harness,
}) => {
  requireCharacters(CHARACTERS.rocky);
  const log = await harness.evaluate(async (rec) => {
    const log: string[] = [];
    const a = await window.loadAgent("ROCKY.act");
    (0, eval)(rec)(a, log);
    await a.show();
    await a.hide();
    return log;
  }, recordAnimations);
  expect(log[0]).toBe("Appear");
  expect(["Disappear", "Goodbye"]).toContain(log[1]);
});

test("hide は順番待ちに入る (前の命令の後)。{ immediate: true } なら、すぐ隠れる", async ({ harness }) => {
  requireCharacters(CHARACTERS.merlin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    const wave = a.play("Wave") as ReturnType<typeof a.show>;
    await a.hide();
    const queued = wave.status;
    await a.show(true);
    const wave2 = a.play("Wave") as ReturnType<typeof a.show>;
    await new Promise((res) => setTimeout(res, 200));
    await a.hide(false, undefined, { immediate: true });
    return { queued, immediate: wave2.status, visible: a.visible };
  });
  expect(r).toEqual({ queued: "complete", immediate: "interrupted", visible: false });
});

test("隠れている間: play はすぐ終わり、moveTo はすぐ移り、speak は failed", async ({ harness }) => {
  requireCharacters(CHARACTERS.merlin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    const t0 = performance.now();
    await a.play("Wave");
    const playMs = performance.now() - t0;
    await a.moveTo(100, 120, 1000);
    const speak = a.speak("hidden");
    return { playMs, pos: [a.left, a.top], speak: await speak, reason: speak.description, balloon: a.balloonVisible };
  });
  expect(r.playMs).toBeLessThan(200);
  expect(r.pos).toEqual([100, 120]);
  expect(r.speak).toBe("failed");
  expect(r.reason).toBe("The character is hidden");
  expect(r.balloon).toBe(false);
});

test("stop() しても、登場のアニメーションは最後まで再生する", async ({ harness }) => {
  requireCharacters(CHARACTERS.merlin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    const show = a.show();
    const wave = a.play("Wave") as ReturnType<typeof a.show>;
    await new Promise((res) => setTimeout(res, 300));
    a.stop();
    return { show: await show, wave: await wave };
  });
  expect(r).toEqual({ show: "complete", wave: "interrupted" });
});

test("gestureAt: Gesturing の状態を使い、向きはキャラクターから見た向き (画面の右 = キャラクターの左)", async ({
  harness,
}) => {
  requireCharacters(CHARACTERS.clippit);
  const log = await harness.evaluate(async (rec) => {
    const log: string[] = [];
    const a = await window.loadAgent("CLIPPIT.ACS");
    a.moveTo(500, 300, 0);
    await a.show(true);
    (0, eval)(rec)(a, log);
    await a.gestureAt(1100, 350);
    await a.gestureAt(0, 350);
    return log;
  }, recordAnimations);
  expect(log).toEqual(["GestureLeft", "GestureRight"]);
});

test("moveTo (フィンフィン): 移動前の動き → 最後のコマのまま移動 → 移動後の動き", async ({ harness }) => {
  requireCharacters(CHARACTERS.finfin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("finfin.acs");
    a.moveTo(700, 400, 0);
    await a.show(true);
    const frames: string[] = [];
    const xs: number[] = [];
    // 描いたコマが、どのアニメーションのものか (コマのオブジェクトで見分ける。画像は使い回されていることがある)
    const owner = new Map<object, string>();
    for (const [n, anim] of a.character.animations) for (const f of anim.frames) owner.set(f, n);
    const draw = a.player.draw.bind(a.player);
    a.player.draw = (f) => {
      const n = owner.get(f) ?? "?";
      if (frames.at(-1) !== n) {
        frames.push(n);
        xs.push(Math.round(a.left));
      }
      draw(f);
    };
    await a.moveTo(100, 400, 800);
    return { frames, xs, end: [a.left, a.top] };
  });
  // 飛び立つ (MoveRight) → 飛んでいる最後のコマのまま移動 → 着地 (MoveRightReturn)
  expect(r.frames[0]).toBe("MoveRight");
  expect(r.frames).toContain("MoveRightReturn");
  expect(r.xs[0]).toBe(700); // 移動前の動きの間は動かない
  expect(r.xs[r.frames.indexOf("MoveRightReturn")]).toBe(100); // 着地は着いてから
  expect(r.end).toEqual([100, 400]);
});

test("別の戻りアニメ (フィンフィン) は、その名前のアニメーションとして知らせる", async ({ harness }) => {
  requireCharacters(CHARACTERS.finfin);
  const r = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("finfin.acs");
    a.moveTo(700, 400, 0);
    await a.show(true);
    a.on("animationstart", (e) => log.push(`start ${e.detail.name}`));
    a.on("animationend", (e) => log.push(`end ${e.detail.name}`));
    const names: (string | undefined)[] = [];
    a.on("animationstart", () => names.push(a.player.currentAnimation));
    await a.moveTo(100, 400, 500);
    await a.gestureAt(1100, 450);
    await a.play("Wave");
    return { log, names };
  });
  expect(r.log).toEqual([
    "start MoveRight",
    "end MoveRight",
    "start MoveRightReturn",
    "end MoveRightReturn",
    "start GestureLeft",
    "end GestureLeft",
    // 指した姿勢から戻ってから、手を振る
    "start GestureLeftReturn",
    "end GestureLeftReturn",
    "start Wave",
    "end Wave",
  ]);
  // currentAnimation も同じ名前
  expect(r.names).toEqual(["MoveRight", "MoveRightReturn", "GestureLeft", "GestureLeftReturn", "Wave"]);
});

test("同じアニメーションの終了分岐で戻るもの (マーリン) は、名前はそのアニメーションのまま", async ({ harness }) => {
  requireCharacters(CHARACTERS.merlin);
  const log = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs");
    a.moveTo(700, 400, 0);
    await a.show(true);
    a.on("animationstart", (e) => log.push(`start ${e.detail.name}`));
    a.on("animationend", (e) => log.push(`end ${e.detail.name}`));
    await a.moveTo(100, 400, 300);
    return log;
  });
  // 移動前の動きの後 (移動中) はいったん終わり、戻りの動きで同じ名前がもう一度始まる
  expect(log).toEqual(["start MoveRight", "end MoveRight", "start MoveRight", "end MoveRight"]);
});

test("指した姿勢を次の動きまで保ち、次の動きの前に戻りの動きを再生する", async ({ harness }) => {
  requireCharacters(CHARACTERS.finfin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("finfin.acs");
    a.moveTo(400, 400, 0);
    await a.show(true);
    await a.gestureAt(1100, 450);
    await new Promise((res) => setTimeout(res, 1500));
    const holding = a.player.isHolding;
    const drawn: object[] = [];
    const draw = a.player.draw.bind(a.player);
    a.player.draw = (f) => (drawn.push(f), draw(f));
    await a.play("Wave");
    const ret: object[] = a.character.animations.get("GestureLeftReturn")!.frames;
    return { holding, firstIsReturn: ret.includes(drawn[0]!) };
  });
  expect(r).toEqual({ holding: true, firstIsReturn: true });
});

test("hide やほかのアニメーションを始めると、前のアニメーションの効果音を止める", async ({ harness }) => {
  requireCharacters(CHARACTERS.merlin);
  const r = await harness.evaluate(async () => {
    const log: string[] = [];
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args) {
      log.push("start");
      return start.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (...args) {
      log.push("stop");
      return stop.apply(this, args);
    };
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    // 最初のコマで効果音を鳴らすアニメーション
    const name = [...a.character.animations].find(([, anim]) => anim.frames[0]!.soundIndex >= 0)![0];
    a.play(name);
    while (!log.includes("start")) await new Promise((res) => setTimeout(res, 20));
    // 鳴っている途中で隠れる (待機動作の途中で hide したときと同じく、いまの動きを捨てて隠れる)
    await a.hide(false, undefined, { immediate: true });
    return { name, log };
  });
  // 前の動きの音は止め (退場のアニメーションを始めるとき)、退場のアニメーションの音は最後まで鳴らす
  expect(r.log).toEqual(["start", "stop", "start"]);
});

test("移動の途中で stop() して別の場所へ moveTo すると、前の移動はやめ、新しい移動は歩いて (移動のアニメーションで) 進む", async ({
  harness,
}) => {
  requireCharacters(CHARACTERS.finfin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("finfin.acs");
    a.moveTo(700, 400, 0);
    await a.show(true);
    a.moveTo(100, 400, 800);
    await new Promise((res) => setTimeout(res, 700)); // 移動の途中
    const log: string[] = [];
    a.on("animationstart", (e) => log.push(e.detail.name));
    // 描いたコマと、そのときの位置 (動いている途中は、移動のコマのままか)
    const owner = new Map<object, string>();
    for (const [n, anim] of a.character.animations) for (const f of anim.frames) owner.set(f, n);
    const drawn: [string, number][] = [];
    const draw = a.player.draw.bind(a.player);
    a.player.draw = (f) => (drawn.push([owner.get(f) ?? "?", a.left]), draw(f));
    a.stop();
    const from = a.left;
    await a.moveTo(1000, 400, 800);
    // 動き出す直前に描いたコマと、動いている途中に描いたコマ (移動のコマのまま動くなら、途中は描き直さない)
    const posed = drawn.filter(([, x]) => x === from).at(-1)?.[0];
    const slid = [...new Set(drawn.filter(([, x]) => x > from && x < 1000).map(([n]) => n))];
    return { from, log, posed, slid, end: [a.left, a.top] };
  });
  expect(r.from).toBeGreaterThan(100); // stop() で止まった (前の移動は着いていない)
  // 前の移動の戻り → 新しい移動 → その戻り。前の移動の戻りが、新しい移動の途中に割り込まない
  expect(r.log).toEqual(["MoveRightReturn", "MoveLeft", "MoveLeftReturn"]);
  expect(r.posed).toBe("MoveLeft"); // 移動のアニメーションの最後のコマのまま動き出し、
  expect(r.slid.filter((n) => n !== "MoveLeft")).toEqual([]); // 途中でほかの絵 (前の移動の戻りなど) にならない
  expect(r.end).toEqual([1000, 400]);
});

test("移動の途中で stop() すると、その場で止まり、戻りの動きで元の姿勢に戻る", async ({ harness }) => {
  requireCharacters(CHARACTERS.finfin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("finfin.acs");
    a.moveTo(700, 400, 0);
    await a.show(true);
    const log: string[] = [];
    a.on("animationstart", (e) => log.push(e.detail.name));
    a.moveTo(100, 400, 800);
    await new Promise((res) => setTimeout(res, 700));
    a.stop();
    const stoppedAt = a.left;
    await new Promise((res) => setTimeout(res, 1500));
    return { stoppedAt, left: a.left, log, holding: a.player.isHolding };
  });
  expect(r.left).toBe(r.stoppedAt);
  expect(r.left).toBeGreaterThan(100);
  expect(r.log).toEqual(["MoveRight", "MoveRightReturn"]);
  expect(r.holding).toBe(false);
});

test("最後のコマの絵が空 (0x0) のアニメーションは、止まっているときの絵で終わる (フィンフィンの MoveLeftReturn)", async ({
  harness,
}) => {
  requireCharacters(CHARACTERS.finfin);
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("finfin.acs");
    a.moveTo(100, 400, 0);
    await a.show(true);
    let last: object | undefined;
    const draw = a.player.draw.bind(a.player);
    a.player.draw = (f) => ((last = f), draw(f));
    await a.moveTo(700, 400, 300); // 画面の右へ = MoveLeft → MoveLeftReturn
    const ret = a.character.animations.get("MoveLeftReturn")!;
    return {
      emptyLast:
        (a.player as unknown as { sprite(i: number): HTMLCanvasElement }).sprite(
          ret.frames.at(-1)!.images[0]!.imageIndex,
        ).width === 0,
      rest: last === a.character.animations.get("RestPose")!.frames[0],
    };
  });
  expect(r).toEqual({ emptyLast: true, rest: true });
});
