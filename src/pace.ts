/** 少しずつ出すときに、文字を足す間隔 (ms) */
const TICK_MS = 60;
/** 単語として続けて出す文字 (空白で区切る言葉) */
const WORD_CHAR = /[A-Za-z0-9'-]/;
/** 前の文字と一緒に出す文字 (句読点・閉じ括弧など。「こんにちは」と「！」の間で止まらないように) */
const TRAILING = /[\p{Pe}\p{Pf}\p{Po}]/u;

/**
 * 文の end 文字目 (UTF-16 の位置) までを出すとき、その後ろに続く句読点・閉じ括弧 (！。、」… など) も含めた位置
 */
export function withTrailingPunctuation(text: string, end: number): number {
  while (end > 0 && end < text.length && TRAILING.test(text[end]!)) end++;
  return end;
}

/**
 * 吹き出しの文を、durationMs かけて少しずつ出す (吹き出しの autoPace)。
 * onProgress には、出した部分と、その文字数を渡す。wholeWords なら英語などの単語の途中で切らない。
 * すぐ最初の分を出し、止める関数を返す
 */
export function paceText(
  text: string,
  durationMs: number,
  onProgress: (shown: string, count: number) => void,
  options: { wholeWords?: boolean } = {},
): () => void {
  const chars = [...text];
  const start = performance.now();
  let shown = -1;
  let timer: number | undefined;
  const tick = () => {
    const t = Math.min(1, (performance.now() - start) / Math.max(1, durationMs));
    let n = Math.ceil(chars.length * t);
    if (options.wholeWords) {
      while (n < chars.length && WORD_CHAR.test(chars[n - 1] ?? "") && WORD_CHAR.test(chars[n]!)) n++;
    }
    while (n > 0 && n < chars.length && TRAILING.test(chars[n]!)) n++;
    if (n !== shown) {
      shown = n;
      onProgress(chars.slice(0, n).join(""), n);
    }
    if (n < chars.length) timer = window.setTimeout(tick, TICK_MS);
  };
  tick();
  return () => window.clearTimeout(timer);
}
