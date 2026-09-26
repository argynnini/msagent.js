import { Agent, parseCharacter, type AgentOptions } from "./agent";
import { audioOutput } from "./audio";
import type { Character } from "./character";

/** キャラクターファイルの中身。文字列 / URL なら fetch で取ってくる */
export type CharacterSource = ArrayBuffer | ArrayBufferView | Blob | string | URL;

export interface LoadOptions extends AgentOptions {
  /** キャラクター名 ("Merlin" → path + "Merlin.acs")、URL (.acs / .acf / .act)、File / Blob、バイト列 */
  name: CharacterSource;
  successCb?: (agent: Agent) => void;
  failCb?: (error: unknown) => void;
  /** 名前から URL を作るときの前置き (既定: msagent.BASE_PATH) */
  path?: string;
  /** キャラクターを置く要素の CSS セレクター (既定: body) */
  selector?: string;
  /**
   * .acf のキャラクターで、読み込みを終える前に取り寄せておくアニメーション (.aca)。状態名 ("Showing" など) かアニメーション名。
   * "all" なら全部。省略時は、登場・退場・しゃべるときと、止まっているときの絵 (Showing, Hiding, Speaking, RestPose)。
   * それ以外は、再生するときに取り寄せる (取り寄せる間だけ、動き出すのが遅れる)。agent.get() で先に取り寄せてもよい
   */
  preload?: "all" | readonly string[];
  /**
   * .acf のキャラクターで、アニメーション (.aca) のファイル名の基準の URL。
   * 省略時は、.acf を URL で読み込んだならその URL、File / バイト列ならページの URL
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
  if (!res.ok) throw new Error(`キャラクターファイルを取得できません: ${res.status} ${res.url}`);
  return { data: await res.arrayBuffer(), url: res.url };
}

function isLoadOptions(v: unknown): v is LoadOptions {
  return typeof v === "object" && v !== null && "name" in v && !(v instanceof Blob) && !ArrayBuffer.isView(v);
}

/**
 * キャラクターを読み込む。
 *
 * ```js
 * msagent.load("Merlin", (agent) => agent.show());              // msagent.BASE_PATH + "Merlin.acs"
 * msagent.load({ name: "Merlin", successCb: (agent) => agent.show() });
 * msagent.load({ name: "Merlin", scale: 2 }, (agent) => agent.show()); // 設定とコールバックを分けても同じ
 * const agent = await msagent.load(file);                        // Promise でも受け取れる
 * ```
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
    const container = options.selector ? (document.querySelector<HTMLElement>(options.selector) ?? undefined) : options.container;
    return new Agent(character, { ...options, container });
  })();
  if (options.successCb || options.failCb) promise.then(options.successCb, options.failCb ?? ((e) => console.error(e)));
  return promise;
}

/** ライブラリの入り口 (<script> で読み込むと window.msagent になる) */
export const msagent = {
  /** 名前だけで load() したときに、前に付ける場所 (例: "/agents/") */
  BASE_PATH: "",
  load,
  Agent,
  /** 全キャラクターの音の設定と状態 (本家の AudioOutput) */
  audioOutput,
};
