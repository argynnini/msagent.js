/** A heading in the Voice Commands Window and the commands under it. */
export interface CommandsWindowSection {
  /** Heading text. */
  caption: string;
  /** Command names, with what to say (a grammar or an example) as the hint. */
  items: { caption: string; hint?: string | undefined }[];
}

/** What the Voice Commands Window shows. Rebuilt every time it is opened or refreshed. */
export interface CommandsWindowContent {
  /** Window title. */
  title: string;
  /** Accessible name of the close button. */
  closeLabel: string;
  /** Message shown when speech recognition is unavailable. */
  notice?: string | undefined;
  /** The sections of commands. */
  sections: CommandsWindowSection[];
}

/**
 * The Voice Commands Window (`agent.commandsWindow`), listing the commands that can be spoken now.
 * Same as Microsoft Agent's `CommandsWindow` object.
 *
 * It opens at the bottom right of the page (Microsoft Agent puts it next to the taskbar icon); style
 * `.msagent-commands-window` to move it.
 */
export class CommandsWindow {
  /** The window's element (`div.msagent-commands-window`). */
  readonly element: HTMLDivElement;

  /** @internal Created by {@link Agent}. */
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

  /** Whether the window is open. Assign to open or close it. Same as `CommandsWindow.Visible`. */
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

  /** Redraws the window with the current commands, if it is open. Call it after changing commands. */
  refresh() {
    if (this.visible) this.render();
  }

  /** Left edge in CSS pixels in the viewport, or `0` while closed. Same as `CommandsWindow.Left`. */
  get left(): number {
    return this.visible ? this.element.getBoundingClientRect().left : 0;
  }

  /** Top edge in CSS pixels in the viewport, or `0` while closed. Same as `CommandsWindow.Top`. */
  get top(): number {
    return this.visible ? this.element.getBoundingClientRect().top : 0;
  }

  /** Width in CSS pixels, or `0` while closed. Same as `CommandsWindow.Width`. */
  get width(): number {
    return this.visible ? this.element.offsetWidth : 0;
  }

  /** Height in CSS pixels, or `0` while closed. Same as `CommandsWindow.Height`. */
  get height(): number {
    return this.visible ? this.element.offsetHeight : 0;
  }

  /** @internal Removes the window's element. Called by `agent.destroy()`. */
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
