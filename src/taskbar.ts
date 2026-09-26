import { imageToDataUrl } from "./acs/icon.js";
import { AcsPlayer } from "./acs/player.js";
import { restFrame } from "./animations.js";
import type { Character } from "./character.js";

/** アイコンを並べる場所 (画面の右下。アイコンが無くなったら取り除く) */
let tray: HTMLDivElement | undefined;

export interface TaskbarIconHost {
  character: Character;
  /** ポインターを重ねたときに出す名前 */
  title(): string;
  click(e: MouseEvent): void;
  dblclick(e: MouseEvent): void;
  contextmenu(e: MouseEvent): void;
}

/**
 * キャラクターのタスクバーのアイコン (本家の Character Taskbar Icon)。隠れたキャラクターを出し直す入り口で、
 * ブラウザにはタスクバーが無いので、画面の右下に並べる。絵は、キャラクターファイルのタスクトレイ用のアイコン
 * (無ければ、止まっているときの絵を縮めたもの)
 */
export class TaskbarIcon {
  readonly element: HTMLButtonElement;

  constructor(private readonly host: TaskbarIconHost) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "msagent-taskbar-icon";
    this.element.append(picture(host.character, host.title()));
    this.refresh();
    this.element.addEventListener("mouseenter", () => this.refresh());
    this.element.addEventListener("click", (e) => host.click(e));
    this.element.addEventListener("dblclick", (e) => host.dblclick(e));
    this.element.addEventListener("contextmenu", (e) => host.contextmenu(e));
    if (!tray) {
      tray = document.createElement("div");
      tray.className = "msagent-taskbar";
      document.body.append(tray);
    }
    tray.append(this.element);
  }

  /** 名前を出し直す (名前・言語を変えたとき) */
  refresh() {
    const title = this.host.title();
    this.element.title = title;
    this.element.setAttribute("aria-label", title);
  }

  destroy() {
    this.element.remove();
    if (tray && tray.childElementCount === 0) {
      tray.remove();
      tray = undefined;
    }
  }
}

/** アイコンの絵: タスクトレイ用のアイコン → 止まっているときの絵 → 名前の頭文字 */
function picture(character: Character, title: string): HTMLElement {
  if (character.trayIcon) {
    const img = document.createElement("img");
    img.src = imageToDataUrl(character.trayIcon);
    img.alt = "";
    return img;
  }
  const frame = restFrame(character);
  if (frame && frame.images.length > 0) {
    const canvas = document.createElement("canvas");
    new AcsPlayer(character, canvas).draw(frame);
    return canvas;
  }
  const span = document.createElement("span");
  span.textContent = [...title][0] ?? "?";
  return span;
}
