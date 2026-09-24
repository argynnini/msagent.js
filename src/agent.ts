import { AcsPlayer } from "./acs/player";
import { AcsCharacter } from "./acs/reader";
import { ActCharacter, isActFile } from "./act/reader";
import type { Character } from "./character";
import { IdleController } from "./idle";
import { Speaker, voiceParams } from "./speak";

/** キャラクターファイルの中身。URL (文字列 / URL) なら fetch で取ってくる */
export type CharacterSource = ArrayBuffer | ArrayBufferView | Blob | string | URL;

export interface AgentOptions {
  /** 描く canvas。省略すると新しく作る (agent.canvas をページに置いて使う) */
  canvas?: HTMLCanvasElement;
  /** 効果音を鳴らすか (既定: true)。ブラウザの制限で、ページが一度クリックされるまでは鳴らない */
  sound?: boolean;
  /** 何も再生していない間、ときどき待機動作 (Idle 系) を再生するか (既定: true) */
  idle?: boolean;
}

export interface SpeakOptions {
  /** 読み上げ済みの部分 (最後は全文)。吹き出しに出すのに使う */
  onProgress?: (shown: string) => void;
}

/**
 * ACS (Microsoft Agent) か ACT (Office 97 のアシスタント) を、中身から見分けて読み込む
 */
export function parseCharacter(data: ArrayBuffer): Character {
  return isActFile(data) ? new ActCharacter(data) : new AcsCharacter(data);
}

async function toArrayBuffer(source: CharacterSource): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) {
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  }
  if (source instanceof Blob) return source.arrayBuffer();
  const res = await fetch(source);
  if (!res.ok) throw new Error(`キャラクターファイルを取得できません: ${res.status} ${res.url}`);
  return res.arrayBuffer();
}

/** 大文字小文字を問わず、実在するアニメーション名に直す (無ければ undefined) */
function findAnimation(character: Character, name: string): string | undefined {
  if (character.animations.has(name)) return name;
  const lower = name.toLowerCase();
  for (const key of character.animations.keys()) if (key.toLowerCase() === lower) return key;
  return undefined;
}

/**
 * キャラクター 1 体。読み込み・再生・しゃべる・待機動作をまとめて扱う。
 *
 * ```ts
 * const agent = await Agent.load("Merlin.acs");
 * document.body.append(agent.canvas);
 * await agent.show();
 * await agent.speak("こんにちは");
 * ```
 */
export class Agent {
  readonly player: AcsPlayer;
  private readonly speaker: Speaker;
  private readonly idle: IdleController | undefined;
  private readonly unlock = () => this.player.unlockAudio();
  private destroyed = false;

  constructor(
    readonly character: Character,
    readonly canvas: HTMLCanvasElement = document.createElement("canvas"),
    options: Omit<AgentOptions, "canvas"> = {},
  ) {
    this.player = new AcsPlayer(character, canvas);
    this.player.soundEnabled = options.sound ?? true;
    this.speaker = new Speaker(() => this.player);
    if (options.idle ?? true) {
      this.idle = new IdleController({
        player: () => this.player,
        character: () => this.character,
        busy: () => this.speaker.speaking,
      });
      this.player.onPlayingChange = (playing) => {
        if (!playing) this.idle?.animationEnded();
      };
      this.idle.start();
    }
    // 最初の操作で音を鳴らせるようにしておく (自動再生の制限)
    for (const type of ["pointerdown", "keydown"] as const) window.addEventListener(type, this.unlock, { capture: true });
  }

  /** ファイル・URL・バイト列から読み込む */
  static async load(source: CharacterSource, options: AgentOptions = {}): Promise<Agent> {
    const character = parseCharacter(await toArrayBuffer(source));
    return new Agent(character, options.canvas, options);
  }

  get name(): string | undefined {
    return this.character.name;
  }

  /** アニメーション名の一覧 */
  get animations(): string[] {
    return [...this.character.animations.keys()];
  }

  /** 再生中のアニメーション名 */
  get currentAnimation(): string | undefined {
    return this.player.currentAnimation;
  }

  get sound(): boolean {
    return this.player.soundEnabled;
  }

  set sound(on: boolean) {
    this.player.soundEnabled = on;
  }

  hasAnimation(name: string): boolean {
    return findAnimation(this.character, name) !== undefined;
  }

  /**
   * アニメーションを再生する (大文字小文字は問わない)。戻りアニメまで終わるか、別の再生・stop() で resolve。
   * 無い名前なら false で resolve
   */
  async play(name: string): Promise<boolean> {
    const found = findAnimation(this.character, name);
    if (!found) return false;
    this.idle?.userActivity();
    await this.idle?.interrupt();
    await this.player.play(found);
    return true;
  }

  /** 再生中のアニメーションを、終了分岐をたどって自然に終わらせる */
  release(): Promise<void> {
    return this.player.release();
  }

  /** 再生をすぐ止める */
  stop() {
    this.player.stop();
  }

  /** 登場する (Greeting、無ければ Show を再生) */
  async show(): Promise<void> {
    await this.playFirst(["Greeting", ...this.character.stateAnimations("Showing"), "Show"]);
  }

  /** 退場する (Hide があれば再生し、最後に絵を消す) */
  async hide(): Promise<void> {
    await this.playFirst([...this.character.stateAnimations("Hiding"), "Hide"]);
    this.player.stop();
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** 候補のうち、キャラクターにある最初のアニメーションを再生する */
  private async playFirst(names: string[]): Promise<void> {
    const name = names.find((n) => this.hasAnimation(n));
    if (name) await this.play(name);
  }

  /**
   * 文を読み上げ (Web Speech API)、その間は口を動かす。読み上げが終わるか cancelSpeech() で resolve。
   * 音声合成が使えない環境では、声なしで口だけ動かす
   */
  speak(text: string, options: SpeakOptions = {}): Promise<void> {
    this.idle?.userActivity();
    void this.idle?.interrupt();
    return new Promise((resolve) => {
      this.speaker.speak(
        text,
        { onProgress: (shown) => options.onProgress?.(shown), onEnd: resolve },
        voiceParams(this.character.voice),
      );
    });
  }

  get speaking(): boolean {
    return this.speaker.speaking;
  }

  cancelSpeech() {
    this.speaker.cancel();
  }

  /**
   * 画面上の位置 (マウスイベントの clientX / clientY) に、キャラクターの絵があるか。
   * 透明な部分のクリックを無視するのに使う
   */
  hitTest(clientX: number, clientY: number): boolean {
    return this.player.hitTest(clientX, clientY);
  }

  /** ユーザーが操作した (待機動作を先送りし、再生中の待機動作を終わらせる) */
  userActivity() {
    this.idle?.userActivity();
    void this.idle?.interrupt();
  }

  /** 後片付け: 再生・読み上げ・待機動作・イベントの登録をやめる */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.idle?.stop();
    this.speaker.cancel();
    this.player.stop();
    this.player.onPlayingChange = undefined;
    for (const type of ["pointerdown", "keydown"] as const) window.removeEventListener(type, this.unlock, { capture: true });
  }
}
