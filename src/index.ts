import { msagent } from "./load.js";

// 読み込み (msagent.load)
export default msagent;
export { msagent, load } from "./load.js";
export { audioOutput } from "./audio.js";
export type { AudioStatus } from "./audio.js";
export type { CharacterSource, LoadOptions } from "./load.js";

// キャラクター 1 体と、その命令・イベント・メニュー
export { Agent, parseCharacter } from "./agent.js";
export type {
  AgentEventListener,
  AgentEventMap,
  AgentOptions,
  CommandAlternative,
  CommandDetail,
  GetType,
  HelpCause,
  HelpDetail,
  HideOptions,
  ListenCause,
  ListenMode,
  MoveCause,
  MoveOptions,
  PointerDetail,
  SpeakOptions,
  SrStatus,
  StopOptions,
  StopType,
  ThinkOptions,
  VisibilityCause,
} from "./agent.js";
export { AgentRequest, AgentRequestError, RequestError } from "./request.js";
export type { RequestStatus, RequestType } from "./request.js";
export { AgentCommands } from "./commands.js";
export { CommandsWindow } from "./commandswindow.js";
export type { AgentCommand, CommandOptions, VoiceMatch } from "./commands.js";
export { compileVoiceGrammar, GrammarError, normalizeSpeech } from "./grammar.js";

// キャラクターファイル (ACS / ACF / ACT) の中身
export { DEFAULT_BALLOON_STYLE } from "./character.js";
export type { BalloonStyle, Character, VoiceSettings } from "./character.js";
export { AcsCharacter } from "./acs/reader.js";
export { AcfCharacter, isAcfFile } from "./acf/reader.js";
export type { AcfOptions } from "./acf/reader.js";
export type { AcsImage, Animation, Branch, Frame, FrameImage, Overlay } from "./acs/reader.js";
export { ActCharacter, isActFile } from "./act/reader.js";
export { imageToDataUrl } from "./acs/icon.js";
export { defaultLanguages, languageTag, pickLanguage } from "./language.js";
export type { Language } from "./language.js";

// 部品 (自分で組み立てるとき)
export { AcsPlayer } from "./acs/player.js";
export { Speaker } from "./speak.js";
export type { SpeakHandlers } from "./speak.js";
export { mouthForIpa, mouthSteps } from "./mouth.js";
export { ipaAt, readLwv } from "./lwv.js";
export type { LwvInfo, LwvPhoneme, LwvWord } from "./lwv.js";
export { pickVoice, voiceParams } from "./voice.js";
export type { SpeakParams } from "./voice.js";
export { parseSpeechTags, shownText } from "./tags.js";
export type { Bookmark, SpeechPart, SpeechText } from "./tags.js";
export { IdleController, idleLevel, isIdleAnimation, pickIdle, pickIdleFor } from "./idle.js";
export type { IdleDeps } from "./idle.js";
