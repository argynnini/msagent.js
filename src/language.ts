/**
 * 言語の指定 (BCP 47 の "ja" / "en-US" / "zh-TW" など、または Windows の言語 ID の数値) と、
 * キャラクターファイルの言語 ID (Windows の LANGID) を突き合わせる
 */

/** 言語の指定。文字列は BCP 47 ("ja", "en-US")、数値は Windows の言語 ID (0x0411 など) */
export type Language = string | number;

/** BCP 47 の言語 → Windows の主言語 ID (LANGID の下位 10 ビット) */
const PRIMARY: Record<string, number> = {
  ar: 0x01, bg: 0x02, ca: 0x03, zh: 0x04, cs: 0x05, da: 0x06, de: 0x07, el: 0x08, en: 0x09, es: 0x0a,
  fi: 0x0b, fr: 0x0c, he: 0x0d, hu: 0x0e, is: 0x0f, it: 0x10, ja: 0x11, ko: 0x12, nl: 0x13, no: 0x14,
  nb: 0x14, nn: 0x14, pl: 0x15, pt: 0x16, ro: 0x18, ru: 0x19, hr: 0x1a, sr: 0x1a, bs: 0x1a, sk: 0x1b,
  sq: 0x1c, sv: 0x1d, th: 0x1e, tr: 0x1f, ur: 0x20, id: 0x21, uk: 0x22, be: 0x23, sl: 0x24, et: 0x25,
  lv: 0x26, lt: 0x27, fa: 0x29, vi: 0x2a, hy: 0x2b, az: 0x2c, eu: 0x2d, mk: 0x2f, af: 0x36, ka: 0x37,
  hi: 0x39, ms: 0x3e, kk: 0x3f, sw: 0x41, gl: 0x56,
};

/** 地域や文字で言語 ID が分かれるもの (中国語の繁体字・簡体字、ポルトガル語のブラジル・ポルトガル など) */
const FULL: Record<string, number> = {
  "zh-tw": 0x0404, "zh-hant": 0x0404, "zh-hk": 0x0c04, "zh-mo": 0x1404,
  "zh-cn": 0x0804, "zh-hans": 0x0804, "zh-sg": 0x1004,
  "pt-br": 0x0416, "pt-pt": 0x0816,
  "en-us": 0x0409, "en-gb": 0x0809, "en-au": 0x0c09, "en-ca": 0x1009,
  "es-es": 0x0c0a, "es-mx": 0x080a, "fr-fr": 0x040c, "fr-ca": 0x0c0c, "de-de": 0x0407, "ja-jp": 0x0411,
};

const primaryOf = (langId: number) => langId & 0x3ff;

/** 指定を言語 ID の候補にする: [完全に一致させたい ID (あれば), 主言語 ID] */
function parse(lang: Language): { full?: number; primary: number } | undefined {
  if (typeof lang === "number") return { full: lang > 0x3ff ? lang : undefined, primary: primaryOf(lang) };
  const parts = lang.toLowerCase().replace(/_/g, "-").split("-");
  const primary = PRIMARY[parts[0]!];
  if (primary === undefined) return undefined;
  for (const sub of parts.slice(1)) {
    const full = FULL[`${parts[0]}-${sub}`];
    if (full !== undefined) return { full, primary };
  }
  return { primary };
}

/** 既定の言語: ブラウザ (多くは OS) の言語の並び。取れなければ英語 */
export function defaultLanguages(): string[] {
  if (typeof navigator !== "undefined") {
    const list = navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
    if (list.length > 0) return [...list];
  }
  return ["en"];
}

/**
 * キャラクターファイルにある言語 ID (available) から、指定 (省略時はブラウザの言語) に一番合うものを選ぶ。
 * 完全に一致する ID → 同じ主言語 (標準の地域 → 主言語だけの ID → ほかの地域) → 次の候補の言語 → 英語 → 最初のもの
 */
export function pickLanguage(available: readonly number[], lang?: Language | readonly Language[]): number | undefined {
  if (available.length === 0) return undefined;
  const wanted = lang === undefined ? defaultLanguages() : Array.isArray(lang) ? lang : [lang as Language];
  for (const w of [...wanted, "en"]) {
    const p = parse(w);
    if (!p) continue;
    if (p.full !== undefined && available.includes(p.full)) return p.full;
    const same = available.filter((id) => primaryOf(id) === p.primary);
    if (same.length === 0) continue;
    // 同じ主言語が複数あれば、標準の地域 (サブ言語 1。例: 0x0411) → 主言語だけの ID (例: 0x0011) → ほかの地域
    return same.find((id) => id >> 10 === 1) ?? same.find((id) => id >> 10 === 0) ?? same[0];
  }
  return available[0];
}

/** 言語 ID → BCP 47 の言語 (分からなければ "x-langid-0411" のような形) */
export function languageTag(langId: number): string {
  for (const [tag, id] of Object.entries(FULL)) if (id === langId) return tag.replace(/-(\w+)$/, (_, r: string) => `-${r.length === 2 ? r.toUpperCase() : r[0]!.toUpperCase() + r.slice(1)}`);
  const primary = primaryOf(langId);
  for (const [tag, id] of Object.entries(PRIMARY)) if (id === primary) return tag;
  return `x-langid-${langId.toString(16).padStart(4, "0")}`;
}
