import { Agent, parseCharacter, type AgentOptions } from "./agent.js";
import { audioOutput } from "./audio.js";
import type { Character } from "./character.js";

/**
 * A character file: its bytes, a `File` / `Blob`, or a URL (string or `URL`) to fetch.
 * A bare name such as `"Merlin"` becomes `path + "Merlin.acs"`.
 */
export type CharacterSource = ArrayBuffer | ArrayBufferView | Blob | string | URL;

/** Options for {@link load}: what to load, plus the {@link AgentOptions} for the new agent. */
export interface LoadOptions extends AgentOptions {
  /**
   * The character: a name (`"Merlin"` → `path + "Merlin.acs"`), a URL (.acs / .acf / .act), a `File` / `Blob`, or bytes.
   */
  name: CharacterSource;
  /** Called with the new agent once it is loaded. */
  successCb?: (agent: Agent) => void;
  /** Called if loading fails. */
  failCb?: (error: unknown) => void;
  /** Prefix used to turn a bare name into a URL. Default: `msagent.BASE_PATH`. */
  path?: string;
  /** CSS selector of the element to place the character in. Default: `document.body`. */
  selector?: string;
  /**
   * For .acf characters: the animations (.aca) to download before loading finishes, as state names (`"Showing"`, ...)
   * or animation names, or `"all"`. Default: `["Showing", "Hiding", "Speaking", "RestPose"]`.
   * Other animations are downloaded when first played (delaying them a little); `agent.get()` can fetch them earlier.
   */
  preload?: "all" | readonly string[];
  /**
   * For .acf characters: the URL the animation (.aca) file names are resolved against.
   * Default: the .acf URL if it was loaded from a URL, otherwise the page URL.
   */
  baseUrl?: string | URL;
}

/** .acf のキャラクターで、省略時に先に取り寄せておくもの */
const DEFAULT_PRELOAD = ["Showing", "Hiding", "Speaking", "RestPose"];

/** 先読みの指定 (状態名かアニメーション名) を、アニメーション名にする */
function preloadNames(character: Character, preload: "all" | readonly string[]): string[] {
  if (preload === "all") return [...character.animations.keys()];
  return preload.flatMap((n) => {
    const assigned = character.stateAnimations(n);
    if (assigned.length > 0) return assigned;
    const lower = n.toLowerCase();
    return [...character.animations.keys()].filter((key) => key.toLowerCase() === lower);
  });
}

/** 名前だけ ("Merlin") なら、path を前に付けて .acs を足す。拡張子や URL の形なら、そのまま (相対なら path を前に付ける) */
function resolveUrl(name: string, path: string): string {
  if (/^([a-z][a-z\d+.-]*:|\/)/i.test(name)) return name;
  return `${path}${/\.ac[stf]$/i.test(name) ? name : `${name}.acs`}`;
}

/** キャラクターファイルの中身と、取ってきた URL (URL から取ってきたときだけ) */
async function readSource(source: CharacterSource, path: string): Promise<{ data: ArrayBuffer; url?: string }> {
  if (source instanceof ArrayBuffer) return { data: source };
  if (ArrayBuffer.isView(source)) {
    return { data: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer };
  }
  if (source instanceof Blob) return { data: await source.arrayBuffer() };
  const url = typeof source === "string" ? resolveUrl(source, path) : source;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch character file: ${res.status} ${res.url}`);
  return { data: await res.arrayBuffer(), url: res.url };
}

function isLoadOptions(v: unknown): v is LoadOptions {
  return typeof v === "object" && v !== null && "name" in v && !(v instanceof Blob) && !ArrayBuffer.isView(v);
}

/**
 * Loads a character file (.acs / .acf / .act) and creates an {@link Agent}. The agent starts hidden; call `show()`.
 *
 * ```js
 * msagent.load("Merlin", (agent) => agent.show());              // msagent.BASE_PATH + "Merlin.acs"
 * msagent.load({ name: "Merlin", successCb: (agent) => agent.show() });
 * msagent.load({ name: "Merlin", scale: 2 }, (agent) => agent.show()); // options and callbacks can be separate
 * const agent = await msagent.load(file);                        // or use the returned Promise
 * ```
 *
 * @param name - The character, or {@link LoadOptions}.
 * @param successCb - Called with the new agent. Ignored if `name` is options with its own `successCb`.
 * @param failCb - Called if loading fails. Ignored if `name` is options with its own `failCb`.
 *   If only `successCb` is given, errors are logged to the console.
 * @param path - Prefix used to turn a bare name into a URL. Default: `msagent.BASE_PATH`.
 * @returns The new agent.
 */
export function load(
  name: CharacterSource | LoadOptions,
  successCb?: (agent: Agent) => void,
  failCb?: (error: unknown) => void,
  path?: string,
): Promise<Agent> {
  // 設定をまとめて渡したときも、後ろの引数のコールバックを使う (設定の中にあれば、そちらを使う)
  const options: LoadOptions = isLoadOptions(name)
    ? { ...name, successCb: name.successCb ?? successCb, failCb: name.failCb ?? failCb, path: name.path ?? path }
    : { name, successCb, failCb, path };
  const promise = (async () => {
    const { data, url } = await readSource(options.name, options.path ?? msagent.BASE_PATH);
    const character = parseCharacter(data, { baseUrl: options.baseUrl ?? url });
    if (character.prepare) await character.prepare(preloadNames(character, options.preload ?? DEFAULT_PRELOAD));
    const container = options.selector
      ? (document.querySelector<HTMLElement>(options.selector) ?? undefined)
      : options.container;
    return new Agent(character, { ...options, container });
  })();
  if (options.successCb || options.failCb) promise.then(options.successCb, options.failCb ?? ((e) => console.error(e)));
  return promise;
}

/** The library's entry point (`window.msagent` when loaded with a `<script>` tag). */
export const msagent = {
  /** Prefix added when {@link load} is given a bare name (e.g. `"/agents/"`). */
  BASE_PATH: "",
  /** See {@link load}. */
  load,
  /** See {@link Agent}. */
  Agent,
  /** Audio settings and status shared by all characters. Same as Microsoft Agent's `AudioOutput`. */
  audioOutput,
};
