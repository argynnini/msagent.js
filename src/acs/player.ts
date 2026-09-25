import { audioOutput } from "../audio";
import { decodeWav } from "./wav";
import type { Character } from "../character";
import type { Animation, Frame } from "./reader";
import { restFrame } from "../animations";

/**
 * 描画の色空間。ACS の色は、Windows (GDI) では、色の変換なしで、そのまま画面に出る (本家 = VSTO 版の見た目)。
 * ブラウザは、既定の sRGB のままだと、ワイドガモットのディスプレイの色空間へ変換して、鮮やかさが落ちる
 * (例: 青 (0,153,255) の赤成分が 0 → 約 70 になり、くすんで見える)。
 * display-p3 として描くと、そのディスプレイでは、本家とほぼ同じ数値になる。非対応の環境では sRGB のまま。
 */
let colorSpace: PredefinedColorSpace | undefined;
/** 読み込んだだけで document に触らないよう (SSR など)、最初に使うときに調べる */
function getColorSpace(): PredefinedColorSpace {
  if (colorSpace) return colorSpace;
  try {
    const ctx = document.createElement("canvas").getContext("2d", { colorSpace: "display-p3" });
    colorSpace = ctx?.getContextAttributes().colorSpace === "display-p3" ? "display-p3" : "srgb";
  } catch {
    colorSpace = "srgb";
  }
  return colorSpace;
}

/** ACS キャラクターのアニメーションを canvas に再生する */
export class AcsPlayer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new Map<number, HTMLCanvasElement>();
  /** 効果音を鳴らすか (ブラウザの自動再生制限のため、ユーザー操作後に有効) */
  soundEnabled = true;
  private audioCtx: AudioContext | undefined;
  private readonly buffers = new Map<number, AudioBuffer | null>();
  /** 鳴っている効果音 (アニメーションを止めたら止める) */
  private readonly sounds = new Set<AudioBufferSourceNode>();
  private timer: number | undefined;
  /** 次のフレームへ進む処理 (pause() 中は、resume() まで取っておく) */
  private pendingStep: (() => void) | undefined;
  private paused = false;
  /** 再生中の playFrames() を終わらせる (stop() や別の再生で止められても、play() の Promise が解決するように) */
  private settle: (() => void) | undefined;
  /** play(name, { hold: true }) で最後のコマのまま止めたアニメーション (playReturn() で戻りの動きを再生する) */
  private held: { name: string; anim: Animation; frame: number } | undefined;
  /** 再生要求ごとに増やし、古い再生ループを無効化する */
  private token = 0;
  /** release() が呼ばれた: 分岐で繰り返さず、終了分岐をたどって終わらせる */
  private releasing = false;
  private active = false;
  private current: string | undefined;
  /** play() で頼まれたアニメーションの名前 (その前の戻りの動きの間も同じ) */
  private requested: string | undefined;
  /** 再生中かどうかが変わったときに呼ばれる (UI のアイコン切り替え用) */
  onPlayingChange: ((playing: boolean) => void) | undefined;
  /**
   * 描いているアニメーションが変わったときに呼ばれる (current: 新しい名前、previous: 前の名前。止まれば undefined)。
   * 戻りアニメ (MoveRightReturn など) を再生している間は、その名前になる
   */
  onAnimationChange: ((current: string | undefined, previous: string | undefined) => void) | undefined;
  /** 現在の play() 全体 (戻りアニメ含む) の完了 Promise */
  private running: Promise<void> | undefined;
  /** 口の形 (0: 閉じる, 1〜4: 大きく開く, 5: 中くらい, 6: すぼめる)。undefined なら口の画像を重ねない */
  private mouth: number | undefined;
  /** 最後に描いたフレーム (口の形を変えたときに描き直す) */
  private lastFrame: Frame | undefined;

  constructor(
    private readonly character: Character,
    private readonly canvas: HTMLCanvasElement,
  ) {
    canvas.width = character.width;
    canvas.height = character.height;
    // 当たり判定 (hitTest) で画素を読み出すので、読み出し向けにしておく (キャラクターは小さいので描画の速さは気にならない)
    const ctx = canvas.getContext("2d", { colorSpace: getColorSpace(), willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d を取得できません");
    // 画像を拡大・縮小して描くとき (ACT の合成コマ) も、ドット絵をぼかさない
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  /** 再生中のアニメーション名 (再生中でなければ undefined) */
  get currentAnimation(): string | undefined {
    return this.current;
  }

  /**
   * play() で頼まれたアニメーションの名前 (再生中でなければ undefined)。
   * currentAnimation と違い、前のアニメーションの戻りの動きを再生している間も、頼まれた名前を返す
   */
  get requestedAnimation(): string | undefined {
    return this.requested;
  }

  /** アニメーション再生中か (stop() や再生完了で false) */
  get isPlaying(): boolean {
    return this.active;
  }

  /** 描いているアニメーションの名前を変え、変わったら onAnimationChange で知らせる */
  private setCurrent(name: string | undefined) {
    if (this.current === name) return;
    const previous = this.current;
    this.current = name;
    this.onAnimationChange?.(name, previous);
  }

  private setActive(v: boolean) {
    if (this.active === v) return;
    this.active = v;
    this.onPlayingChange?.(v);
  }

  /**
   * 再生をやめる (いまのコマのまま止まる)。鳴っている効果音も止める
   * (待機動作の途中で hide したときなどに、前のアニメーションの音が残らないように)。keepSounds なら、音は最後まで鳴らす
   */
  stop(options: { keepSounds?: boolean } = {}) {
    if (!options.keepSounds) this.stopSounds();
    this.requested = undefined;
    this.setCurrent(undefined);
    this.setActive(false);
    this.token++;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingStep = undefined;
    this.held = undefined;
    const settle = this.settle;
    this.settle = undefined;
    settle?.();
  }

  /** 再生を一時停止する (いまのフレームのまま止まる) */
  pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** 一時停止をやめて、次のフレームから続ける */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    const step = this.pendingStep;
    this.pendingStep = undefined;
    step?.();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private schedule(step: () => void, ms: number) {
    this.pendingStep = step;
    if (this.paused) return;
    this.timer = window.setTimeout(() => {
      this.pendingStep = undefined;
      step();
    }, ms);
  }

  /**
   * アニメーションを再生する。終了 (戻りアニメ含む) か、別の再生・stop() で resolve。
   * hold なら、戻りの動きをせずに最後のコマのまま止める (Microsoft Agent と同じく、指す動きなどは次の再生まで姿勢を保つ)。
   * 止めているアニメーションがあれば、先にその戻りの動きを再生してから始める
   */
  play(name: string, options: { hold?: boolean } = {}): Promise<void> {
    const held = this.held;
    this.stop();
    this.releasing = false;
    this.requested = name;
    this.setActive(true);
    const token = this.token;
    const run = async () => {
      if (held) {
        await this.returnFrom(held, token);
        if (token !== this.token) return;
      }
      this.setCurrent(name);
      let current: Animation | undefined = this.character.animations.get(name);
      // 戻りアニメの連鎖は念のため上限を設ける
      for (let depth = 0; current && depth < 4; depth++) {
        const last = await this.playFrames(current, token);
        if (token !== this.token) return;
        if (options.hold) {
          if (current.transitionType !== 2) this.held = { name: this.current ?? name, anim: current, frame: last };
          break;
        }
        if (current.transitionType !== 0 || !current.returnAnimation) break;
        // 戻りアニメも、その名前のアニメーションとして知らせる
        this.setCurrent(current.returnAnimation);
        current = this.character.animations.get(current.returnAnimation);
      }
      if (token === this.token) {
        this.requested = undefined;
        this.setCurrent(undefined);
        this.setActive(false);
      }
    };
    return (this.running = run());
  }

  /**
   * 再生中のアニメーションを自然に終わらせる。分岐による繰り返しをやめ、
   * 各フレームの終了分岐 (exit) をたどって「やめる動き」を最後まで再生する。
   * 再生中でなければすぐ resolve。stop() のように途中で切らない。
   */
  release(): Promise<void> {
    this.releasing = true;
    return this.running ?? Promise.resolve();
  }

  /** いま出しているコマに口の画像があるか (無ければ、しゃべっても口が動かない) */
  get hasMouth(): boolean {
    return (this.lastFrame?.overlays.length ?? 0) > 0;
  }

  /** hold で止めているアニメーションがあるか (次の再生の前に、戻りの動きが入る) */
  get isHolding(): boolean {
    return this.held !== undefined;
  }

  /** hold で止めたアニメーションの、戻りの動きだけを再生する。止めていなければ、すぐ resolve */
  playReturn(): Promise<void> {
    const held = this.held;
    if (!held) return Promise.resolve();
    this.stop();
    this.requested = held.name;
    this.setActive(true);
    const token = this.token;
    const run = async () => {
      await this.returnFrom(held, token);
      if (token === this.token) {
        this.requested = undefined;
        this.setCurrent(undefined);
        this.setActive(false);
      }
    };
    return (this.running = run());
  }

  /**
   * 止めたアニメーションの戻りの動き: 戻りアニメを使うもの (transitionType 0) はそれを、
   * 終了分岐を使うもの (1) は、止めたコマから終了分岐をたどる
   */
  private async returnFrom(held: { name: string; anim: Animation; frame: number }, token: number) {
    const { anim, frame } = held;
    if (anim.transitionType === 0) {
      // 別の戻りアニメ (MoveRightReturn など): その名前のアニメーションとして知らせる
      const ret = anim.returnAnimation ? this.character.animations.get(anim.returnAnimation) : undefined;
      if (!ret) return;
      this.setCurrent(anim.returnAnimation);
      await this.playFrames(ret, token);
    } else if (anim.transitionType === 1) {
      // 同じアニメーションの終了分岐で戻る: 名前はそのアニメーションのまま
      const start = anim.frames[frame]?.exitFrame ?? -1;
      if (start < 0) return;
      this.setCurrent(held.name);
      this.releasing = true;
      await this.playFrames(anim, token, start);
      if (token === this.token) this.releasing = false;
    }
  }

  /** start のコマから再生する。最後に描いたコマの番号 (描かなければ -1) で resolve */
  private playFrames(anim: Animation, token: number, start = 0): Promise<number> {
    return new Promise<number>((done) => {
      let last = -1;
      const resolve = () => {
        if (this.settle === resolve) this.settle = undefined;
        done(last);
      };
      this.settle = resolve;
      let releasedSteps = 0;
      const step = (index: number) => {
        if (token !== this.token) return resolve();
        const frame = anim.frames[index];
        if (!frame) return resolve();
        // 終了分岐が循環しても終わるように上限を設ける
        if (this.releasing && ++releasedSteps > anim.frames.length * 3) return resolve();
        // 画像なし・0 秒のフレームは、描かずにすぐ次へ (ACT の分岐・効果音の命令。描くと一瞬消えてちらつく)
        const timed = frame.images.length > 0 || frame.duration > 0;
        const next = this.nextIndex(frame, index);
        // 未使用の画像 (0x0) だけのコマは、描くと消えてしまうので描かない。途中なら前の絵のまま待ち、
        // アニメーションの最後なら止まっているときの絵にする (例: フィンフィンの MoveLeftReturn の最後。
        // 前の絵のままだと、着地の途中の姿勢で止まって見える)
        if (timed && !this.onlyPlaceholders(frame)) {
          this.draw(frame);
          last = index;
        } else if (timed && !anim.frames[next]) {
          const rest = restFrame(this.character);
          if (rest && !this.onlyPlaceholders(rest)) this.draw(rest);
        }
        if (frame.soundIndex >= 0) void this.playSound(frame.soundIndex, token);
        this.schedule(() => step(next), timed ? Math.max(frame.duration, 10) : 0);
      };
      step(start);
    });
  }

  private onlyPlaceholders(frame: Frame): boolean {
    return frame.images.length > 0 && frame.images.every((fi) => this.sprite(fi.imageIndex).width === 0);
  }

  /** 分岐 (確率は % 相当) があれば抽選し、なければ次のフレーム。release 後は終了分岐を優先 */
  private nextIndex(frame: Frame, index: number): number {
    if (this.releasing) return frame.exitFrame >= 0 ? frame.exitFrame : index + 1;
    let roll = Math.random() * 100;
    for (const b of frame.branches) {
      if (roll < b.probability) return b.frameIndex;
      roll -= b.probability;
    }
    return index + 1;
  }

  /**
   * ブラウザの自動再生制限で、ユーザー操作 (クリック・キー入力) より前は音を鳴らせない。
   * 効果音が鳴るタイミングまで AudioContext の再開を待つと、その分だけ後の操作でも
   * 反映が遅れることがあるので、何か操作があった時点で先に再開しておく (無害な空振りも許容)
   */
  unlockAudio() {
    this.audioCtx ??= new AudioContext();
    if (this.audioCtx.state === "suspended") void this.audioCtx.resume().catch(() => undefined);
  }

  /** 効果音と同じ AudioContext (音声ファイルでしゃべるときにも使う) */
  audioContext(): AudioContext {
    this.audioCtx ??= new AudioContext();
    return this.audioCtx;
  }

  /** 効果音を鳴らす (token: 鳴らしたアニメーション。止められていれば鳴らさない) */
  private async playSound(index: number, token: number) {
    if (!this.soundEnabled || !audioOutput.soundEffects) return;
    this.audioCtx ??= new AudioContext();
    const ctx = this.audioCtx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    if (token !== this.token) return;
    let decoded = this.buffers.get(index);
    if (decoded === undefined) {
      const wav = this.character.getSound(index);
      const pcm = wav && decodeWav(wav);
      if (pcm) {
        decoded = ctx.createBuffer(1, pcm.samples.length, pcm.sampleRate);
        decoded.copyToChannel(pcm.samples, 0);
      }
      this.buffers.set(index, decoded ?? null);
    }
    if (!decoded) return;
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ctx.destination);
    // アニメーションを止めたら音も止めるので、鳴っている間は覚えておく
    this.sounds.add(src);
    src.onended = () => this.sounds.delete(src);
    src.start();
  }

  /** 鳴っている効果音を止める */
  private stopSounds() {
    for (const src of this.sounds) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // もう止まっている
      }
    }
    this.sounds.clear();
  }

  private sprite(index: number): HTMLCanvasElement {
    let c = this.sprites.get(index);
    if (c) return c;
    const img = this.character.getImage(index);
    c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    // 未使用のプレースホルダー (0x0) は、そのまま空の canvas にしておく (putImageData は 0 サイズだと例外になる)
    if (img.width > 0 && img.height > 0) {
      // 画像の数値も、同じ色空間として扱う (sRGB のキャンバスとの間で、変換が入らないようにする)
      const space = getColorSpace();
      c.getContext("2d", { colorSpace: space })!.putImageData(new ImageData(img.rgba, img.width, img.height, { colorSpace: space }), 0, 0);
    }
    this.sprites.set(index, c);
    return c;
  }

  /**
   * 画面上の位置 (マウスイベントの clientX / clientY) に、キャラクターの絵があるか。
   * 透明な部分 (キャラクターの周り) なら false。CSS で拡大・縮小されていても、canvas の画素に直して調べる
   */
  hitTest(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const x = Math.floor(((clientX - rect.left) / rect.width) * this.canvas.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * this.canvas.height);
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return false;
    return this.ctx.getImageData(x, y, 1, 1).data[3]! > 0;
  }

  /**
   * 話している間の口の形を変える (undefined で口の画像を重ねるのをやめる)。
   * 口の画像はフレームごとに入っているので、口の画像が無いフレーム (動きの途中など) では何も変わらない
   */
  setMouth(type: number | undefined) {
    if (this.mouth === type) return;
    this.mouth = type;
    if (this.lastFrame) this.draw(this.lastFrame);
  }

  draw(frame: Frame) {
    this.lastFrame = frame;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const mouth = this.mouth === undefined ? undefined : frame.overlays.find((o) => o.type === this.mouth);
    // 先頭の画像が最前面
    for (let i = frame.images.length - 1; i >= 0; i--) {
      // replace の口の画像は、最前面の画像の代わりに描く (そうでなければ全部の上に重ねる)
      if (i === 0 && mouth?.replace) continue;
      const fi = frame.images[i]!;
      const s = this.sprite(fi.imageIndex);
      if (s.width === 0 || s.height === 0) continue; // 未使用のプレースホルダー画像は描かない
      if (fi.width !== undefined && fi.height !== undefined && (fi.width !== s.width || fi.height !== s.height)) {
        this.ctx.drawImage(s, fi.x, fi.y, fi.width, fi.height);
      } else {
        this.ctx.drawImage(s, fi.x, fi.y);
      }
    }
    if (mouth) {
      const s = this.sprite(mouth.imageIndex);
      if (s.width > 0 && s.height > 0) this.ctx.drawImage(s, mouth.x, mouth.y);
    }
  }
}
