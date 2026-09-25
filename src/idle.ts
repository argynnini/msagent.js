import type { AcsPlayer } from "./acs/player";
import type { Character } from "./character";

/** 待機中 (放置中) に再生する動きの名前。Merlin: Idle1_1 など / クリッピー: IdleSnooze など / イルカ: Idle(3), DeepIdle1 */
const IDLE_NAME = /^(Idle|DeepIdle)/i;

const FIRST_IDLE_MIN_MS = 4_000;
const FIRST_IDLE_SPAN_MS = 4_000;
/** 放置がこの時間ごとに、より深い (大きな) 待機動作が出るようになる。3 段階なので放置 30 秒で最深に達する */
const ESCALATE_MS = 15_000;
const MAX_LEVEL = 3;
/** 浅い待機動作がだらだら続かないよう、この時間で終わらせる (居眠りなど最深の動きは触られるまで続ける) */
const MAX_SHALLOW_IDLE_MS = 25_000;
/** ユーザー操作で待機動作を止めるとき、終了分岐を待つ上限 */
const INTERRUPT_WAIT_MS = 1_500;

export const isIdleName = (name: string | undefined): boolean => name !== undefined && IDLE_NAME.test(name);

/** 状態の一覧 (IdlingLevel1〜3) に割り当てられた待機動作。無いキャラクターは空 */
function idleStates(character: Character): string[][] {
  return [1, 2, 3].map((level) => character.stateAnimations(`IdlingLevel${level}`));
}

/**
 * 待機動作かどうか。状態の一覧に割り当てられているもの (Blink や Sleep など、名前が Idle で始まらないものも含む) と、
 * 名前が Idle / DeepIdle で始まるもの
 */
export function isIdleAnimation(character: Character | undefined, name: string | undefined): boolean {
  if (name === undefined) return false;
  return isIdleName(name) || (!!character && idleStates(character).some((names) => names.includes(name)));
}

/** 待機動作の「深さ」。Idle1_x < Idle2_x < Idle3_x、居眠りや DeepIdle は最深 */
export function idleLevel(name: string): number {
  const m = /^Idle(\d)_/i.exec(name);
  if (m) return Math.min(Number(m[1]), MAX_LEVEL);
  if (/^DeepIdle|Snooze|Sleep/i.test(name)) return MAX_LEVEL;
  return 1;
}

/** maxLevel 以下の待機動作から 1 つ選ぶ。深い段階ほど選ばれやすい (重み = 段階の 2 乗)。直前と同じものは、他に候補があれば避ける */
export function pickIdle(names: Iterable<string>, maxLevel: number, last?: string, random = Math.random): string | undefined {
  const pool = [...names].filter((n) => IDLE_NAME.test(n) && idleLevel(n) <= maxLevel);
  const fresh = pool.filter((n) => n !== last);
  const src = fresh.length > 0 ? fresh : pool;
  const weights = src.map((n) => idleLevel(n) ** 2);
  let roll = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < src.length; i++) {
    roll -= weights[i]!;
    if (roll < 0) return src[i];
  }
  return src[src.length - 1];
}

/**
 * 放置の段階 (1〜3) に合う待機動作を選ぶ。キャラクターに状態の一覧 (IdlingLevel1〜3) があれば、作者の割り当てに従い
 * (その段階が無ければ、より浅い段階から)、無ければ名前から推測する (pickIdle)。選んだ動作と、その段階を返す
 */
export function pickIdleFor(
  character: Character,
  maxLevel: number,
  last?: string,
  random = Math.random,
): { name: string; level: number } | undefined {
  const byLevel = idleStates(character);
  if (byLevel.some((names) => names.length > 0)) {
    for (let level = maxLevel; level >= 1; level--) {
      const pool = byLevel[level - 1] ?? [];
      if (pool.length === 0) continue;
      const fresh = pool.filter((n) => n !== last);
      const src = fresh.length > 0 ? fresh : pool;
      return { name: src[Math.floor(random() * src.length)]!, level };
    }
  }
  const name = pickIdle(character.animations.keys(), maxLevel, last, random);
  return name === undefined ? undefined : { name, level: idleLevel(name) };
}

export interface IdleDeps {
  player: () => AcsPlayer | undefined;
  character: () => Character | undefined;
  /** 入力中・検索中など、待機動作を始めてはいけない状態 */
  busy: () => boolean;
}

/**
 * 何も操作されない間、ときどき待機動作 (Idle 系) を再生する。
 * 放置が長いほど深い段階の動きが出る。ユーザーが触ったら終了分岐で自然に終わらせる。
 */
export class IdleController {
  private lastActivity = Date.now();
  private nextAt = 0;
  private idlePlaying = false;
  private lastName: string | undefined;
  private playId = 0;
  private interval: number | undefined;

  constructor(private readonly deps: IdleDeps) {
    this.reschedule();
  }

  start() {
    this.stop();
    this.interval = window.setInterval(() => this.tick(), 1000);
  }

  /** 待機動作の見張りをやめる (再生中の待機動作は止めない) */
  stop() {
    window.clearInterval(this.interval);
    this.interval = undefined;
  }

  /** ユーザー操作があった: 放置時間をリセットして、次の待機動作を先送りする */
  userActivity() {
    this.lastActivity = Date.now();
    this.reschedule();
  }

  /** 何かのアニメーションが終わった: 少し間を置いてから次の待機動作 */
  animationEnded() {
    this.reschedule();
  }

  /**
   * 待機動作をいま実際に再生中か。別のアニメーションの play() や stop() で止められると、
   * 待機動作の play() の Promise は解決しないので、idlePlaying だけでなくプレイヤーの状態も確かめる
   */
  private get idleActive(): boolean {
    return this.idlePlaying && this.deps.player()?.requestedAnimation === this.lastName;
  }

  /** 再生中の待機動作を終了分岐で終わらせる (長引くときは打ち切る)。待機動作中でなければ即 resolve */
  async interrupt(): Promise<void> {
    const player = this.deps.player();
    if (!this.idleActive || !player) return;
    await Promise.race([player.release(), new Promise((r) => window.setTimeout(r, INTERRUPT_WAIT_MS))]);
    // 待っている間に別のアニメーションが始まっていたら、それは止めない
    if (this.idleActive) player.stop();
  }

  private reschedule() {
    this.nextAt = Date.now() + FIRST_IDLE_MIN_MS + Math.random() * FIRST_IDLE_SPAN_MS;
  }

  private tick() {
    const player = this.deps.player();
    const character = this.deps.character();
    const now = Date.now();
    if (!player || !character || document.hidden) return;
    // 待機動作が別の再生で止められていたら、終わったものとして次を予約し直す
    if (this.idlePlaying && !this.idleActive) {
      this.idlePlaying = false;
      this.reschedule();
    }
    if (this.idlePlaying || player.isPlaying || this.deps.busy() || now < this.nextAt) return;

    const level = Math.min(MAX_LEVEL, 1 + Math.floor((now - this.lastActivity) / ESCALATE_MS));
    const picked = pickIdleFor(character, level, this.lastName);
    if (!picked) {
      this.reschedule();
      return;
    }
    const { name } = picked;
    this.lastName = name;
    this.idlePlaying = true;
    const id = ++this.playId;
    if (picked.level < MAX_LEVEL) {
      window.setTimeout(() => {
        if (this.idlePlaying && this.playId === id) void this.interrupt();
      }, MAX_SHALLOW_IDLE_MS);
    }
    void player.play(name).then(() => {
      this.idlePlaying = false;
      this.reschedule();
    });
  }
}
