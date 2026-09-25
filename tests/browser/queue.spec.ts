import { CHARACTERS, requireCharacters } from "../characters";
import { expect, test } from "./fixtures";

test.beforeEach(() => requireCharacters(CHARACTERS.merlin, CHARACTERS.finfin));

test("命令は Request を返し、await すると終わったときの状態が返る。無いアニメーションは false", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    const show = a.show(true);
    const statusBefore = show.status;
    const played = await (a.play("Wave") as ReturnType<typeof a.show>);
    return { isRequest: show instanceof window.M.AgentRequest, statusBefore, played, missing: a.play("NoSuchAnimation") };
  });
  expect(r).toEqual({ isRequest: true, statusBefore: "pending", played: "complete", missing: false });
});

test("stop(request): その命令だけを止める", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    const r1 = a.play("Wave") as ReturnType<typeof a.show>;
    const r2 = a.speak("second");
    const r3 = a.play("Pleased") as ReturnType<typeof a.show>;
    a.stop(r2);
    // r1 は始める直前 (pending) か実行中。r2 だけが止まり、r3 は順番待ちのまま
    const after = [r2.status, r3.status];
    await r3;
    return { after, r1: r1.status, r3: r3.status };
  });
  expect(r).toEqual({ after: ["interrupted", "pending"], r1: "complete", r3: "complete" });
});

test("stopAll(\"speak\"): しゃべりだけ止め、次の play は続ける", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    const s = a.speak("long long long long long long long long speech");
    const p = a.play("Wave") as ReturnType<typeof a.show>;
    await new Promise((res) => setTimeout(res, 300));
    a.stopAll("speak");
    return { speak: await s, play: await p };
  });
  expect(r).toEqual({ speak: "interrupted", play: "complete" });
});

test("wait / interrupt: 2 体の掛け合い", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs");
    const b = await window.loadAgent("finfin.acs");
    a.moveTo(100, 400, 0);
    b.moveTo(500, 400, 0);
    await Promise.all([a.show(true), b.show(true)]);
    a.on("speakend", () => log.push("merlin end"));
    b.on("speakstart", () => log.push("finfin start"));
    const q = a.speak("question from merlin");
    b.wait(q);
    await b.speak("answer from finfin");
    // 終わらない動き (timeout なし) を、別のキャラクターから止める
    const loop = a.play("Processing", 0) as ReturnType<typeof a.show>;
    await new Promise((res) => setTimeout(res, 500));
    const i = b.interrupt(loop);
    return { log, interrupt: await i, loop: await loop, self: await a.interrupt(a.delay(10)) };
  });
  expect(r.log).toEqual(["merlin end", "finfin start"]);
  expect(r.interrupt).toBe("complete");
  expect(r.loop).toBe("interrupted");
  expect(r.self).toBe("failed");
});

test("requeststart / requestcomplete が命令ごとに来る", async ({ harness }) => {
  const log = await harness.evaluate(async () => {
    const log: string[] = [];
    const a = await window.loadAgent("Merlin.acs");
    a.on("requeststart", (e) => log.push(`start ${e.detail.request.type}`));
    a.on("requestcomplete", (e) => log.push(`end ${e.detail.request.type} ${e.detail.request.status}`));
    a.show(true);
    await a.delay(50);
    return log;
  });
  expect(log).toEqual(["start show", "end show complete", "start delay", "end delay complete"]);
});

test("get: アニメーション・状態はあるか確かめ、音声ファイルは読み込む。queue = false なら順番待ちに入らない", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    const E = window.M.RequestError;
    const ok = await Promise.all([
      a.get("animation", "Wave, Greet"),
      a.get("state", "Gesturing"),
      a.get("state", "IdlingLevel1"),
      a.get("wavefile", "/characters/Merlin.acs"),
    ]);
    const missing = a.get("animation", "Wave, NoSuchAnimation");
    const noState = a.get("state", "NoSuchState");
    const badType = a.get("sound" as "animation", "Wave");
    const noFile = a.get("wavefile", "/characters/none.wav");
    await Promise.all([missing, noState, badType, noFile]);
    // queue = false: 前の命令 (delay) を待たずに終わる
    const d = a.delay(1000);
    const now = a.get("animation", "Wave", false);
    await now;
    const delayStatus = d.status;
    a.stop();
    return {
      ok,
      failed: [missing, noState, badType, noFile].map((q) => [q.status, q.number]),
      codes: [E.animationNotFound, E.stateNotFound, E.invalidGetType, E.invalidSound],
      delayStatus,
      nowNumber: now.number,
    };
  });
  expect(r.ok).toEqual(["complete", "complete", "complete", "complete"]);
  expect(r.failed).toEqual(r.codes.map((n) => ["failed", n]));
  expect(r.delayStatus).toBe("inProgress");
  expect(r.nowNumber).toBe(0);
});

test("Request.number: 本家のエラー番号 (隠れている・止められた・自分を待つ)", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    const hidden = a.speak("hidden");
    await hidden;
    await a.show(true);
    const stopped = a.delay(1000);
    const d = a.delay(10);
    const self = a.wait(d);
    await new Promise((res) => setTimeout(res, 50));
    a.stop(stopped);
    await self;
    return { hidden: hidden.number, stopped: [stopped.status, stopped.number], self: [self.status, self.number], ok: d.number };
  });
  expect(r).toEqual({
    hidden: -2147213302, // 0x8004200A
    stopped: ["interrupted", -2147213044], // 0x8004210C
    self: ["failed", -2147213051], // 0x80042105
    ok: 0,
  });
});

test("raiseRequestErrors: 失敗した命令は await で AgentRequestError、無いアニメーションの play はその場で例外。既定は例外にしない", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const quiet = await window.loadAgent("Merlin.acs");
    const loud = await window.loadAgent("Merlin.acs", { raiseRequestErrors: true });
    const catchError = async (f: () => unknown) => {
      try {
        await f();
        return "no error";
      } catch (e) {
        return e instanceof window.M.AgentRequestError ? `${e.name} ${e.number} ${e.request ? "request" : "-"}` : String(e);
      }
    };
    return {
      quiet: [quiet.play("NoSuchAnimation"), await quiet.speak("hidden")],
      play: await catchError(() => loud.play("NoSuchAnimation")),
      speak: await catchError(() => loud.speak("hidden")),
      interrupted: await (async () => {
        await loud.show(true);
        const d = loud.delay(1000);
        loud.stop();
        return d;
      })(),
    };
  });
  expect(r).toEqual({
    quiet: [false, "failed"],
    play: "AgentRequestError -2147213309 -",
    speak: "AgentRequestError -2147213302 request",
    interrupted: "interrupted", // 止められたのは例外にしない (本家と同じ)
  });
});

test("stop(request, { immediate: true }): 終わりの動きをせずに、その場で切る", async ({ harness }) => {
  const r = await harness.evaluate(async () => {
    const a = await window.loadAgent("Merlin.acs");
    await a.show(true);
    const loop = a.play("Processing", 0) as ReturnType<typeof a.show>;
    await new Promise((res) => setTimeout(res, 500));
    const t0 = performance.now();
    a.stop(loop, { immediate: true });
    const status = await loop;
    return { status, ms: performance.now() - t0, playing: a.player.requestedAnimation ?? null };
  });
  expect(r.status).toBe("interrupted");
  expect(r.ms).toBeLessThan(50);
  expect(r.playing).toBeNull();
});
