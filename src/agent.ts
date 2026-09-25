import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { ActCharacter, isActFile } from "./act/reader";
import { Balloon } from "./balloon";
import type { BalloonStyle, Character } from "./character";
import { IdleController, isIdleAnimation } from "./idle";
import type { Language } from "./language";
import { Speaker, voiceParams } from "./speak";
import { injectStyles } from "./styles";

export interface AgentOptions {
  /** キャラクターを置く要素 (既定: document.body) */
  container?: HTMLElement;
  /** 効果音を鳴らすか (既定: true)。ブラウザの制限で、ページが一度クリックされるまでは鳴らない */
  sound?: boolean;
  /** speak() で声に出して読み上げるか (既定: true)。false なら吹き出しと口の動きだけ */
  voice?: boolean;
  /** 何もしていない間、ときどき待機動作 (Idle 系) を再生するか (既定: true) */
  idle?: boolean;
  /** name / description の言語 (BCP 47 の "ja" など、または Windows の言語 ID)。省略時はブラウザの言語 */
  language?: Language | readonly Language[];
  /** 表示の倍率 (既定: 1 = キャラクターファイルのままの大きさ) */
  scale?: number;
  /** 吹き出しの見た目。キャラクターファイルの設定の上に、指定した項目だけを重ねる (agent.balloonStyle と同じ) */
  balloon?: Partial<BalloonStyle>;
}

/**
 * 吹き出しの見た目の既定値 (キャラクターファイルに設定が無いとき。.act など)。
 * Office アシスタントの吹き出しと同じ、薄い黄色に黒い縁
 */
export const DEFAULT_BALLOON_STYLE: Readonly<BalloonStyle> = {
  lines: 2,
  charsPerLine: 28,
  foreground: "#000000",
  background: "#ffffe1",
  border: "#000000",
  fontFamily: "Microsoft Sans Serif",
  fontSize: 13,
  fontWeight: 400,
  italic: false,
};

/** agent.on() で受け取れるイベントと、その detail */
export interface AgentEventMap {
  /** キャラクターの絵の部分がクリックされた (ドラッグの後は来ない) */
  click: { x: number; y: number; originalEvent: MouseEvent };
  /** ダブルクリックされた。event.preventDefault() すると、animate() しない */
  dblclick: { x: number; y: number; originalEvent: MouseEvent };
  /** ドラッグで動かし始めた / 動かし終えた (x, y はキャラクターの左上の位置) */
  dragstart: { x: number; y: number };
  dragend: { x: number; y: number };
  /** ドラッグか moveTo() で、別の場所に移った */
  move: { x: number; y: number; by: "drag" | "moveTo" };
  /** 大きさが変わった (scale / width / height)。width, height は表示の大きさ (px) */
  resize: { width: number; height: number; scale: number };
  /** show() で出た / hide() で消えた */
  show: Record<string, never>;
  hide: Record<string, never>;
  /** アニメーションが始まった / 終わった (idle: 待機動作か) */
  animationstart: { name: string; idle: boolean };
  animationend: { name: string; idle: boolean };
  /** しゃべり始めた / しゃべり終えた (途中でやめたときも来る) */
  speakstart: { text: string };
  speakend: { text: string };
}

export type AgentEventListener<K extends keyof AgentEventMap> = (event: CustomEvent<AgentEventMap[K]>) => void;

/** ドラッグとみなすまでの動き (px)。これより小さければクリック */
const DRAG_THRESHOLD = 3;

/** 順番待ちの 1 件。終わったら complete を呼ぶ */
type Task = (complete: () => void) => void;

/** play() の timeout の既定値 (clippy.js と同じ) */
const DEFAULT_TIMEOUT_MS = 5000;
/** 読み上げが終わってから、吹き出しを閉じるまで (clippy.js と同じ) */
const CLOSE_BALLOON_DELAY_MS = 2000;
/** animate() で選ばないもの (待機動作のほかに、登場・退場など) */
const NOT_FOR_ANIMATE = /^(Show|Hide|RestPose)$/i;

/** ACS (Microsoft Agent) か ACT (Office 97 のアシスタント) を、中身から見分けて読み込む */
export function parseCharacter(data: ArrayBuffer): Character {
  return isActFile(data) ? new ActCharacter(data) : new AcsCharacter(data);
}

/** 大文字小文字を問わず、実在するアニメーション名に直す (無ければ undefined) */
function findAnimation(character: Character, name: string): string | undefined {
  if (character.animations.has(name)) return name;
  const lower = name.toLowerCase();
  for (const key of character.animations.keys()) if (key.toLowerCase() === lower) return key;
  return undefined;
}

/**
 * キャラクター 1 体。clippy.js の Agent と同じ使い方ができる。
 * play / speak / moveTo / gestureAt / delay は順番待ちに入り、前のものが終わってから 1 つずつ実行される
 */
export class Agent extends EventTarget {
  /** キャラクターの要素 (div.msagent)。この中に canvas がある */
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly player: AcsPlayer;
  private readonly balloon: Balloon;
  private readonly speaker: Speaker;
  private readonly idle: IdleController | undefined;
  /** speak() で声に出すか */
  voice: boolean;
  /** name / description の言語 (BCP 47 か Windows の言語 ID)。undefined ならブラウザの言語 */
  language: Language | readonly Language[] | undefined;

  private currentScale = 1;
  /** balloonStyle で指定された項目 (キャラクターファイルの設定の上に重ねる) */
  private balloonOverrides: Partial<BalloonStyle> = {};
  private queue: Task[] = [];
  private running = false;
  /** stop() / hide() で順番待ちを捨てるたびに増やし、捨てたものの complete を無視する */
  private generation = 0;
  private hidden = true;
  /** speak(text, true): 読み終えても吹き出しを閉じず、closeBalloon() まで次へ進まない */
  private hold = false;
  private speechComplete: (() => void) | undefined;
  private balloonTimer: number | undefined;
  private destroyed = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    readonly character: Character,
    options: AgentOptions = {},
  ) {
    super();
    injectStyles();
    this.element = document.createElement("div");
    this.element.className = "msagent";
    this.element.style.display = "none";
    this.canvas = document.createElement("canvas");
    this.element.append(this.canvas);
    this.player = new AcsPlayer(character, this.canvas);
    this.player.soundEnabled = options.sound ?? true;
    this.voice = options.voice ?? true;
    this.language = options.language;
    this.balloonOverrides = { ...options.balloon };
    this.balloon = new Balloon(this.element, this.balloonStyle);
    this.applyScale(options.scale ?? 1);
    this.speaker = new Speaker(() => this.player);
    (options.container ?? document.body).append(this.element, this.balloon.element);

    if (options.idle ?? true) {
      this.idle = new IdleController({
        player: () => this.player,
        character: () => this.character,
        busy: () => this.hidden || this.running || this.speaker.speaking || this.hold || this.player.isPaused,
      });
      this.idle.start();
    }
    let playing: string | undefined;
    this.player.onPlayingChange = (active) => {
      if (active) {
        playing = this.player.currentAnimation;
        if (playing) this.emit("animationstart", { name: playing, idle: isIdleAnimation(character, playing) });
      } else {
        if (playing) this.emit("animationend", { name: playing, idle: isIdleAnimation(character, playing) });
        playing = undefined;
        this.idle?.animationEnded();
      }
    };

    this.setupDrag();
    this.listen(this.element, "dblclick", (e) => {
      const ev = e as MouseEvent;
      if (this.emit("dblclick", { x: ev.clientX, y: ev.clientY, originalEvent: ev }, true)) this.animate();
    });
    this.listen(window, "resize", () => this.reposition());
    // 最初の操作で音を鳴らせるようにしておく (自動再生の制限)
    const unlock = () => this.player.unlockAudio();
    this.listen(window, "pointerdown", unlock, true);
    this.listen(window, "keydown", unlock, true);
  }

  // --- clippy.js と同じ API ---

  /** 登場する。fast なら、アニメーションなしですぐ出す */
  show(fast?: boolean): boolean {
    this.hidden = false;
    this.element.style.display = "block";
    this.emit("show", {});
    if (!this.element.style.left) {
      // clippy.js と同じく、画面の右下寄り (はみ出す分は reposition で戻す)
      this.element.style.left = `${window.innerWidth * 0.8}px`;
      this.element.style.top = `${window.innerHeight * 0.8}px`;
    }
    this.reposition();
    this.resume();
    if (fast) {
      this.drawRestPose();
      return true;
    }
    if (this.play("Show")) return true;
    this.drawRestPose();
    return false;
  }

  /** 退場する (Hide を再生してから消す)。fast なら、すぐ消す */
  hide(fast?: boolean, callback?: () => void): void {
    this.hidden = true;
    this.stop();
    const gen = this.generation;
    const finish = () => {
      if (gen !== this.generation || !this.hidden) return; // 退場中に show() された
      this.player.stop();
      this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.element.style.display = "none";
      this.balloon.hide();
      this.pause();
      this.emit("hide", {});
      callback?.();
    };
    const name = findAnimation(this.character, "Hide");
    if (fast || !name) return finish();
    void this.player.play(name).then(finish);
  }

  /**
   * アニメーションを再生する。timeout (ms、既定 5000。0 なら無制限) を過ぎても終わらなければ、終了分岐で自然に終わらせる。
   * 終わったら callback。キャラクターに無いアニメーションなら false。
   * 最後の姿勢 (指す・見るなど) は、次のアニメーションまで保ち、戻りの動きはその前に再生する
   */
  play(animation: string, timeout = DEFAULT_TIMEOUT_MS, callback?: () => void): boolean {
    const name = findAnimation(this.character, animation);
    if (!name) return false;
    this.addToQueue((complete) => {
      const timer = timeout
        ? window.setTimeout(() => {
            if (this.player.currentAnimation === name) void this.player.release();
          }, timeout)
        : undefined;
      // Microsoft Agent と同じく、戻りの動きは次のアニメーションの前にする (指した姿勢のまましゃべれる)
      void this.player.play(name, { hold: true }).then(() => {
        window.clearTimeout(timer);
        callback?.();
        complete();
      });
    });
    return true;
  }

  /** 待機動作以外から、アニメーションを 1 つ選んで再生する */
  animate(): boolean {
    const names = this.animations().filter((n) => !isIdleAnimation(this.character, n) && !NOT_FOR_ANIMATE.test(n));
    const name = names[Math.floor(Math.random() * names.length)];
    return name !== undefined && this.play(name);
  }

  /** アニメーション名の一覧 */
  animations(): string[] {
    return [...this.character.animations.keys()];
  }

  hasAnimation(name: string): boolean {
    return findAnimation(this.character, name) !== undefined;
  }

  /**
   * 吹き出しでしゃべる (声に出すのは voice が true のとき)。
   * hold なら、読み終えても吹き出しを閉じず、closeBalloon() まで次の命令に進まない
   */
  speak(text: string, hold?: boolean): void {
    this.addToQueue(async (complete) => {
      // 口の画像が無いコマ (待機動作の終わりなど) では口が動かないので、Microsoft Agent と同じく、
      // しゃべるとき用のアニメーション (Speaking の状態。多くは RestPose) に切り替えてから
      if (!this.player.hasMouth) {
        const speaking = this.speakingAnimation();
        const gen = this.generation;
        if (speaking) await this.player.play(speaking, { hold: true });
        if (gen !== this.generation) return; // 切り替えの間に stop() された
      }
      window.clearTimeout(this.balloonTimer);
      this.hold = !!hold;
      this.speechComplete = complete;
      this.emit("speakstart", { text });
      this.balloon.setText("");
      this.balloon.show();
      this.speaker.speak(
        text,
        {
          onProgress: (shown) => this.balloon.setText(shown),
          onEnd: () => {
            this.emit("speakend", { text });
            if (this.hold) return;
            this.completeSpeech();
            this.balloonTimer = window.setTimeout(() => this.balloon.hide(), CLOSE_BALLOON_DELAY_MS);
          },
        },
        voiceParams(this.character.voice),
        this.voice,
      );
    });
  }

  /** 吹き出しを閉じる (読み上げ中ならやめる) */
  closeBalloon(): void {
    this.hold = false;
    this.speaker.cancel();
    this.completeSpeech();
    window.clearTimeout(this.balloonTimer);
    this.balloon.hide();
  }

  /** (x, y) の方を指す (Gesture〜、無ければ Look〜) */
  gestureAt(x: number, y: number): boolean {
    const d = this.direction(x, y);
    return this.play(this.hasAnimation(`Gesture${d}`) ? `Gesture${d}` : `Look${d}`);
  }

  /**
   * (x, y) へ移動する。Move〜 のアニメーションがあれば、Microsoft Agent と同じく
   * 移動前の動き → 最後のコマのまま移動 → 移動後の動き (戻りアニメか終了分岐) の順にする。duration が 0 なら、すぐ移る
   */
  moveTo(x: number, y: number, duration = 1000): void {
    this.addToQueue(async (complete) => {
      if (duration === 0) {
        this.setPosition(x, y);
        this.emit("move", { ...this.position, by: "moveTo" });
        return complete();
      }
      const name = findAnimation(this.character, `Move${this.direction(x, y)}`);
      if (name) await this.player.play(name, { hold: true });
      await this.slide(x, y, duration);
      this.emit("move", { ...this.position, by: "moveTo" });
      if (name) await this.player.playReturn();
      complete();
    });
  }

  /** 次の命令まで、time (ms、既定 250) 待つ */
  delay(time = 250): void {
    this.addToQueue((complete) => window.setTimeout(complete, time));
  }

  /** いまのアニメーションを、終了分岐で自然に終わらせる (しゃべっている途中なら、読み終えたら吹き出しを閉じる) */
  stopCurrent(): void {
    void this.player.release();
    if (this.speaker.speaking) this.hold = false;
    else if (this.hold) this.closeBalloon();
  }

  /** 順番待ちを全部捨て、いまのアニメーションを終わらせ、吹き出しを閉じる */
  stop(): void {
    this.clearQueue();
    void this.player.release();
    this.closeBalloon();
  }

  /** アニメーションを一時停止する */
  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.resume();
  }

  /** キャラクターと吹き出しを、画面の中に収める */
  reposition(): void {
    if (this.element.style.display === "none") return;
    const r = this.element.getBoundingClientRect();
    this.setPosition(r.left, r.top);
  }

  // --- msagent.js で足したもの ---

  /**
   * 表示の倍率 (1 = キャラクターファイルのままの大きさ)。変えても、足もと (下端の真ん中) の位置は変わらない。
   * 拡大するときは、ドット絵がぼけないように、ぼかさずに引き伸ばす
   */
  get scale(): number {
    return this.currentScale;
  }

  set scale(value: number) {
    if (!(value > 0) || value === this.currentScale) return;
    const before = this.element.getBoundingClientRect();
    this.applyScale(value);
    if (this.element.style.display !== "none" && before.width > 0) {
      // 足もとをそろえる
      this.setPosition(before.left + before.width / 2 - this.width / 2, before.bottom - this.height);
    }
    this.emit("resize", { width: this.width, height: this.height, scale: value });
  }

  /**
   * 吹き出しの見た目 (いま使われているもの。キャラクターファイルの設定 + 指定した項目)。
   * 代入すると、キャラクターファイルの設定の上に、指定した項目だけを重ねる。undefined や {} でファイルの設定に戻す。
   *
   * ```js
   * agent.balloonStyle = { background: "#222", foreground: "#fff", fontSize: 16 };
   * agent.balloonStyle = { ...agent.balloonStyle, border: "red" }; // 今の見た目に足す
   * ```
   */
  get balloonStyle(): BalloonStyle {
    const defined = Object.fromEntries(Object.entries(this.balloonOverrides).filter(([, v]) => v !== undefined));
    return { ...DEFAULT_BALLOON_STYLE, ...this.character.balloon, ...defined };
  }

  set balloonStyle(style: Partial<BalloonStyle> | undefined) {
    this.balloonOverrides = { ...style };
    this.balloon.setStyle(this.balloonStyle);
  }

  /** 表示の幅 (px)。代入すると、縦横の比を保ったまま大きさを変える (本家の Width と同じ) */
  get width(): number {
    return Math.round(this.character.width * this.currentScale);
  }

  set width(px: number) {
    this.scale = px / this.character.width;
  }

  /** 表示の高さ (px)。代入すると、縦横の比を保ったまま大きさを変える (本家の Height と同じ) */
  get height(): number {
    return Math.round(this.character.height * this.currentScale);
  }

  set height(px: number) {
    this.scale = px / this.character.height;
  }

  /** 名前 (language の言語。省略時はブラウザの言語) */
  get name(): string | undefined {
    return this.character.getName(this.language);
  }

  /** 紹介文 (language の言語。省略時はブラウザの言語) */
  get description(): string | undefined {
    return this.character.getDescription(this.language);
  }

  /** しゃべっている途中か (speak(text, true) で吹き出しを出したままのときも true) */
  get speaking(): boolean {
    return this.speaker.speaking || this.hold;
  }

  /** イベントを受け取る (addEventListener と同じ。detail に中身が入る) */
  on<K extends keyof AgentEventMap>(type: K, listener: AgentEventListener<K>, options?: AddEventListenerOptions): this {
    this.addEventListener(type, listener as EventListener, options);
    return this;
  }

  off<K extends keyof AgentEventMap>(type: K, listener: AgentEventListener<K>): this {
    this.removeEventListener(type, listener as EventListener);
    return this;
  }

  get sound(): boolean {
    return this.player.soundEnabled;
  }

  set sound(on: boolean) {
    this.player.soundEnabled = on;
  }

  /** 画面上の位置 (clientX / clientY) に、キャラクターの絵があるか (透明な部分なら false) */
  hitTest(clientX: number, clientY: number): boolean {
    return this.player.hitTest(clientX, clientY);
  }

  /** 後片付け: 再生・読み上げ・待機動作をやめ、要素を取り除く */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.hidden = true;
    this.stop();
    this.idle?.stop();
    this.player.stop();
    this.player.onPlayingChange = undefined;
    for (const cleanup of this.cleanups) cleanup();
    this.element.remove();
    this.balloon.element.remove();
  }

  // --- 内部 ---

  private applyScale(scale: number) {
    this.currentScale = scale;
    this.canvas.style.width = `${this.character.width * scale}px`;
    this.canvas.style.height = `${this.character.height * scale}px`;
    // 拡大はドット絵のまま、縮小はなめらかに
    this.canvas.style.imageRendering = scale > 1 ? "pixelated" : "auto";
    this.balloon.reposition();
  }

  /** イベントを出す。cancelable で preventDefault() されたら false */
  private emit<K extends keyof AgentEventMap>(type: K, detail: AgentEventMap[K], cancelable = false): boolean {
    return this.dispatchEvent(new CustomEvent(type, { detail, cancelable }));
  }

  private get position(): { x: number; y: number } {
    const r = this.element.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  private addToQueue(task: Task) {
    if (this.destroyed) return;
    this.queue.push(task);
    if (!this.running) void this.next();
  }

  private async next() {
    const task = this.queue.shift();
    if (!task) {
      this.running = false;
      return;
    }
    this.running = true;
    const gen = this.generation;
    // 待機動作の途中なら、終了分岐で自然に終わらせてから
    this.idle?.userActivity();
    await this.idle?.interrupt();
    if (gen !== this.generation) return;
    let done = false;
    task(() => {
      if (done || gen !== this.generation) return;
      done = true;
      void this.next();
    });
  }

  private clearQueue() {
    this.queue = [];
    this.generation++;
    this.running = false;
  }

  private completeSpeech() {
    const complete = this.speechComplete;
    this.speechComplete = undefined;
    complete?.();
  }

  /** しゃべるとき用のアニメーション (Speaking の状態、無ければ RestPose)。口の画像があるものだけ */
  private speakingAnimation(): string | undefined {
    const candidates = [...this.character.stateAnimations("Speaking"), "RestPose"];
    return candidates
      .map((n) => findAnimation(this.character, n))
      .find((n) => n !== undefined && this.character.animations.get(n)!.frames.some((f) => f.overlays.length > 0));
  }

  /** 止まっているときの絵 (RestPose、無ければ Show の最後のコマ) を描く */
  private drawRestPose() {
    const rest = this.character.animations.get(findAnimation(this.character, "RestPose") ?? "");
    const show = this.character.animations.get(findAnimation(this.character, "Show") ?? "");
    const frame = rest?.frames[0] ?? show?.frames.at(-1) ?? this.character.animations.values().next().value?.frames[0];
    if (frame) this.player.draw(frame);
  }

  /**
   * (x, y) がキャラクターから見てどちらか (clippy.js と同じ判定)。
   * キャラクターの向きで数えるので、画面の左が "Right" になる
   */
  private direction(x: number, y: number): "Right" | "Up" | "Left" | "Down" {
    const r = this.element.getBoundingClientRect();
    const a = r.top + r.height / 2 - y;
    const b = r.left + r.width / 2 - x;
    const deg = Math.round((180 * Math.atan2(a, b)) / Math.PI);
    if (deg >= -45 && deg < 45) return "Right";
    if (deg >= 45 && deg < 135) return "Up";
    if (deg >= -135 && deg < -45) return "Down";
    return "Left";
  }

  /** 画面からはみ出さないように置く */
  private setPosition(x: number, y: number) {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    this.element.style.left = `${Math.max(0, Math.min(x, vw - w))}px`;
    this.element.style.top = `${Math.max(0, Math.min(y, vh - h))}px`;
    this.balloon.reposition();
  }

  private slide(x: number, y: number, duration: number): Promise<void> {
    const r = this.element.getBoundingClientRect();
    const start = performance.now();
    return new Promise((resolve) => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        this.setPosition(r.left + (x - r.left) * t, r.top + (y - r.top) * t);
        if (t < 1 && !this.destroyed) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /**
   * 透明な部分は押せない (下のページに通す) ようにし、絵の部分だけドラッグで動かせるようにする。
   * 要素はふだん pointer-events: none で、ポインターが絵の上にあるときだけ .msagent-hit で押せるようにする。
   * タッチは押すまで位置が分からないので、押した時点で絵の上なら、そのままドラッグを始める
   */
  private setupDrag() {
    /** つかんだ位置 (キャラクターの左上から) と、つかんだ画面上の位置 */
    let grab: { dx: number; dy: number; x: number; y: number } | undefined;
    let dragging = false;
    /** ドラッグの後に来る click は、クリックとして扱わない */
    let suppressClick = false;
    const setHit = (hit: boolean) => this.element.classList.toggle("msagent-hit", hit);
    this.listen(
      document,
      "pointermove",
      (e) => {
        const ev = e as PointerEvent;
        if (!grab) return void setHit(this.hitTest(ev.clientX, ev.clientY));
        if (!dragging && Math.hypot(ev.clientX - grab.x, ev.clientY - grab.y) < DRAG_THRESHOLD) return;
        if (!dragging) {
          dragging = true;
          this.emit("dragstart", this.position);
        }
        this.setPosition(ev.clientX - grab.dx, ev.clientY - grab.dy);
      },
      true,
    );
    this.listen(
      document,
      "pointerdown",
      (e) => {
        const ev = e as PointerEvent;
        if (ev.button !== 0 || !this.hitTest(ev.clientX, ev.clientY)) return;
        setHit(true);
        const r = this.element.getBoundingClientRect();
        grab = { dx: ev.clientX - r.left, dy: ev.clientY - r.top, x: ev.clientX, y: ev.clientY };
        dragging = false;
        this.element.setPointerCapture(ev.pointerId);
        // 文字の選択や、画像のドラッグを始めない
        ev.preventDefault();
      },
      true,
    );
    // タッチで絵をつかんだときは、ページをスクロールさせない
    this.listen(
      document,
      "touchstart",
      (e) => {
        const touch = (e as TouchEvent).touches[0];
        if (touch && this.hitTest(touch.clientX, touch.clientY)) e.preventDefault();
      },
      { capture: true, passive: false },
    );
    const end = () => {
      if (!grab) return;
      grab = undefined;
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      // click はこの後すぐに来る (来なければ、次の操作までに戻しておく)
      window.setTimeout(() => (suppressClick = false), 0);
      const pos = this.position;
      this.emit("dragend", pos);
      this.emit("move", { ...pos, by: "drag" });
    };
    this.listen(this.element, "pointerup", end);
    this.listen(this.element, "pointercancel", end);
    this.listen(this.element, "lostpointercapture", end);
    this.listen(this.element, "click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.stopPropagation();
        return;
      }
      const ev = e as MouseEvent;
      this.emit("click", { x: ev.clientX, y: ev.clientY, originalEvent: ev });
    });
  }



  private listen(target: EventTarget, type: string, handler: (e: Event) => void, options: boolean | AddEventListenerOptions = false) {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }
}
