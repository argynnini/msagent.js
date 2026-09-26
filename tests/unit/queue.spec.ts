import { expect, test } from "@playwright/test";
import type { Agent } from "../../src/agent";
import { RequestQueue, type Task } from "../../src/queue";
import type { AgentRequest } from "../../src/request";

/** 順番待ちと、始まった・終わった記録 */
function setup() {
  const log: string[] = [];
  const queue = new RequestQueue({} as Agent, {
    beforeStart: async () => {},
    onStart: (r) => log.push(`start #${r.id} ${r.type}`),
    onSettle: (r) => log.push(`end #${r.id} ${r.type} ${r.status}`),
  });
  /** 手で終わらせる命令 */
  const manual = () => {
    let complete: Parameters<Task>[0] | undefined;
    const task: Task = (c) => (complete = c);
    return { task, finish: (...args: Parameters<Parameters<Task>[0]>) => complete!(...args) };
  };
  return { queue, log, manual };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("命令は 1 つずつ順番に実行し、await すると終わったときの状態が返る", async () => {
  const { queue, log, manual } = setup();
  const a = manual();
  const b = manual();
  const ra = queue.add("play", a.task);
  const rb = queue.add("speak", b.task);
  await tick();
  expect(ra.status).toBe("inProgress");
  expect(rb.status).toBe("pending");
  a.finish();
  await tick();
  expect(rb.status).toBe("inProgress");
  b.finish("failed", "だめ");
  expect(await ra).toBe("complete");
  expect(await rb).toBe("failed");
  expect(rb.description).toBe("だめ");
  expect(log).toEqual([
    `start #${ra.id} play`,
    `end #${ra.id} play complete`,
    `start #${rb.id} speak`,
    `end #${rb.id} speak failed`,
  ]);
});

test("clear: 実行中も順番待ちも interrupted にし、後から来た complete は無視する", async () => {
  const { queue, manual } = setup();
  const a = manual();
  const ra = queue.add("play", a.task);
  const rb = queue.add("speak", manual().task);
  await tick();
  queue.clear();
  expect([ra.status, rb.status]).toEqual(["interrupted", "interrupted"]);
  a.finish();
  expect(ra.status).toBe("interrupted");
  expect(queue.busy).toBe(false);
});

test("drop: 順番待ちから条件に合うものだけ取り除く", async () => {
  const { queue, manual } = setup();
  const a = manual();
  const ra = queue.add("play", a.task);
  const rb = queue.add("speak", manual().task);
  const rc = queue.add("moveTo", manual().task);
  await tick();
  queue.drop((r: AgentRequest) => r.type === "speak");
  expect([ra.status, rb.status, rc.status]).toEqual(["inProgress", "interrupted", "pending"]);
  a.finish();
  await tick();
  expect(rc.status).toBe("inProgress");
});

test("interruptCurrent: 止めるように言い、abort を呼び、終わったら interrupted。次の命令へ進む", async () => {
  const { queue, manual } = setup();
  let aborted = false;
  const ra = queue.add("delay", (complete) => queue.onAbort(() => ((aborted = true), complete())));
  const b = manual();
  const rb = queue.add("play", b.task);
  await tick();
  let stopped = false;
  queue.interruptCurrent(() => (stopped = true));
  expect([stopped, aborted]).toEqual([true, true]);
  expect(await ra).toBe("interrupted");
  await tick();
  expect(rb.status).toBe("inProgress");
});

test("close した後の命令は failed", async () => {
  const { queue } = setup();
  queue.close();
  const r = queue.add("play", () => {});
  expect(await r).toBe("failed");
});
