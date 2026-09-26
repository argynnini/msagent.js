/**
 * キャラクターと吹き出しの既定の見た目。
 * <head> の先頭に入れるので、ページの CSS で上書きできる
 */
const CSS = `
.msagent, .msagent-balloon { position: fixed; z-index: 1000; }
/* 透明な部分は、下のページをそのまま押せるように。絵の上にあるときだけ .msagent-hit で押せるようにする */
.msagent { pointer-events: none; user-select: none; -webkit-user-select: none; }
.msagent.msagent-hit { pointer-events: auto; cursor: pointer; touch-action: none; }
.msagent canvas { display: block; }
/* スクリーンリーダーだけが読む吹き出しの文 (画面には出さない) */
.msagent-live {
  position: fixed; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
/* ヘルプモード (agent.helpModeOn): キャラクターとメニューの上で、ヘルプのポインターにする */
.msagent.msagent-hit.msagent-help-mode, .msagent-menu.msagent-help-mode, .msagent-menu.msagent-help-mode .msagent-menu-item { cursor: help; }
/*
 * 色・文字・幅は、キャラクターファイルの吹き出しの設定から --msagent-balloon-* に入る (無ければ下の既定値)。
 * ページの CSS で .msagent-balloon の background などを直接指定すれば、そちらが優先される
 */
.msagent-balloon {
  box-sizing: border-box; padding: 8px; border: 1px solid var(--msagent-balloon-border, #000); border-radius: 5px;
  background: var(--msagent-balloon-background, #ffffe1); color: var(--msagent-balloon-foreground, #000);
}
.msagent-content {
  min-width: 120px; max-width: var(--msagent-balloon-width, 200px); white-space: pre-wrap; overflow-wrap: anywhere;
  font-family: var(--msagent-balloon-font, "Microsoft Sans Serif"), "Microsoft Sans Serif", "MS UI Gothic", Tahoma, sans-serif;
  font-size: var(--msagent-balloon-font-size, 13px); font-weight: var(--msagent-balloon-font-weight, 400);
  font-style: var(--msagent-balloon-font-style, normal); line-height: 1.4;
  text-decoration: var(--msagent-balloon-decoration, none);
}
/* 高さを文に合わせない (sizeToText: false): lines 行の高さに固定し、はみ出した分は上へ流す */
.msagent-balloon.msagent-fixed .msagent-content {
  height: calc(var(--msagent-balloon-lines, 2) * 1.4em); overflow: hidden;
}
/* 幅・高さを px で指定したとき (balloonStyle.width / height): 吹き出しの大きさに合わせ、はみ出した分は上へ流す */
.msagent-balloon.msagent-fixed-width .msagent-content { min-width: 0; max-width: none; }
.msagent-balloon.msagent-fixed-height .msagent-content { height: 100%; overflow: hidden; }
.msagent-tip {
  position: absolute; width: 12px; height: 12px; box-sizing: border-box;
  background: inherit; border: inherit; border-radius: 0; transform: rotate(45deg);
}
.msagent-top-left .msagent-tip, .msagent-top-right .msagent-tip {
  top: 100%; margin-top: -6px; border-top-color: transparent; border-left-color: transparent;
}
.msagent-bottom-left .msagent-tip, .msagent-bottom-right .msagent-tip {
  bottom: 100%; margin-bottom: -6px; border-bottom-color: transparent; border-right-color: transparent;
}
.msagent-top-left .msagent-tip, .msagent-bottom-left .msagent-tip { right: 24px; }
/* 考えごとの吹き出し (think): 角を大きく丸め、しっぽの代わりに小さな丸を 2 つ、キャラクターの方へ並べる */
.msagent-balloon.msagent-think { border-radius: 18px; }
.msagent-balloon.msagent-think .msagent-tip {
  width: 11px; height: 11px; border: inherit; border-radius: 50%; transform: none;
}
.msagent-balloon.msagent-think .msagent-tip::after {
  content: ""; position: absolute; width: 6px; height: 6px; box-sizing: border-box;
  background: inherit; border: inherit; border-radius: 50%;
}
.msagent-balloon.msagent-think.msagent-top-left .msagent-tip, .msagent-balloon.msagent-think.msagent-top-right .msagent-tip { margin-top: 3px; }
.msagent-balloon.msagent-think.msagent-bottom-left .msagent-tip, .msagent-balloon.msagent-think.msagent-bottom-right .msagent-tip { margin-bottom: 3px; }
.msagent-think.msagent-top-left .msagent-tip::after, .msagent-think.msagent-top-right .msagent-tip::after { top: 12px; left: 4px; }
.msagent-think.msagent-bottom-left .msagent-tip::after, .msagent-think.msagent-bottom-right .msagent-tip::after { bottom: 12px; left: 4px; }
.msagent-top-right .msagent-tip, .msagent-bottom-right .msagent-tip { left: 24px; }
`;

/* 右クリックのメニュー (showPopupMenu) */
const MENU_CSS = `
.msagent-menu {
  position: fixed; z-index: 1001; min-width: 150px; padding: 4px 0; box-sizing: border-box;
  background: #fff; color: #1b1b1b; border: 1px solid #a0a0a0; border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22); font: 13px/1.4 "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif;
}
.msagent-menu-item {
  display: block; width: 100%; padding: 5px 22px; border: 0; background: none; color: inherit;
  font: inherit; text-align: left; cursor: default; white-space: nowrap;
}
.msagent-menu-item:hover:not(:disabled), .msagent-menu-item:focus-visible { background: #0078d4; color: #fff; outline: none; }
.msagent-menu-item:disabled { color: #9a9a9a; }
.msagent-menu-separator { height: 1px; margin: 4px 0; background: #d6d6d6; }
@media (prefers-color-scheme: dark) {
  .msagent-menu { background: #2b2b2b; color: #f0f0f0; border-color: #555; }
  .msagent-menu-item:disabled { color: #777; }
  .msagent-menu-separator { background: #484848; }
}
`;

/* 聞き取りのヒント (本家の Listening Tip。ツールチップと同じ見た目) */
const LISTENING_TIP_CSS = `
.msagent-listening-tip {
  position: fixed; z-index: 1001; max-width: 260px; padding: 3px 7px; box-sizing: border-box; pointer-events: none;
  background: #ffffe1; color: #000; border: 1px solid #767676; box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.25);
  font: 12px/1.4 "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif;
}
.msagent-listening-tip-title { text-align: center; white-space: nowrap; }
.msagent-listening-tip-body { overflow-wrap: anywhere; }
`;

/* 音声コマンドの窓 (agent.commandsWindow) */
const COMMANDS_WINDOW_CSS = `
.msagent-commands-window {
  position: fixed; right: 12px; bottom: 12px; z-index: 1001; width: 260px; max-height: 50vh; overflow: auto;
  box-sizing: border-box; background: #fff; color: #1b1b1b; border: 1px solid #a0a0a0; border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22); font: 13px/1.4 "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif;
}
.msagent-commands-window-title {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 4px 4px 10px;
  background: #0078d4; color: #fff; font-weight: 600;
}
.msagent-commands-window-close {
  border: 0; background: none; color: inherit; font: inherit; font-size: 16px; line-height: 1; padding: 2px 8px; cursor: pointer;
}
.msagent-commands-window-close:hover { background: rgba(255, 255, 255, 0.2); }
.msagent-commands-window-notice { margin: 8px 10px; color: #a4262c; }
.msagent-commands-window-section { padding: 6px 10px 2px; font-weight: 600; }
.msagent-commands-window ul { margin: 0; padding: 0 10px 6px 26px; }
.msagent-commands-window li { padding: 1px 0; }
.msagent-commands-window-hint { display: block; color: #6b6b6b; font-size: 11px; }
@media (prefers-color-scheme: dark) {
  .msagent-commands-window { background: #2b2b2b; color: #f0f0f0; border-color: #555; }
  .msagent-commands-window-notice { color: #ff99a4; }
  .msagent-commands-window-hint { color: #a8a8a8; }
}
`;

/** タスクバーのアイコン (taskbarIcon): 画面の右下に並べる */
const TASKBAR_CSS = `
.msagent-taskbar {
  position: fixed; right: 8px; bottom: 8px; z-index: 1000; display: flex; gap: 4px; padding: 3px;
  background: rgba(240, 240, 240, 0.9); border: 1px solid #a0a0a0; border-radius: 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
}
.msagent-taskbar-icon {
  display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 2px; box-sizing: border-box;
  border: 1px solid transparent; border-radius: 4px; background: none; cursor: pointer;
  font: 600 14px/1 "Segoe UI", "Yu Gothic UI", "Hiragino Sans", sans-serif; color: #1b1b1b;
}
.msagent-taskbar-icon:hover, .msagent-taskbar-icon:focus-visible { background: rgba(0, 120, 212, 0.12); border-color: rgba(0, 120, 212, 0.5); }
.msagent-taskbar-icon img, .msagent-taskbar-icon canvas { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
@media (prefers-color-scheme: dark) {
  .msagent-taskbar { background: rgba(43, 43, 43, 0.9); border-color: #555; }
  .msagent-taskbar-icon { color: #f0f0f0; }
}
`;

const STYLE_ID = "msagent-styles";

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS + MENU_CSS + LISTENING_TIP_CSS + COMMANDS_WINDOW_CSS + TASKBAR_CSS;
  document.head.prepend(style);
}
