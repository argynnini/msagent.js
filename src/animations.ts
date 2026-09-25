import type { Frame } from "./acs/reader";
import type { Character } from "./character";
import { isIdleAnimation } from "./idle";

/** animate() で選ばないもの (待機動作や登場・退場の状態のほかに) */
const NOT_FOR_ANIMATE = /^(Show|Hide|RestPose)$/i;

/** 大文字小文字を問わず、実在するアニメーション名に直す (無ければ undefined) */
export function findAnimation(character: Character, name: string): string | undefined {
  if (character.animations.has(name)) return name;
  const lower = name.toLowerCase();
  for (const key of character.animations.keys()) if (key.toLowerCase() === lower) return key;
  return undefined;
}

/**
 * 状態 (Showing / MovingLeft など) に割り当てられたアニメーションから 1 つ選ぶ (複数あればランダム。本家と同じ)。
 * 割り当てが無ければ、名前の候補から実在するもの
 */
export function stateAnimation(character: Character, state: string, fallbacks: readonly string[]): string | undefined {
  const assigned = character.stateAnimations(state).filter((n) => character.animations.has(n));
  if (assigned.length > 0) return assigned[Math.floor(Math.random() * assigned.length)];
  for (const name of fallbacks) {
    const found = findAnimation(character, name);
    if (found) return found;
  }
  return undefined;
}

/** しゃべるとき用のアニメーション (Speaking の状態、無ければ RestPose)。口の画像があるものだけ */
export function speakingAnimation(character: Character): string | undefined {
  const candidates = [...character.stateAnimations("Speaking"), "RestPose"];
  return candidates
    .map((n) => findAnimation(character, n))
    .find((n) => n !== undefined && character.animations.get(n)!.frames.some((f) => f.overlays.length > 0));
}

/** 止まっているときの絵のコマ (RestPose、無ければ登場のアニメーションの最後のコマ、それも無ければ最初のアニメーションの最初のコマ) */
export function restFrame(character: Character): Frame | undefined {
  const rest = character.animations.get(findAnimation(character, "RestPose") ?? "");
  const show = character.animations.get(stateAnimation(character, "Showing", ["Show"]) ?? "");
  return rest?.frames[0] ?? show?.frames.at(-1) ?? character.animations.values().next().value?.frames[0];
}

/** animate() で選べるアニメーション (待機動作・登場・退場などを除く) */
export function animateCandidates(character: Character): string[] {
  const transitions = new Set([...character.stateAnimations("Showing"), ...character.stateAnimations("Hiding")]);
  return [...character.animations.keys()].filter(
    (n) => !isIdleAnimation(character, n) && !NOT_FOR_ANIMATE.test(n) && !transitions.has(n),
  );
}
