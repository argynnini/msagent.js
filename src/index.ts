import { msagent } from "./load";

// 読み込み (clippy.js と同じ msagent.load)
export default msagent;
export { msagent, load } from "./load";
export { audioOutput } from "./audio";
export type { AudioStatus } from "./audio";
export type { CharacterSource, LoadOptions } from "./load";

// キャラクター 1 体と、その命令・イベント・メニュー
export { Agent, parseCharacter } from "./agent";
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
  PointerDetail,
  SpeakOptions,
  SrStatus,
  StopOptions,
  StopType,
  ThinkOptions,
  VisibilityCause,
} from "./agent";
export { AgentRequest, AgentRequestError, RequestError } from "./request";
export type { RequestStatus, RequestType } from "./request";
export { AgentCommands } from "./commands";
export { CommandsWindow } from "./commandswindow";
export type { AgentCommand, CommandOptions, VoiceMatch } from "./commands";
export { compileVoiceGrammar, GrammarError, normalizeSpeech } from "./grammar";

// キャラクターファイル (ACS / ACT) の中身
export { DEFAULT_BALLOON_STYLE } from "./character";
export type { BalloonStyle, Character, VoiceSettings } from "./character";
export { AcsCharacter } from "./acs/reader";
export type { AcsImage, Animation, Branch, Frame, FrameImage, Overlay } from "./acs/reader";
export { ActCharacter, isActFile } from "./act/reader";
export { imageToDataUrl } from "./acs/icon";
export { defaultLanguages, languageTag, pickLanguage } from "./language";
export type { Language } from "./language";

// 部品 (自分で組み立てるとき)
export { AcsPlayer } from "./acs/player";
export { Speaker } from "./speak";
export type { SpeakHandlers } from "./speak";
export { mouthForIpa, mouthSteps } from "./mouth";
export { ipaAt, readLwv } from "./lwv";
export type { LwvInfo, LwvPhoneme, LwvWord } from "./lwv";
export { pickVoice, voiceParams } from "./voice";
export type { SpeakParams } from "./voice";
export { parseSpeechTags, shownText } from "./tags";
export type { SpeechPart, SpeechText } from "./tags";
export { IdleController, idleLevel, isIdleAnimation, pickIdle, pickIdleFor } from "./idle";
export type { IdleDeps } from "./idle";
