/** キャラクターから離す距離 (px) */
const GAP = 6;

/**
 * 聞き取りのヒント (本家の Listening Tip)。キャラクターの下に、2 行で出す小さな表示 (.msagent-listening-tip)。
 * 1 行目 (真ん中寄せ) は聞いているか、2 行目は何を聞いているか・何が聞こえたか
 */
export class ListeningTip {
  readonly element: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly body: HTMLDivElement;

  constructor(private readonly target: HTMLElement) {
    this.element = document.createElement("div");
    this.element.className = "msagent-listening-tip";
    this.element.setAttribute("role", "status");
    this.element.style.display = "none";
    this.title = document.createElement("div");
    this.title.className = "msagent-listening-tip-title";
    this.body = document.createElement("div");
    this.body.className = "msagent-listening-tip-body";
    this.element.append(this.title, this.body);
  }

  get visible(): boolean {
    return this.element.style.display !== "none";
  }

  /** 1 行目と 2 行目の文 */
  get text(): [string, string] {
    return [this.title.textContent ?? "", this.body.textContent ?? ""];
  }

  show(title: string, body: string) {
    this.title.textContent = title;
    this.body.textContent = body;
    this.element.style.display = "block";
    this.reposition();
  }

  hide() {
    this.element.style.display = "none";
  }

  /** キャラクターの下 (はみ出すなら上) に、画面からはみ出さないように置く */
  reposition() {
    if (!this.visible) return;
    const a = this.target.getBoundingClientRect();
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const top = a.bottom + GAP + h <= vh ? a.bottom + GAP : a.top - GAP - h;
    this.element.style.left = `${Math.max(0, Math.min(a.left + a.width / 2 - w / 2, vw - w))}px`;
    this.element.style.top = `${Math.max(0, Math.min(top, vh - h))}px`;
  }
}
