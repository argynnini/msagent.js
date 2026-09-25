import type { Agent } from "./agent";

/**
 * 命令の状態 (本家の Request.Status と同じ)。
 * pending: 順番待ち / inProgress: 実行中 / complete: 終わった / failed: できなかった / interrupted: 止められた
 */
export type RequestStatus = "pending" | "inProgress" | "complete" | "failed" | "interrupted";

/** 命令の種類 */
export type RequestType = "show" | "hide" | "play" | "gestureAt" | "moveTo" | "speak" | "think" | "delay" | "wait" | "interrupt" | "get";

/**
 * 失敗・中断の理由の番号 (本家の Request.Number と同じ値。Microsoft Agent Error Codes)。
 * 成功したときと、まだ終わっていないときは 0
 */
export const RequestError = {
  /** 指定したアニメーションが無い (0x80042003) */
  animationNotFound: -2147213309,
  /** その状態にアニメーションが無い (0x80042004) */
  stateNotFound: -2147213308,
  /** キャラクターが隠れているのでできない (0x8004200A) */
  hidden: -2147213302,
  /** get() の type が正しくない (0x8004200E) */
  invalidGetType: -2147213298,
  /** 自分の命令は interrupt できない (0x80042104) */
  interruptSelf: -2147213052,
  /** 自分の命令は wait できない (0x80042105) */
  waitSelf: -2147213051,
  /** アプリ (stop / interrupt / stopAll など) に止められた (0x8004210C) */
  interrupted: -2147213044,
  /** 音声ファイルが正しくない・読み込めない (0x80042207) */
  invalidSound: -2147212793,
  /** キャラクターが無い (destroy() で破棄された。0x80042002) */
  characterNotFound: -2147213310,
} as const;

let nextId = 1;

/**
 * 順番待ちに入った命令 1 つ (本家の Request オブジェクトと同じ)。
 * show / hide / play / speak / think / moveTo / gestureAt / delay / wait / interrupt / get が返す。
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
  /** failed / interrupted のときの理由の番号 (本家の Request.Number と同じ。RequestError のどれか)。それ以外は 0 */
  number = 0;
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
  settle(status: "complete" | "failed" | "interrupted", description = "", number = 0): boolean {
    if (this.done) return false;
    this.status = status;
    this.description = description;
    this.number = status === "interrupted" && !number ? RequestError.interrupted : number;
    this.resolveSettled(status);
    return true;
  }
}
