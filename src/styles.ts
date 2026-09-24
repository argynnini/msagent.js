/**
 * キャラクターと吹き出しの既定の見た目。
 * <head> の先頭に入れるので、ページの CSS で上書きできる
 */
const CSS = `
.msagent, .msagent-balloon { position: fixed; z-index: 1000; }
.msagent { cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: none; }
.msagent canvas { display: block; }
.msagent-balloon {
  box-sizing: border-box; padding: 8px; border: 1px solid #000; border-radius: 5px;
  background: #ffc; color: #000;
}
.msagent-content {
  min-width: 120px; max-width: 200px; white-space: pre-wrap; overflow-wrap: anywhere;
  font: 10pt/1.4 "Microsoft Sans Serif", "MS UI Gothic", Tahoma, sans-serif;
}
.msagent-tip {
  position: absolute; width: 12px; height: 12px; box-sizing: border-box;
  background: #ffc; border: 1px solid #000; transform: rotate(45deg);
}
.msagent-top-left .msagent-tip, .msagent-top-right .msagent-tip {
  top: 100%; margin-top: -6px; border-top-color: transparent; border-left-color: transparent;
}
.msagent-bottom-left .msagent-tip, .msagent-bottom-right .msagent-tip {
  bottom: 100%; margin-bottom: -6px; border-bottom-color: transparent; border-right-color: transparent;
}
.msagent-top-left .msagent-tip, .msagent-bottom-left .msagent-tip { right: 24px; }
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
