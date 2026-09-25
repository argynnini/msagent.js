import { compileVoiceGrammar } from "./grammar";
import type { HeardAlternative } from "./listen";

/** 右クリックのメニューの項目・声のコマンド 1 つ (本家の Command オブジェクトと同じ) */
export interface AgentCommand {
  /** 選ばれたときに command イベントで返る名前 */
  readonly name: string;
  /** メニューに出す文字。& の次の文字がアクセスキーになる (例: "検索(&S)") */
  caption: string;
  /** false なら、灰色で選べない */
  enabled: boolean;
  /** false なら、メニューに出さない (声のコマンドとしては使える。本家と同じ) */
  visible: boolean;
  /**
   * 声で選ぶときの言葉 (本家の Voice と同じ文法。例: "[please] (search | find) [...]")。
   * 無ければ声では選べない。書き方は README の「音声認識」を参照
   */
  voice?: string | undefined;
  /** 聞き取りのヒントなどに出す、声のコマンドの名前 (本家の VoiceCaption) */
  voiceCaption?: string | undefined;
  /** 聞き取った確かさ (0〜100) がこれ以下なら、聞き取りのヒントに confidenceText を出す (本家の Confidence) */
  confidence?: number | undefined;
  /** 確かさが confidence 以下のときに、聞き取りのヒントに出す文 (本家の ConfidenceText) */
  confidenceText?: string | undefined;
  /** ヘルプモードで選ばれたときに、helpcomplete イベントで渡す番号 (本家の HelpContextID) */
  helpContextId?: number | undefined;
}

export interface CommandOptions {
  enabled?: boolean;
  visible?: boolean;
  voice?: string;
  voiceCaption?: string;
  confidence?: number;
  confidenceText?: string;
  helpContextId?: number;
}

/** 声のコマンドに合った候補 (よい順に並べる) */
export interface VoiceMatch {
  /** 合ったコマンドの名前 (msagent.js が用意したコマンドなら "") */
  name: string;
  /** 聞き取った確かさ (0〜100) */
  confidence: number;
  /** 聞き取った文 */
  voice: string;
  /** 合ったコマンド (commands に足したもの) */
  command?: AgentCommand;
  /** msagent.js が用意したコマンド (例: "hide") */
  global?: string;
}

/** msagent.js が用意する声のコマンド (本家の Global Commands) */
export interface GlobalVoiceCommand {
  id: string;
  voice: string;
}

/** 文法を読んだもの (同じ文法は読み直さない。書き方が誤っていれば null) */
const compiled = new Map<string, ((heard: string) => boolean) | null>();
function matcher(grammar: string) {
  let m = compiled.get(grammar);
  if (m === undefined) {
    try {
      m = compileVoiceGrammar(grammar);
    } catch (e) {
      console.warn("msagent.js: 声のコマンドの文法が正しくありません", e);
      m = null;
    }
    compiled.set(grammar, m);
  }
  return m;
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
  /** コマンドのまとまりの名前 (本家の Commands.Caption)。聞き取りのヒントに出す (voiceCaption が無いとき) */
  caption: string | undefined;
  /** 聞き取りのヒントに出す、声のコマンドのまとまりの名前 (本家の Commands.VoiceCaption) */
  voiceCaption: string | undefined;
  /** false なら、msagent.js が用意した声のコマンド (「隠れて」など) を使わない (本家の GlobalVoiceCommandsEnabled) */
  globalVoiceCommandsEnabled = true;
  /** メニューの文字の書体 (本家の Commands.FontName と同じ。CSS の font-family)。undefined なら CSS のまま */
  fontName: string | undefined;
  /** メニューの文字の大きさ (ポイント。本家の Commands.FontSize と同じ)。undefined なら CSS のまま */
  fontSize: number | undefined;

  /** 項目を最後に足す。同じ名前があれば置き換える */
  add(name: string, caption: string, options: CommandOptions = {}): AgentCommand {
    this.remove(name);
    const command: AgentCommand = { ...options, name, caption, enabled: options.enabled ?? true, visible: options.visible ?? true };
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

  /**
   * 聞き取った候補 (よい順) を、声のコマンド (voice のある、選べる項目) と globals に照らし合わせる。
   * 合ったものを、候補の順に最大 3 つ返す (本家の UserInput と同じく、同じコマンドが何度か入ることもある)
   */
  matchVoice(alternatives: readonly HeardAlternative[], globals: readonly GlobalVoiceCommand[] = []): VoiceMatch[] {
    const matches: VoiceMatch[] = [];
    for (const { transcript, confidence } of alternatives) {
      const score = Math.round(Math.max(0, Math.min(1, confidence)) * 100);
      for (const command of this.items) {
        if (command.enabled && command.voice && matcher(command.voice)?.(transcript)) {
          matches.push({ name: command.name, confidence: score, voice: transcript, command });
        }
      }
      if (this.globalVoiceCommandsEnabled) {
        for (const g of globals) {
          if (matcher(g.voice)?.(transcript)) matches.push({ name: "", confidence: score, voice: transcript, global: g.id });
        }
      }
    }
    return matches.slice(0, 3);
  }
}
