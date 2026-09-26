import type { Agent } from "./agent.js";
import { AgentRequest, RequestError, type RequestType } from "./request.js";

/** 順番待ちの命令の中身。終わったら complete を呼ぶ (できなかったときは "failed" と理由、その番号 (RequestError)) */
export type Task = (
  complete: (status?: "complete" | "failed", description?: string, number?: number) => void,
  request: AgentRequest,
) => void;

export interface QueueHooks {
  /** 命令を始める前に待つもの (待機動作を終わらせるなど) */
  beforeStart(): Promise<void>;
  /** 命令を始めた / 終えた (requeststart / requestcomplete) */
  onStart(request: AgentRequest): void;
  onSettle(request: AgentRequest): void;
}

/**
 * キャラクター 1 体の、命令の順番待ち (本家のアニメーションのキュー)。
 * 命令は 1 つずつ実行し、前の命令が complete を呼んだら次へ進む
 */
export class RequestQueue {
  private items: { request: AgentRequest; task: Task }[] = [];
  private running = false;
  private currentRequest: AgentRequest | undefined;
  /** 実行中の命令を途中で止めるときに呼ぶもの (delay の待ちなど) */
  private abort: (() => void) | undefined;
  /** clear() のたびに増やし、捨てた命令の complete を無視する */
  private gen = 0;
  private closed = false;

  constructor(
    private readonly owner: Agent,
    private readonly hooks: QueueHooks,
  ) {}

  /** 命令を実行している (または始めようとしている) か */
  get busy(): boolean {
    return this.running;
  }

  /** いま実行中の命令 */
  get current(): AgentRequest | undefined {
    return this.currentRequest;
  }

  /** clear() のたびに変わる番号 (命令の途中で await したあと、捨てられていないか確かめるため) */
  get generation(): number {
    return this.gen;
  }

  /** 命令を順番待ちに入れる。前の命令が終わっていれば、すぐ始める */
  add(type: RequestType, task: Task): AgentRequest {
    const request = new AgentRequest(type, this.owner);
    if (this.closed) {
      this.settle(request, "failed", "The character has been destroyed with destroy()", RequestError.characterNotFound);
      return request;
    }
    this.items.push({ request, task });
    if (!this.running) void this.next();
    return request;
  }

  /** 順番待ちに入れず、すぐ実行する (get(…, false))。順番待ちの命令とは別に進む */
  runNow(type: RequestType, task: Task): AgentRequest {
    const request = new AgentRequest(type, this.owner);
    if (this.closed) {
      this.settle(request, "failed", "The character has been destroyed with destroy()", RequestError.characterNotFound);
      return request;
    }
    request.start();
    this.hooks.onStart(request);
    task((status = "complete", description, number) => this.settle(request, status, description, number), request);
    return request;
  }

  /** 実行中の命令を途中で止めるときに呼ぶものを決める (実行中の命令から呼ぶ) */
  onAbort(abort: () => void) {
    this.abort = abort;
  }

  /** 命令を終わらせ、onSettle を呼ぶ (すでに終わっていれば何もしない) */
  settle(request: AgentRequest, status: "complete" | "failed" | "interrupted", description = "", number = 0) {
    if (request.settle(status, description, number)) this.hooks.onSettle(request);
  }

  /** 順番待ちを全部捨てる (実行中の命令も、止められたことにする) */
  clear() {
    this.drop(() => true);
    if (this.currentRequest) this.settle(this.currentRequest, "interrupted");
    this.currentRequest = undefined;
    this.abort = undefined;
    this.gen++;
    this.running = false;
  }

  /** 順番待ち (まだ始まっていないもの) から、条件に合う命令を取り除く */
  drop(matches: (request: AgentRequest) => boolean) {
    const kept: typeof this.items = [];
    for (const item of this.items) {
      if (matches(item.request)) this.settle(item.request, "interrupted");
      else kept.push(item);
    }
    this.items = kept;
  }

  /**
   * 実行中の命令を止めるように言う (終わったら interrupted になる)。stopWork で中身 (アニメーションなど) を止め、
   * 待ちなどは onAbort で決めたもので止める。順番待ちは捨てない
   */
  interruptCurrent(stopWork: () => void) {
    const request = this.currentRequest;
    if (!request) return;
    request.interruptRequested = true;
    stopWork();
    this.abort?.();
  }

  /** これ以上命令を受け付けない (destroy() したとき) */
  close() {
    this.clear();
    this.closed = true;
  }

  private async next() {
    const item = this.items.shift();
    if (!item) {
      this.running = false;
      this.currentRequest = undefined;
      return;
    }
    const { request, task } = item;
    this.running = true;
    this.currentRequest = request;
    this.abort = undefined;
    const gen = this.gen;
    await this.hooks.beforeStart();
    if (gen !== this.gen || request.done) return;
    // 始める前に止められた命令は、始めずに次へ
    if (request.interruptRequested) {
      this.settle(request, "interrupted");
      this.currentRequest = undefined;
      return void this.next();
    }
    request.start();
    this.hooks.onStart(request);
    let done = false;
    task((status = "complete", description, number) => {
      if (done) return;
      done = true;
      if (request.interruptRequested) this.settle(request, "interrupted");
      else this.settle(request, status, description, number);
      if (gen !== this.gen || this.currentRequest !== request) return;
      this.currentRequest = undefined;
      this.abort = undefined;
      void this.next();
    }, request);
  }
}
