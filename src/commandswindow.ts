/** 音声コマンドの窓の、見出し 1 つとその下のコマンド */
export interface CommandsWindowSection {
  caption: string;
  /** コマンドの名前と、言う言葉 (文法や例) */
  items: { caption: string; hint?: string | undefined }[];
}

/** 音声コマンドの窓に出すもの (開くたびに作り直す) */
export interface CommandsWindowContent {
  title: string;
  /** 閉じるボタンの名前 (読み上げソフト用) */
  closeLabel: string;
  /** 音声認識が使えないときの知らせ */
  notice?: string | undefined;
  sections: CommandsWindowSection[];
}

/**
 * 音声コマンドの窓 (本家の Voice Commands Window / CommandsWindow オブジェクト)。いま声で言えるコマンドの一覧を出す。
 * 画面の右下に出す (本家はタスクバーのアイコンの隣)。位置は CSS (.msagent-commands-window) で変えられる
 */
export class CommandsWindow {
  readonly element: HTMLDivElement;

  constructor(
    private readonly content: () => CommandsWindowContent,
    /** 開くときの z-index (どのキャラクターよりも手前に出す) */
    private readonly zIndex: () => string,
  ) {
    this.element = document.createElement("div");
    this.element.className = "msagent-commands-window";
    this.element.setAttribute("role", "dialog");
    this.element.style.display = "none";
  }

  /** 開いているか (本家の CommandsWindow.Visible)。代入すると開く・閉じる */
  get visible(): boolean {
    return this.element.style.display !== "none";
  }

  set visible(on: boolean) {
    if (on === this.visible) return;
    if (!on) {
      this.element.style.display = "none";
      return;
    }
    if (!this.element.isConnected) document.body.append(this.element);
    this.render();
    this.element.style.zIndex = this.zIndex();
    this.element.style.display = "block";
  }

  /** 開いていれば、いまのコマンドで作り直す (コマンドを足したり変えたりしたとき) */
  refresh() {
    if (this.visible) this.render();
  }

  /** 画面上の位置と大きさ (px。本家の Left / Top / Width / Height。閉じていれば 0) */
  get left(): number {
    return this.visible ? this.element.getBoundingClientRect().left : 0;
  }

  get top(): number {
    return this.visible ? this.element.getBoundingClientRect().top : 0;
  }

  get width(): number {
    return this.visible ? this.element.offsetWidth : 0;
  }

  get height(): number {
    return this.visible ? this.element.offsetHeight : 0;
  }

  destroy() {
    this.element.remove();
  }

  private render() {
    const { title, closeLabel, notice, sections } = this.content();
    const header = document.createElement("div");
    header.className = "msagent-commands-window-title";
    const heading = document.createElement("span");
    heading.textContent = title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "msagent-commands-window-close";
    close.textContent = "×";
    close.setAttribute("aria-label", closeLabel);
    close.addEventListener("click", () => (this.visible = false));
    header.append(heading, close);
    this.element.setAttribute("aria-label", title);
    this.element.replaceChildren(header);
    if (notice) {
      const p = document.createElement("p");
      p.className = "msagent-commands-window-notice";
      p.textContent = notice;
      this.element.append(p);
    }
    for (const section of sections) {
      const h = document.createElement("div");
      h.className = "msagent-commands-window-section";
      h.textContent = section.caption;
      const ul = document.createElement("ul");
      for (const item of section.items) {
        const li = document.createElement("li");
        li.textContent = item.caption;
        if (item.hint) {
          const hint = document.createElement("span");
          hint.className = "msagent-commands-window-hint";
          hint.textContent = item.hint;
          li.append(hint);
        }
        ul.append(li);
      }
      this.element.append(h, ul);
    }
  }
}
