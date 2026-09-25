import type { ListenCause, ListenMode } from "./listen";
import type { AgentRequest } from "./request";

/** クリックされたときの、ボタンと Shift / Ctrl / Alt キーの状態 (本家の Click の Button / Shift と同じ) */
export interface PointerDetail {
  /** 画面上の位置 (clientX / clientY) */
  x: number;
  y: number;
  button: "left" | "middle" | "right";
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  originalEvent: MouseEvent;
}

/** 出た・消えた原因 (本家の VisibilityCause と同じ考え方): プログラムから / ユーザーの操作 (右クリックのメニューなど) */
export type VisibilityCause = "program" | "user";

/** 最後に動いた原因 (本家の MoveCause と同じ考え方): まだ動いていない / ドラッグ / プログラム / 画面の中に戻した */
export type MoveCause = "none" | "drag" | "moveTo" | "reposition";

/** 2 番目・3 番目に合ったコマンド (本家の Alt1Name / Alt1Confidence / Alt1Voice など) */
export interface CommandAlternative {
  name: string;
  confidence: number;
  voice: string;
}

/**
 * コマンドが選ばれた (本家の Command イベントの UserInput と同じ考え方)。
 * 右クリックのメニューなら source: "menu"、confidence: 100、voice: ""。
 * 声なら、name は最も合ったコマンド ("" なら、どのコマンドにも合わなかったか、msagent.js が用意したコマンド)
 */
export interface CommandDetail {
  name: string;
  source: "menu" | "voice";
  /** 聞き取った確かさ (0〜100) */
  confidence: number;
  /** 聞き取った文 */
  voice: string;
  /** 合ったコマンドの数 (声で、どれにも合わなければ 0) */
  count: number;
  /** 2 番目・3 番目に合ったもの */
  alternatives: CommandAlternative[];
}

/**
 * ヘルプモードで選ばれたもの (本家の HelpComplete の Cause と同じ考え方)。
 * command: commands の項目 (メニューか声) / hide: 「隠す」 / character: キャラクターをクリック・ドラッグした /
 * openCommandsWindow / closeCommandsWindow: 音声コマンドの窓を開く・閉じる
 */
export type HelpCause = "command" | "hide" | "character" | "openCommandsWindow" | "closeCommandsWindow";

/** 右クリックのメニューで選ばれたもの・キャラクターのヘルプ (helpcomplete) */
export interface HelpDetail {
  /** 選ばれたコマンドの名前 (msagent.js が用意したもの・キャラクターなら "") */
  name: string;
  cause: HelpCause;
  /** 選ばれたコマンド (無ければキャラクター) の helpContextId。ヘルプのどこを出すかに使う */
  helpContextId: number | undefined;
}

/** agent.on() で受け取れるイベントと、その detail */
export interface AgentEventMap {
  /** キャラクターの絵の部分がクリックされた (左・中・右ボタン。ドラッグの後は来ない) */
  click: PointerDetail;
  /** ダブルクリックされた。event.preventDefault() すると、animate() しない */
  dblclick: PointerDetail;
  /** ドラッグで動かし始めた / 動かし終えた (x, y はキャラクターの左上の位置) */
  dragstart: { x: number; y: number };
  dragend: { x: number; y: number };
  /**
   * 別の場所に移った。by: ドラッグ (ユーザー) / moveTo (プログラム) /
   * reposition (ブラウザの窓が小さくなり、画面の中に戻した。本家の「画面の解像度が変わった」と同じ)
   */
  move: { x: number; y: number; by: Exclude<MoveCause, "none"> };
  /** 大きさが変わった (scale / width / height)。width, height は表示の大きさ (px) */
  resize: { width: number; height: number; scale: number };
  /** 出た / 消えた */
  show: { cause: VisibilityCause };
  hide: { cause: VisibilityCause };
  /** 命令 (show / play / speak など) を始めた / 終えた。request.status で結果が分かる */
  requeststart: { request: AgentRequest };
  requestcomplete: { request: AgentRequest };
  /** 吹き出しが出た / 閉じた */
  balloonshow: Record<string, never>;
  balloonhide: Record<string, never>;
  /** 待機状態 (Idling) に入った / 抜けた (次の命令が始まった) */
  idlestart: Record<string, never>;
  idlecomplete: Record<string, never>;
  /** 右クリックのメニューか声で、commands に足した項目が選ばれた (本家の Command と同じ) */
  command: CommandDetail;
  /**
   * ヘルプモード (agent.helpModeOn) で、キャラクター・メニューの項目・声のコマンドが選ばれた (本家の HelpComplete と同じ)。
   * ヘルプモードは終わる。この間は click / dragstart / command は来ない
   */
  helpcomplete: HelpDetail;
  /** 聞き取りを始めた / 終えた (本家の ListenStart / ListenComplete と同じ) */
  listenstart: { mode: ListenMode };
  listencomplete: { cause: ListenCause };
  /** アニメーションが始まった / 終わった (idle: 待機動作か) */
  animationstart: { name: string; idle: boolean };
  animationend: { name: string; idle: boolean };
  /** しゃべり始めた / しゃべり終えた (途中でやめたときも来る)。text は吹き出しに出す文 (タグを除いたもの)。thought: think() か */
  speakstart: { text: string; thought: boolean };
  speakend: { text: string; thought: boolean };
  /** 読み上げの目印 (\Mrk=番号\ か SAPI 5 の <bookmark mark="…"/>) まで来た (本家の Bookmark と同じ)。id は番号 (数字でない SAPI 5 の目印は NaN)、mark は書いてあったとおりの文字 */
  bookmark: { id: number; mark: string };
}

export type AgentEventListener<K extends keyof AgentEventMap> = (event: CustomEvent<AgentEventMap[K]>) => void;

/** イベントを出す関数 (cancelable で preventDefault() されたら false) */
export type Emit = <K extends keyof AgentEventMap>(type: K, detail: AgentEventMap[K], cancelable?: boolean) => boolean;

/** マウスのイベントから、click / dblclick の detail を作る */
export function pointerDetail(e: MouseEvent): PointerDetail {
  const button = e.button === 1 ? "middle" : e.button === 2 ? "right" : "left";
  return { x: e.clientX, y: e.clientY, button, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, originalEvent: e };
}
