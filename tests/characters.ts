import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "@playwright/test";

/**
 * テストで使うキャラクターファイル。同梱していないので、置き場所を環境変数 MSAGENT_CHARACTERS に書く
 * (複数なら、Windows は ; で、Mac / Linux は : で区切る)。ファイル名の大文字小文字は問わない
 */
export const CHARACTERS = {
  merlin: "Merlin.acs",
  finfin: "finfin.acs",
  clippit: "CLIPPIT.ACS",
  kairu: "DOLPHIN.ACS",
  rocky: "ROCKY.act",
  kairuAct: "dolphin.act",
  genie: "Genie.acf",
  robby: "robby.acf",
  /** Genie.acf のアニメーション */
  genieShow: "Show.aca",
  genieGreet: "Greet.aca",
  /** Merlin のアニメーション (Merlin.acf は無い。Genie.acf とはチェックサムが合わない) */
  merlinGestureUp: "GestureUp.aca",
} as const;

const dirs = (process.env.MSAGENT_CHARACTERS ?? "").split(delimiter).filter((d) => d && existsSync(d));

/** キャラクターファイルの場所 (無ければ undefined) */
export function characterPath(name: string): string | undefined {
  for (const dir of dirs) {
    const found = readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase());
    if (found) return join(dir, found);
  }
  return undefined;
}

/** キャラクターファイルの中身 (ArrayBuffer) */
export function readCharacter(name: string): ArrayBuffer {
  const file = readFileSync(characterPath(name)!);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** 使うキャラクターファイルが無ければ、このテストを飛ばす */
export function requireCharacters(...names: string[]) {
  const missing = names.filter((n) => !characterPath(n));
  test.skip(
    missing.length > 0,
    `キャラクターファイルがありません: ${missing.join(", ")} (MSAGENT_CHARACTERS に置き場所を書く)`,
  );
}
