/** 右クリックのメニューの項目 1 つ (本家の Command オブジェクトと同じ) */
export interface AgentCommand {
  /** 選ばれたときに command イベントで返る名前 */
  readonly name: string;
  /** メニューに出す文字。& の次の文字がアクセスキーになる (例: "検索(&S)") */
  caption: string;
  /** false なら、灰色で選べない */
  enabled: boolean;
  /** false なら、メニューに出さない */
  visible: boolean;
}

export interface CommandOptions {
  enabled?: boolean;
  visible?: boolean;
}

/**
 * 右クリックのメニューに足す項目の一覧 (本家の Commands コレクションと同じ)。
 *
 * ```js
 * agent.commands.add("search", "検索(&S)");
 * agent.commands.add("help", "ヘルプ(&H)", { enabled: false });
 * agent.on("command", (e) => console.log(e.detail.name)); // → "search"
 * ```
 */
export class AgentCommands {
  private readonly items: AgentCommand[] = [];
  /** 太字で出す項目の名前 (本家の DefaultCommand と同じ) */
  defaultCommand: string | undefined;
  /** false なら、足した項目をメニューに出さない (本家の Commands.Visible と同じ) */
  visible = true;

  /** 項目を最後に足す。同じ名前があれば置き換える */
  add(name: string, caption: string, options: CommandOptions = {}): AgentCommand {
    this.remove(name);
    const command: AgentCommand = { name, caption, enabled: options.enabled ?? true, visible: options.visible ?? true };
    this.items.push(command);
    return command;
  }

  /** 項目を、refName の項目の前 (before が false なら後ろ) に足す。refName が無ければ最後に足す */
  insert(name: string, refName: string, before: boolean, caption: string, options: CommandOptions = {}): AgentCommand {
    const command = this.add(name, caption, options);
    this.items.pop();
    const at = this.items.findIndex((c) => c.name === refName);
    if (at < 0) this.items.push(command);
    else this.items.splice(before ? at : at + 1, 0, command);
    return command;
  }

  remove(name: string): void {
    const at = this.items.findIndex((c) => c.name === name);
    if (at >= 0) this.items.splice(at, 1);
  }

  removeAll(): void {
    this.items.length = 0;
  }

  /** 名前から項目を取る (本家の Command メソッドと同じ) */
  get(name: string): AgentCommand | undefined {
    return this.items.find((c) => c.name === name);
  }

  get count(): number {
    return this.items.length;
  }

  /** 項目の一覧 (足した順) */
  list(): readonly AgentCommand[] {
    return [...this.items];
  }
}
