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
  /** 右クリックのメニューで、commands に足した項目が選ばれた (本家の Command と同じ) */
  command: { name: string };
  /** アニメーションが始まった / 終わった (idle: 待機動作か) */
  animationstart: { name: string; idle: boolean };
  animationend: { name: string; idle: boolean };
  /** しゃべり始めた / しゃべり終えた (途中でやめたときも来る)。text は吹き出しに出す文 (タグを除いたもの)。thought: think() か */
  speakstart: { text: string; thought: boolean };
  speakend: { text: string; thought: boolean };
  /** 読み上げの目印 (\Mrk=番号\) まで来た (本家の Bookmark と同じ) */
  bookmark: { id: number };
}

export type AgentEventListener<K extends keyof AgentEventMap> = (event: CustomEvent<AgentEventMap[K]>) => void;

/** イベントを出す関数 (cancelable で preventDefault() されたら false) */
export type Emit = <K extends keyof AgentEventMap>(type: K, detail: AgentEventMap[K], cancelable?: boolean) => boolean;

/** マウスのイベントから、click / dblclick の detail を作る */
export function pointerDetail(e: MouseEvent): PointerDetail {
  const button = e.button === 1 ? "middle" : e.button === 2 ? "right" : "left";
  return { x: e.clientX, y: e.clientY, button, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, originalEvent: e };
}
