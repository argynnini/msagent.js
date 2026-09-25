import type { Agent } from "./agent";

/**
 * 命令の状態 (本家の Request.Status と同じ)。
 * pending: 順番待ち / inProgress: 実行中 / complete: 終わった / failed: できなかった / interrupted: 止められた
 */
export type RequestStatus = "pending" | "inProgress" | "complete" | "failed" | "interrupted";

/** 命令の種類 */
export type RequestType = "show" | "hide" | "play" | "gestureAt" | "moveTo" | "speak" | "think" | "delay" | "wait" | "interrupt";

let nextId = 1;

/**
 * 順番待ちに入った命令 1 つ (本家の Request オブジェクトと同じ)。
 * show / hide / play / speak / think / moveTo / gestureAt / delay / wait / interrupt が返す。
 * await すると、終わったときの状態 (complete / failed / interrupted) が返る
 *
 * ```js
 * const request = agent.play("Wave");
 * console.log(request.status);        // "pending" / "inProgress"
 * console.log(await request);         // "complete"
 * agent.stop(request);                // この命令だけ止める
 * ```
 */
export class AgentRequest implements PromiseLike<RequestStatus> {
  readonly id = nextId++;
  status: RequestStatus = "pending";
  /** failed のときの理由 */
  description = "";
  /** @internal 止めるように言われた (終わったとき interrupted にする) */
  interruptRequested = false;
  private readonly settled: Promise<RequestStatus>;
  private resolveSettled!: (status: RequestStatus) => void;

  constructor(
    readonly type: RequestType,
    /** この命令を受けたキャラクター */
    readonly agent: Agent,
  ) {
    this.settled = new Promise((resolve) => (this.resolveSettled = resolve));
  }

  /** 終わったか (complete / failed / interrupted) */
  get done(): boolean {
    return this.status === "complete" || this.status === "failed" || this.status === "interrupted";
  }

  then<T = RequestStatus, E = never>(
    onFulfilled?: ((status: RequestStatus) => T | PromiseLike<T>) | null,
    onRejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return this.settled.then(onFulfilled, onRejected);
  }

  /** @internal 実行を始めた */
  start() {
    if (this.status === "pending") this.status = "inProgress";
  }

  /** @internal 終わった。すでに終わっていれば false */
  settle(status: "complete" | "failed" | "interrupted", description = ""): boolean {
    if (this.done) return false;
    this.status = status;
    this.description = description;
    this.resolveSettled(status);
    return true;
  }
}
