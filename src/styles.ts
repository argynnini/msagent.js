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
}
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

const STYLE_ID = "msagent-styles";

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.prepend(style);
}
