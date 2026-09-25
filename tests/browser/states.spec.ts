import { CHARACTERS, requireCharacters } from "../characters";
import { expect, test } from "./fixtures";

/** アニメーションの始まりを記録する */
const recordAnimations = `(a, log) => a.on("animationstart", (e) => log.push(e.detail.name))`;

test("Rocky (.act): 登場・退場で、状態に割り当てられたアニメーション (Appear / Disappear・Goodbye) を使う", async ({ harness }) => {
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
  expect(r.reason).toBe("キャラクターが隠れています");
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

test("gestureAt: Gesturing の状態を使い、向きはキャラクターから見た向き (画面の右 = キャラクターの左)", async ({ harness }) => {
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
