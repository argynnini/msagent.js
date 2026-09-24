import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { ActCharacter, isActFile } from "./act/reader";
import { Balloon } from "./balloon";
import type { Character } from "./character";
import { IdleController, isIdleAnimation } from "./idle";
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
}

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
export class Agent {
  /** キャラクターの要素 (div.msagent)。この中に canvas がある */
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly player: AcsPlayer;
  private readonly balloon: Balloon;
  private readonly speaker: Speaker;
  private readonly idle: IdleController | undefined;
  /** speak() で声に出すか */
  voice: boolean;

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
    injectStyles();
    this.element = document.createElement("div");
    this.element.className = "msagent";
    this.element.style.display = "none";
    this.canvas = document.createElement("canvas");
    this.element.append(this.canvas);
    this.player = new AcsPlayer(character, this.canvas);
    this.player.soundEnabled = options.sound ?? true;
    this.voice = options.voice ?? true;
    this.balloon = new Balloon(this.element);
    this.speaker = new Speaker(() => this.player);
    (options.container ?? document.body).append(this.element, this.balloon.element);

    if (options.idle ?? true) {
      this.idle = new IdleController({
        player: () => this.player,
        character: () => this.character,
        busy: () => this.hidden || this.running || this.speaker.speaking || this.hold || this.player.isPaused,
      });
      this.player.onPlayingChange = (playing) => {
        if (!playing) this.idle?.animationEnded();
      };
      this.idle.start();
    }

    this.setupDrag();
    this.listen(this.element, "dblclick", () => this.animate());
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
      callback?.();
    };
    const name = findAnimation(this.character, "Hide");
    if (fast || !name) return finish();
    void this.player.play(name).then(finish);
  }

  /**
   * アニメーションを再生する。timeout (ms、既定 5000。0 なら無制限) を過ぎても終わらなければ、終了分岐で自然に終わらせる。
   * 終わったら callback。キャラクターに無いアニメーションなら false
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
      void this.player.play(name).then(() => {
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
    this.addToQueue((complete) => {
      window.clearTimeout(this.balloonTimer);
      this.hold = !!hold;
      this.speechComplete = complete;
      this.balloon.setText("");
      this.balloon.show();
      this.speaker.speak(
        text,
        {
          onProgress: (shown) => this.balloon.setText(shown),
          onEnd: () => {
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

  /** (x, y) へ移動する (Move〜 のアニメーションがあれば、それを再生しながら)。duration が 0 なら、すぐ移る */
  moveTo(x: number, y: number, duration = 1000): void {
    this.addToQueue(async (complete) => {
      if (duration === 0) {
        this.setPosition(x, y);
        return complete();
      }
      const name = findAnimation(this.character, `Move${this.direction(x, y)}`);
      const playing = name ? this.player.play(name) : undefined;
      await this.slide(x, y, duration);
      if (playing) {
        void this.player.release();
        await playing;
      }
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

  get name(): string | undefined {
    return this.character.name;
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

  /** ドラッグで動かす (透明な部分をつかんだときは動かさない) */
  private setupDrag() {
    let offset: { x: number; y: number } | undefined;
    this.listen(this.element, "pointerdown", (e) => {
      const ev = e as PointerEvent;
      if (ev.button !== 0 || !this.hitTest(ev.clientX, ev.clientY)) return;
      const r = this.element.getBoundingClientRect();
      offset = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      this.element.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    this.listen(this.element, "pointermove", (e) => {
      const ev = e as PointerEvent;
      if (offset) this.setPosition(ev.clientX - offset.x, ev.clientY - offset.y);
    });
    const end = () => (offset = undefined);
    this.listen(this.element, "pointerup", end);
    this.listen(this.element, "pointercancel", end);
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void, capture = false) {
    target.addEventListener(type, handler, capture);
    this.cleanups.push(() => target.removeEventListener(type, handler, capture));
  }
}
