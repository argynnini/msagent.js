/**
 * 全キャラクターの音の設定と状態 (本家の AudioOutput オブジェクト)
 */

/**
 * Audio channel status, with the same values as Microsoft Agent's `AudioOutput.Status`:
 * `0` available, `1` this browser cannot play audio, `3` listening and hearing speech,
 * `4` a character is speaking aloud, `5` listening and waiting for speech.
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
 * Audio settings and status shared by all characters. Same as Microsoft Agent's `AudioOutput`, except that the
 * settings can be changed here (in Microsoft Agent they are user settings and read-only).
 *
 * ```js
 * msagent.audioOutput.enabled = false;      // no speech from any character (balloons and mouths only)
 * msagent.audioOutput.soundEffects = false; // no sound effects from any character
 * if (msagent.audioOutput.status === 0) agent.speak("..."); // nobody is speaking or listening
 * ```
 */
export const audioOutput = {
  /** If `false`, no character speaks aloud, even with `speak(text, { voice: true })`. Same as `AudioOutput.Enabled`. */
  enabled: true,
  /** If `false`, no character plays sound effects. Same as `AudioOutput.SoundEffects`. */
  soundEffects: true,
  /** Current audio channel status. Same as `AudioOutput.Status`. */
  get status(): AudioStatus {
    const all = [...clients];
    if (all.some((c) => c.hearing)) return 3;
    if (all.some((c) => c.speakingAloud)) return 4;
    if (all.some((c) => c.listening)) return 5;
    const canPlay = typeof AudioContext !== "undefined" || typeof speechSynthesis !== "undefined";
    return canPlay ? 0 : 1;
  },
};
