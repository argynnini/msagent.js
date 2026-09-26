import type { Agent } from "./agent.js";

/**
 * State of a request. Same as Microsoft Agent's `Request.Status`.
 *
 * - `"pending"`: waiting in the queue
 * - `"inProgress"`: running
 * - `"complete"`: finished successfully
 * - `"failed"`: could not be done (see `description` / `number`)
 * - `"interrupted"`: stopped by `stop()` / `stopAll()` / `interrupt()`
 */
export type RequestStatus = "pending" | "inProgress" | "complete" | "failed" | "interrupted";

/** Kind of request: the name of the {@link Agent} method that created it. */
export type RequestType =
  "show" | "hide" | "play" | "gestureAt" | "moveTo" | "speak" | "think" | "delay" | "wait" | "interrupt" | "get";

/**
 * Error numbers for failed or interrupted requests, with the same values as Microsoft Agent's `Request.Number`
 * (Microsoft Agent Error Codes). A request that succeeded or has not finished has number `0`.
 *
 * ```js
 * import { RequestError } from "@argynnini/msagent.js";
 *
 * const request = agent.get("animation", "Wave");
 * await request;
 * if (request.number === RequestError.invalidAnimation) console.warn(request.description);
 * ```
 */
export const RequestError = {
  /** The animation does not exist (0x80042003). */
  animationNotFound: -2147213309,
  /** No animation is assigned to the state (0x80042004). */
  stateNotFound: -2147213308,
  /** Not possible while the character is hidden (0x8004200A). */
  hidden: -2147213302,
  /** Invalid `type` for `get()` (0x8004200E). */
  invalidGetType: -2147213298,
  /** The animation is invalid: corrupt, without frames, or could not be downloaded (0x8004200F). */
  invalidAnimation: -2147213297,
  /** A character cannot `interrupt()` its own request (0x80042104). */
  interruptSelf: -2147213052,
  /** A character cannot `wait()` for its own request (0x80042105). */
  waitSelf: -2147213051,
  /** Stopped by the application (`stop()`, `stopAll()`, `interrupt()`, ...) (0x8004210C). */
  interrupted: -2147213044,
  /** The sound file is invalid or could not be loaded (0x80042207). */
  invalidSound: -2147212793,
  /** The character no longer exists because it was destroyed with `destroy()` (0x80042002). */
  characterNotFound: -2147213310,
} as const;

let nextId = 1;

/**
 * Thrown (or used to reject an awaited request) when a request fails and `agent.raiseRequestErrors` is `true`.
 * Same idea as Microsoft Agent raising errors for failed requests.
 */
export class AgentRequestError extends Error {
  constructor(
    /** Error number, one of the {@link RequestError} values. */
    readonly number: number,
    description: string,
    /** The failed request, or `undefined` if the call failed before a request was created. */
    readonly request?: AgentRequest,
  ) {
    super(description);
    this.name = "AgentRequestError";
  }
}

/**
 * A queued request. Same as Microsoft Agent's `Request` object.
 *
 * Returned by `show` / `hide` / `play` / `speak` / `think` / `moveTo` / `gestureAt` / `delay` / `wait` /
 * `interrupt` / `get`. Awaiting it gives the final status (`"complete"` / `"failed"` / `"interrupted"`);
 * with `agent.raiseRequestErrors`, a failed request rejects with {@link AgentRequestError} instead.
 *
 * ```js
 * const request = agent.play("Wave");
 * console.log(request.status);        // "pending" / "inProgress"
 * console.log(await request);         // "complete"
 * agent.stop(request);                // stop only this request
 * ```
 */
export class AgentRequest implements PromiseLike<RequestStatus> {
  /** Unique ID of the request. Same as Microsoft Agent's `Request.ID`. */
  readonly id = nextId++;
  /** Current state of the request. */
  status: RequestStatus = "pending";
  /** Why the request failed, or `""`. Same as Microsoft Agent's `Request.Description`. */
  description = "";
  /**
   * Error number when the request failed or was interrupted (one of the {@link RequestError} values), otherwise `0`.
   * Same as Microsoft Agent's `Request.Number`.
   */
  number = 0;
  /** @internal Asked to stop; the request settles as interrupted. */
  interruptRequested = false;
  private readonly settled: Promise<RequestStatus>;
  private resolveSettled!: (status: RequestStatus) => void;
  private rejectSettled!: (error: AgentRequestError) => void;

  /** @internal Requests are created by the {@link Agent} methods. */
  constructor(
    /** Kind of request. */
    readonly type: RequestType,
    /** The character the request belongs to. */
    readonly agent: Agent,
  ) {
    this.settled = new Promise((resolve, reject) => {
      this.resolveSettled = resolve;
      this.rejectSettled = reject;
    });
  }

  /** Whether the request has finished (`"complete"`, `"failed"` or `"interrupted"`). */
  get done(): boolean {
    return this.status === "complete" || this.status === "failed" || this.status === "interrupted";
  }

  /** Makes the request awaitable. Resolves with the final status. */
  /** Makes the request awaitable. Resolves with the final status. */
  then<T = RequestStatus, E = never>(
    onFulfilled?: ((status: RequestStatus) => T | PromiseLike<T>) | null,
    onRejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return this.settled.then(onFulfilled, onRejected);
  }

  /** @internal Marks the request as started. */
  start() {
    if (this.status === "pending") this.status = "inProgress";
  }

  /** @internal Settles the request. Returns false if it had already finished. */
  settle(status: "complete" | "failed" | "interrupted", description = "", number = 0): boolean {
    if (this.done) return false;
    this.status = status;
    this.description = description;
    this.number = status === "interrupted" && !number ? RequestError.interrupted : number;
    if (status === "failed" && this.agent.raiseRequestErrors)
      this.rejectSettled(new AgentRequestError(this.number, description, this));
    else this.resolveSettled(status);
    return true;
  }
}
