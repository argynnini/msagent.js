import type { BalloonStyle } from "./character";

/** 吹き出しを出す向き (clippy.js と同じ名前。例: top-left = キャラクターの左上) */
type Side = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const SIDES: Side[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** 吹き出しのしっぽの大きさの分だけ、キャラクターから離す */
const TIP_GAP = 8;
/** しっぽの中心から、吹き出しの端までの距離 (CSS の .msagent-tip の位置と合わせる) */
const TIP_INSET = 30;

/**
 * キャラクターの吹き出し (.msagent-balloon の中に、しっぽ .msagent-tip と、文 .msagent-content)
 */
export class Balloon {
  readonly element: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private side: Side | undefined;

  constructor(
    private readonly target: HTMLElement,
    style?: BalloonStyle,
  ) {
    this.element = document.createElement("div");
    this.element.className = "msagent-balloon";
    this.element.style.display = "none";
    const tip = document.createElement("div");
    tip.className = "msagent-tip";
    this.content = document.createElement("div");
    this.content.className = "msagent-content";
    this.element.append(tip, this.content);
    if (style) this.applyStyle(style);
  }

  /**
   * キャラクターファイルの吹き出しの設定を、CSS 変数として入れる。
   * 幅は「1 行の文字数」から決める (半角の平均の幅をおよそ 0.55 文字分とみなす)
   */
  private applyStyle(style: BalloonStyle) {
    const s = this.element.style;
    s.setProperty("--msagent-balloon-foreground", style.foreground);
    s.setProperty("--msagent-balloon-background", style.background);
    s.setProperty("--msagent-balloon-border", style.border);
    // MS Sans Serif はブラウザには無いことが多いので、Windows の後継の Microsoft Sans Serif も続ける (styles.ts)
    s.setProperty("--msagent-balloon-font", JSON.stringify(style.fontFamily));
    s.setProperty("--msagent-balloon-font-size", `${style.fontSize}px`);
    s.setProperty("--msagent-balloon-font-weight", String(style.fontWeight));
    s.setProperty("--msagent-balloon-font-style", style.italic ? "italic" : "normal");
    if (style.charsPerLine > 0) {
      s.setProperty("--msagent-balloon-width", `${Math.round(style.charsPerLine * style.fontSize * 0.55)}px`);
    }
  }

  get visible(): boolean {
    return this.element.style.display !== "none";
  }

  show() {
    this.element.style.display = "block";
    this.reposition();
  }

  hide() {
    this.element.style.display = "none";
  }

  setText(text: string) {
    this.content.textContent = text;
    if (this.visible) this.reposition();
  }

  /** キャラクターの周りで、画面からはみ出さない向きに置く (どこもはみ出すなら、最初の向きで画面内に寄せる) */
  reposition() {
    if (!this.visible) return;
    const a = this.target.getBoundingClientRect();
    const w = this.element.offsetWidth;
    const h = this.element.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const cx = a.left + a.width / 2;
    const place = (side: Side) => ({
      left: side.endsWith("left") ? cx - w + TIP_INSET : cx - TIP_INSET,
      top: side.startsWith("top") ? a.top - h - TIP_GAP : a.bottom + TIP_GAP,
    });
    const fits = ({ left, top }: { left: number; top: number }) => left >= 0 && top >= 0 && left + w <= vw && top + h <= vh;
    const side = SIDES.find((s) => fits(place(s))) ?? SIDES[0]!;
    const pos = place(side);
    if (this.side !== side) {
      if (this.side) this.element.classList.remove(`msagent-${this.side}`);
      this.element.classList.add(`msagent-${side}`);
      this.side = side;
    }
    this.element.style.left = `${Math.max(0, Math.min(pos.left, vw - w))}px`;
    this.element.style.top = `${Math.max(0, Math.min(pos.top, vh - h))}px`;
  }
}
