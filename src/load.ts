import { Agent, parseCharacter, type AgentOptions } from "./agent";
import { audioOutput } from "./audio";

/** キャラクターファイルの中身。文字列 / URL なら fetch で取ってくる */
export type CharacterSource = ArrayBuffer | ArrayBufferView | Blob | string | URL;

export interface LoadOptions extends AgentOptions {
  /** キャラクター名 ("Merlin" → path + "Merlin.acs")、URL、File / Blob、バイト列 */
  name: CharacterSource;
  successCb?: (agent: Agent) => void;
  failCb?: (error: unknown) => void;
  /** 名前から URL を作るときの前置き (既定: msagent.BASE_PATH) */
  path?: string;
  /** キャラクターを置く要素の CSS セレクター (既定: body) */
  selector?: string;
}

/** 名前だけ ("Merlin") なら、path を前に付けて .acs を足す。拡張子や URL の形なら、そのまま (相対なら path を前に付ける) */
function resolveUrl(name: string, path: string): string {
  if (/^([a-z][a-z\d+.-]*:|\/)/i.test(name)) return name;
  return `${path}${/\.ac[st]$/i.test(name) ? name : `${name}.acs`}`;
}

async function toArrayBuffer(source: CharacterSource, path: string): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;
  if (ArrayBuffer.isView(source)) {
    return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  }
  if (source instanceof Blob) return source.arrayBuffer();
  const url = typeof source === "string" ? resolveUrl(source, path) : source;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`キャラクターファイルを取得できません: ${res.status} ${res.url}`);
  return res.arrayBuffer();
}

function isLoadOptions(v: unknown): v is LoadOptions {
  return typeof v === "object" && v !== null && "name" in v && !(v instanceof Blob) && !ArrayBuffer.isView(v);
}

/**
 * キャラクターを読み込む (clippy.js と同じ呼び方)。
 *
 * ```js
 * msagent.load("Merlin", (agent) => agent.show());              // msagent.BASE_PATH + "Merlin.acs"
 * msagent.load({ name: "Merlin", successCb: (agent) => agent.show() });
 * const agent = await msagent.load(file);                        // Promise でも受け取れる
 * ```
 */
export function load(
  name: CharacterSource | LoadOptions,
  successCb?: (agent: Agent) => void,
  failCb?: (error: unknown) => void,
  path?: string,
): Promise<Agent> {
  const options: LoadOptions = isLoadOptions(name) ? name : { name, successCb, failCb, path };
  const promise = (async () => {
    const data = await toArrayBuffer(options.name, options.path ?? msagent.BASE_PATH);
    const container = options.selector ? (document.querySelector<HTMLElement>(options.selector) ?? undefined) : options.container;
    return new Agent(parseCharacter(data), { ...options, container });
  })();
  if (options.successCb || options.failCb) promise.then(options.successCb, options.failCb ?? ((e) => console.error(e)));
  return promise;
}

/** clippy.js の clippy オブジェクトと同じ形 (<script> で読み込むと window.msagent になる) */
export const msagent = {
  /** 名前だけで load() したときに、前に付ける場所 (例: "/agents/") */
  BASE_PATH: "",
  load,
  Agent,
  /** 全キャラクターの音の設定と状態 (本家の AudioOutput) */
  audioOutput,
};
