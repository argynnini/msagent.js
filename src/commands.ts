import { compileVoiceGrammar } from "./grammar.js";
import type { HeardAlternative } from "./listen.js";

/**
 * One popup menu item / voice command. Same as Microsoft Agent's `Command` object.
 * Changes to the properties take effect the next time the menu or the Voice Commands Window is shown.
 */
export interface AgentCommand {
  /** Name reported in the `command` event when the command is chosen. */
  readonly name: string;
  /** Menu text. The character after `&` is the access key (e.g. `"&Search"`); `&&` is a literal `&`. */
  caption: string;
  /** If `false`, the item is grayed out and cannot be chosen (by menu or by voice). */
  enabled: boolean;
  /** If `false`, the item is not shown in the menu but can still be spoken, like Microsoft Agent. */
  visible: boolean;
  /**
   * Grammar of what to say to choose the command by voice, e.g. `"[please] (search | find) [...]"`
   * (see {@link compileVoiceGrammar}). Without it, the command cannot be chosen by voice.
   * Same as Microsoft Agent's `Command.Voice`.
   */
  voice?: string | undefined;
  /** Name shown for the voice command in the Voice Commands Window. Same as Microsoft Agent's `VoiceCaption`. */
  voiceCaption?: string | undefined;
  /**
   * Confidence threshold (0–100). If a match is at or below it, the Listening Tip shows `confidenceText`.
   * Same as Microsoft Agent's `Confidence`.
   */
  confidence?: number | undefined;
  /** Text shown in the Listening Tip when the confidence is at or below `confidence`. Same as `ConfidenceText`. */
  confidenceText?: string | undefined;
  /** Number passed in `helpcomplete` when the command is chosen in Help mode. Same as `HelpContextID`. */
  helpContextId?: number | undefined;
}

/** Optional properties for {@link AgentCommands.add} / {@link AgentCommands.insert}. See {@link AgentCommand}. */
export interface CommandOptions {
  /** See {@link AgentCommand.enabled}. Default: `true`. */
  enabled?: boolean;
  /** See {@link AgentCommand.visible}. Default: `true`. */
  visible?: boolean;
  /** See {@link AgentCommand.voice}. */
  voice?: string;
  /** See {@link AgentCommand.voiceCaption}. */
  voiceCaption?: string;
  /** See {@link AgentCommand.confidence}. */
  confidence?: number;
  /** See {@link AgentCommand.confidenceText}. */
  confidenceText?: string;
  /** See {@link AgentCommand.helpContextId}. */
  helpContextId?: number;
}

/** A voice command that matched what was heard. Returned best first by {@link AgentCommands.matchVoice}. */
export interface VoiceMatch {
  /** Name of the matched command, or `""` for a built-in global command. */
  name: string;
  /** Recognition confidence, 0–100. */
  confidence: number;
  /** The text that was heard. */
  voice: string;
  /** The matched command from `agent.commands`. */
  command?: AgentCommand;
  /** ID of the matched built-in global command (e.g. `"hide"`). */
  global?: string;
}

/** A built-in global voice command (like Microsoft Agent's Global Commands). */
export interface GlobalVoiceCommand {
  /** ID reported in {@link VoiceMatch.global}. */
  id: string;
  /** Grammar of what to say. */
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
      console.warn("msagent.js: invalid voice command grammar", e);
      m = null;
    }
    compiled.set(grammar, m);
  }
  return m;
}

/**
 * The commands shown in the popup menu and recognized by voice (`agent.commands`).
 * Same as Microsoft Agent's `Commands` collection.
 *
 * ```js
 * agent.commands.add("search", "&Search", { voice: "[please] (search | find) [...]" });
 * agent.commands.add("help", "&Help", { enabled: false });
 * agent.on("command", (e) => console.log(e.detail.name)); // → "search"
 * ```
 */
export class AgentCommands {
  private readonly items: AgentCommand[] = [];
  /** Name of the command shown in bold. Same as Microsoft Agent's `DefaultCommand`. */
  defaultCommand: string | undefined;
  /** If `false`, the added commands are not shown in the menu. Same as `Commands.Visible`. */
  visible = true;
  /**
   * Name of this set of commands, shown in the Listening Tip and the Voice Commands Window when `voiceCaption` is not
   * set. Same as `Commands.Caption`.
   */
  caption: string | undefined;
  /** Name of this set of voice commands, shown in the Listening Tip and the Voice Commands Window. Same as `Commands.VoiceCaption`. */
  voiceCaption: string | undefined;
  /**
   * If `false`, the built-in global voice commands (hide, open / close the Voice Commands Window) are disabled.
   * Same as `Commands.GlobalVoiceCommandsEnabled`.
   */
  globalVoiceCommandsEnabled = true;
  /** Font of the menu (a CSS `font-family`), or `undefined` to keep the stylesheet's. Same as `Commands.FontName`. */
  fontName: string | undefined;
  /** Font size of the menu in points, or `undefined` to keep the stylesheet's. Same as `Commands.FontSize`. */
  fontSize: number | undefined;

  /**
   * Adds a command at the end, replacing any command with the same name. Same as `Commands.Add`.
   *
   * @param name - Name reported in the `command` event.
   * @param caption - Menu text (`&` marks the access key).
   * @returns The new command; its properties can be changed later.
   */
  add(name: string, caption: string, options: CommandOptions = {}): AgentCommand {
    this.remove(name);
    const command: AgentCommand = {
      ...options,
      name,
      caption,
      enabled: options.enabled ?? true,
      visible: options.visible ?? true,
    };
    this.items.push(command);
    return command;
  }

  /**
   * Adds a command next to another one, replacing any command with the same name. Same as `Commands.Insert`.
   *
   * @param refName - Name of the command to insert next to. If it does not exist, the command is added at the end.
   * @param before - Insert before `refName` if `true`, after it if `false`.
   * @returns The new command.
   */
  insert(name: string, refName: string, before: boolean, caption: string, options: CommandOptions = {}): AgentCommand {
    const command = this.add(name, caption, options);
    this.items.pop();
    const at = this.items.findIndex((c) => c.name === refName);
    if (at < 0) this.items.push(command);
    else this.items.splice(before ? at : at + 1, 0, command);
    return command;
  }

  /** Removes a command. Same as `Commands.Remove`. */
  remove(name: string): void {
    const at = this.items.findIndex((c) => c.name === name);
    if (at >= 0) this.items.splice(at, 1);
  }

  /** Removes all commands. Same as `Commands.RemoveAll`. */
  removeAll(): void {
    this.items.length = 0;
  }

  /** Returns the command with this name. Same as Microsoft Agent's `Commands.Command`. */
  get(name: string): AgentCommand | undefined {
    return this.items.find((c) => c.name === name);
  }

  /** Number of commands. Same as `Commands.Count`. */
  get count(): number {
    return this.items.length;
  }

  /** All commands, in menu order. */
  list(): readonly AgentCommand[] {
    return [...this.items];
  }

  /**
   * Matches recognized alternatives (best first) against the enabled commands that have a `voice` grammar, and
   * against `globals`. Returns up to 3 matches in the order of the alternatives; like Microsoft Agent's `UserInput`,
   * the same command may appear more than once.
   *
   * @param alternatives - Recognized text with a confidence from 0 to 1.
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
          if (matcher(g.voice)?.(transcript))
            matches.push({ name: "", confidence: score, voice: transcript, global: g.id });
        }
      }
    }
    return matches.slice(0, 3);
  }
}
