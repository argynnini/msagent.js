import type { AcsImage, Animation } from "./acs/reader";
import type { Language } from "./language";

/** キャラクターファイルに入っている、読み上げの声の設定 (Microsoft Agent の音声合成 = SAPI 4 の値)。無い項目は undefined */
export interface VoiceSettings {
  /** 速さ (1 分あたりの単語数) */
  speed?: number;
  /** 高さ (Hz) */
  pitch?: number;
  /** 言語 (BCP 47。例: "en-US") と、その Windows の言語 ID (例: 0x0409) */
  language?: string;
  languageId?: number;
  /** 方言 (空なら undefined) */
  dialect?: string;
  gender?: "neutral" | "female" | "male";
  /** 年齢 */
  age?: number;
  /** 話し方 (例: "Business") */
  style?: string;
  /** 音声合成エンジンと、その声の GUID (例: L&H TruVoice) */
  engine?: string;
  mode?: string;
}

/** キャラクターファイルに入っている、吹き出しの見た目 (Microsoft Agent の Character Editor で決めたもの) */
export interface BalloonStyle {
  /** 行数 */
  lines: number;
  /** 1 行の文字数 */
  charsPerLine: number;
  /** 文字・背景・縁の色 (CSS の色。例: "#ffffe1") */
  foreground: string;
  background: string;
  border: string;
  fontFamily: string;
  /** 文字の大きさ (px) */
  fontSize: number;
  /** 文字の太さ (400: 標準, 700: 太字) */
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** 吹き出しを使うか (false なら speak は声だけ、think は何も出さない) */
  enabled: boolean;
  /** 高さを文の量に合わせるか。false なら lines 行の高さに固定し、はみ出した分は上へ流す */
  sizeToText: boolean;
  /** しゃべり終えたら自動で閉じるか。false なら次の speak / think、hide、キャラクターのクリック・ドラッグまで出したまま */
  autoHide: boolean;
  /** 読み上げに合わせて、言葉を少しずつ出すか。false なら最初から全文を出す */
  autoPace: boolean;
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
  underline: false,
  strikethrough: false,
  enabled: true,
  sizeToText: true,
  autoHide: true,
  autoPace: true,
};

/**
 * プレイヤー・待機動作・しゃべる機能が使う、キャラクターの共通の形。
 * ACS (Microsoft Agent) と ACT (Office 97 のアシスタント) の読み込み結果は、どちらもこの形で扱う
 */
export interface Character {
  readonly width: number;
  readonly height: number;
  /** 名前 (ブラウザの言語に一番合うもの。getName() で言語を選べる) */
  readonly name: string | undefined;
  /** 紹介文 (ブラウザの言語に一番合うもの。getDescription() で言語を選べる) */
  readonly description: string | undefined;
  /** 名前・紹介文が入っている言語 (BCP 47。例: ["en", "ja-JP"])。言語ごとに入っていなければ空 */
  readonly languages: readonly string[];
  /** 指定した言語の名前 (無ければ近い言語。省略時はブラウザの言語) */
  getName(language?: Language | readonly Language[]): string | undefined;
  /** 指定した言語の紹介文 (無ければ近い言語。省略時はブラウザの言語) */
  getDescription(language?: Language | readonly Language[]): string | undefined;
  /** 作者が入れたおまけの文字 (本家の ExtraData。言語ごと。無ければ undefined) */
  getExtraData(language?: Language | readonly Language[]): string | undefined;
  /** キャラクターファイルの版 (本家の Version。例: "2.1"。無ければ undefined) */
  readonly version: string | undefined;
  /** 吹き出しの見た目 (入っていなければ undefined) */
  readonly balloon: BalloonStyle | undefined;
  readonly animations: Map<string, Animation>;
  /** タスクトレイ用の小さなアイコン (無ければ undefined) */
  readonly trayIcon: AcsImage | undefined;
  /** 読み上げの声の設定 (無い項目は undefined) */
  readonly voice: VoiceSettings;
  /** キャラクターの GUID (例: "{4E574F44-B521-11D0-9E9A-00C04FD7081F}")。無ければ undefined */
  readonly guid: string | undefined;
  readonly imageCount: number;
  /** 状態 (例: "IdlingLevel1"、大文字小文字は問わない) に割り当てられたアニメーション名。無ければ空 */
  stateAnimations(state: string): string[];
  getImage(index: number): AcsImage;
  /** 効果音 (WAV) の生データ。存在しなければ undefined */
  getSound(index: number): Uint8Array | undefined;
}
