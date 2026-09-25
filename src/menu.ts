/** メニューに出す 1 行 (separator は区切り線) */
export type MenuEntry =
  | { kind: "item"; caption: string; enabled: boolean; bold?: boolean; onSelect: () => void }
  | { kind: "separator" };

/** メニューの文字 (本家の Commands.FontName / FontSize。指定が無ければ CSS のまま) */
export interface MenuFont {
  fontName?: string | undefined;
  /** ポイント */
  fontSize?: number | undefined;
}

/** 開いているメニュー (同時に開けるのは 1 つだけ。本家と同じ) */
let openMenu: PopupMenu | undefined;

/**
 * 右クリックのメニュー。画面上の (x, y) に出し、項目を選ぶか、外をクリック・Esc で閉じる。
 * 矢印キー・Enter・アクセスキー (キャプションの & の次の文字) でも選べる
 */
export class PopupMenu {
  readonly element: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly cleanups: (() => void)[] = [];

  constructor(entries: readonly MenuEntry[], x: number, y: number, font: MenuFont = {}) {
    openMenu?.close();
    openMenu = this;
    this.element = document.createElement("div");
    this.element.className = "msagent-menu";
    if (font.fontName) this.element.style.fontFamily = font.fontName;
    if (font.fontSize) this.element.style.fontSize = `${font.fontSize}pt`;
    this.element.setAttribute("role", "menu");
    for (const entry of entries) {
      if (entry.kind === "separator") {
        const hr = document.createElement("div");
        hr.className = "msagent-menu-separator";
        hr.setAttribute("role", "separator");
        this.element.append(hr);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "msagent-menu-item";
      button.setAttribute("role", "menuitem");
      button.disabled = !entry.enabled;
      if (entry.bold) button.style.fontWeight = "700";
      const { label, key } = parseCaption(entry.caption);
      button.append(...label);
      if (key) button.dataset.key = key;
      button.addEventListener("click", () => {
        this.close();
        entry.onSelect();
      });
      this.buttons.push(button);
      this.element.append(button);
    }
    document.body.append(this.element);
    this.place(x, y);

    // 外をクリック・スクロール・窓を離れたら閉じる
    const outside = (e: Event) => {
      if (!this.element.contains(e.target as Node)) this.close();
    };
    this.listen(document, "pointerdown", outside, true);
    this.listen(document, "contextmenu", outside, true);
    this.listen(window, "blur", () => this.close());
    this.listen(window, "resize", () => this.close());
    this.listen(document, "keydown", (e) => this.onKey(e as KeyboardEvent), true);
    this.enabledButtons()[0]?.focus();
  }

  close() {
    if (openMenu === this) openMenu = undefined;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.element.remove();
  }

  /** 画面からはみ出さないように置く (右や下にはみ出すなら、左や上へ出す) */
  private place(x: number, y: number) {
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    this.element.style.left = `${Math.max(0, x + w > vw ? x - w : x)}px`;
    this.element.style.top = `${Math.max(0, y + h > vh ? y - h : y)}px`;
  }

  private enabledButtons(): HTMLButtonElement[] {
    return this.buttons.filter((b) => !b.disabled);
  }

  private onKey(e: KeyboardEvent) {
    const buttons = this.enabledButtons();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") this.close();
    else if (e.key === "ArrowDown") buttons[(at + 1) % buttons.length]?.focus();
    else if (e.key === "ArrowUp") buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    else if (e.key === "Home") buttons[0]?.focus();
    else if (e.key === "End") buttons[buttons.length - 1]?.focus();
    else if (e.key.length === 1) {
      // アクセスキー
      const hit = buttons.find((b) => b.dataset.key === e.key.toLowerCase());
      if (!hit) return;
      hit.click();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void, capture = false) {
    target.addEventListener(type, handler, capture);
    this.cleanups.push(() => target.removeEventListener(type, handler, capture));
  }
}

/** "検索(&S)" → 表示 (S に下線) とアクセスキー "s"。&& は & という文字 */
function parseCaption(caption: string): { label: (string | HTMLElement)[]; key: string | undefined } {
  const label: (string | HTMLElement)[] = [];
  let key: string | undefined;
  let text = "";
  for (let i = 0; i < caption.length; i++) {
    const c = caption[i]!;
    if (c !== "&") {
      text += c;
      continue;
    }
    const next = caption[i + 1];
    if (next === "&") {
      text += "&";
      i++;
    } else if (next !== undefined && key === undefined) {
      if (text) label.push(text);
      text = "";
      const u = document.createElement("u");
      u.textContent = next;
      label.push(u);
      key = next.toLowerCase();
      i++;
    }
  }
  if (text) label.push(text);
  return { label, key };
}
