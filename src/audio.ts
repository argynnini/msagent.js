/**
 * 全キャラクターの音の設定と状態 (本家の AudioOutput オブジェクト)
 */

/**
 * 音の出口の状態 (本家の AudioOutput.Status と同じ値)。
 * 0: 空いている / 1: このブラウザは音を出せない / 3: 聞き取り中で、声が聞こえている /
 * 4: キャラクターが声に出してしゃべっている / 5: 聞き取り中で、声を待っている
 */
export type AudioStatus = 0 | 1 | 3 | 4 | 5;

/** 状態を見るために、キャラクターから借りるもの */
export interface AudioClient {
  /** 声に出してしゃべっている (声なしの speak・think は含まない) */
  readonly speakingAloud: boolean;
  /** 聞き取り中か / 声が聞こえているか */
  readonly listening: boolean;
  readonly hearing: boolean;
}

const clients = new Set<AudioClient>();

/** @internal キャラクターを作った・片付けたときに呼ぶ */
export function registerAudioClient(client: AudioClient): () => void {
  clients.add(client);
  return () => clients.delete(client);
}

/**
 * 全キャラクターの音の設定と状態 (本家の AudioOutput と同じ。本家はユーザーの設定なので読むだけだが、ここでは変えられる)。
 *
 * ```js
 * msagent.audioOutput.enabled = false;      // 全キャラクターの声を出さない (吹き出しと口の動きだけ)
 * msagent.audioOutput.soundEffects = false; // 全キャラクターの効果音を鳴らさない
 * if (msagent.audioOutput.status === 0) agent.speak("…"); // 誰もしゃべっていない・聞いていない
 * ```
 */
export const audioOutput = {
  /** false なら、全キャラクターの声を出さない (speak(text, { voice: true }) も。本家の Enabled) */
  enabled: true,
  /** false なら、全キャラクターの効果音を鳴らさない (本家の SoundEffects) */
  soundEffects: true,
  /** 音の出口の状態 (本家の Status) */
  get status(): AudioStatus {
    const all = [...clients];
    if (all.some((c) => c.hearing)) return 3;
    if (all.some((c) => c.speakingAloud)) return 4;
    if (all.some((c) => c.listening)) return 5;
    const canPlay = typeof AudioContext !== "undefined" || typeof speechSynthesis !== "undefined";
    return canPlay ? 0 : 1;
  },
};
