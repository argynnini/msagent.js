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
