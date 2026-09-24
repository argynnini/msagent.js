import type { AcsImage, Animation } from "./acs/reader";

/**
 * プレイヤー・待機動作・しゃべる機能が使う、キャラクターの共通の形。
 * ACS (Microsoft Agent) と ACT (Office 97 のアシスタント) の読み込み結果は、どちらもこの形で扱う
 */
export interface Character {
  readonly width: number;
  readonly height: number;
  readonly name: string | undefined;
  readonly description: string | undefined;
  readonly animations: Map<string, Animation>;
  /** タスクトレイ用の小さなアイコン (無ければ undefined) */
  readonly trayIcon: AcsImage | undefined;
  /** 読み上げの声の設定 (無い項目は undefined) */
  readonly voice: { speed?: number; pitch?: number };
  readonly imageCount: number;
  /** 状態 (例: "IdlingLevel1"、大文字小文字は問わない) に割り当てられたアニメーション名。無ければ空 */
  stateAnimations(state: string): string[];
  getImage(index: number): AcsImage;
  /** 効果音 (WAV) の生データ。存在しなければ undefined */
  getSound(index: number): Uint8Array | undefined;
}
