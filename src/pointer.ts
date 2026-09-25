import { pointerDetail, type PointerDetail } from "./events";

/** ドラッグとみなすまでの動き (px)。これより小さければクリック */
const DRAG_THRESHOLD = 3;

/** キャラクターの要素のマウス・タッチの操作を受ける側 (Agent) */
export interface PointerHost {
  readonly element: HTMLElement;
  /** 画面上の位置に、キャラクターの絵があるか */
  hitTest(clientX: number, clientY: number): boolean;
  /** キャラクターの左上の位置と、そこへ動かすこと (画面からはみ出さないように) */
  position(): { x: number; y: number };
  setPosition(x: number, y: number): void;
  /** 絵の部分を押した (手前に出す・出したままの吹き出しを閉じるなど) */
  grab(): void;
  click(detail: PointerDetail): void;
  dblclick(detail: PointerDetail): void;
  contextmenu(e: MouseEvent): void;
  /** ドラッグで動かし始めた / 動かし終えた */
  dragstart(): void;
  dragend(): void;
  /** ヘルプモードか (押されたら、クリックやドラッグの代わりに help() を呼ぶ) */
  helpMode(): boolean;
  help(): void;
  /** イベントを受け取る (後片付けで外す) */
  listen(target: EventTarget, type: string, handler: (e: Event) => void, options?: boolean | AddEventListenerOptions): void;
}

/**
 * キャラクターの要素のマウス・タッチの操作をつなぐ。
 * - 透明な部分は押せない (下のページに通す)。要素はふだん pointer-events: none で、ポインターが絵の上にあるときだけ
 *   .msagent-hit で押せるようにする
 * - 絵の部分をつかむとドラッグで動かせる。タッチは押すまで位置が分からないので、押した時点で絵の上なら、そのままドラッグを始める
 * - 左・中・右ボタンのクリックとダブルクリック (ドラッグの後のクリックは除く)
 */
export function attachPointerInput(host: PointerHost) {
  const { element } = host;
  /** つかんだ位置 (キャラクターの左上から) と、つかんだ画面上の位置 */
  let grab: { dx: number; dy: number; x: number; y: number } | undefined;
  let dragging = false;
  /** ドラッグの後に来る click は、クリックとして扱わない */
  let suppressClick = false;
  /** ヘルプモードで押した: その押して離す操作は、クリックとして扱わない */
  let helpPress = false;
  const setHit = (hit: boolean) => element.classList.toggle("msagent-hit", hit);

  host.listen(
    document,
    "pointermove",
    (e) => {
      const ev = e as PointerEvent;
      if (!grab) return void setHit(host.hitTest(ev.clientX, ev.clientY));
      if (!dragging && Math.hypot(ev.clientX - grab.x, ev.clientY - grab.y) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        host.dragstart();
      }
      host.setPosition(ev.clientX - grab.dx, ev.clientY - grab.dy);
    },
    true,
  );
  host.listen(
    document,
    "pointerdown",
    (e) => {
      const ev = e as PointerEvent;
      // ヘルプモード: 左・中ボタンで押したら、つかまずにヘルプを知らせる (本家と同じ)
      if ((ev.button === 0 || ev.button === 1) && host.helpMode() && host.hitTest(ev.clientX, ev.clientY)) {
        ev.preventDefault();
        helpPress = true;
        host.help();
        return;
      }
      if (ev.button !== 0 || !host.hitTest(ev.clientX, ev.clientY)) return;
      setHit(true);
      host.grab();
      const { x, y } = host.position();
      grab = { dx: ev.clientX - x, dy: ev.clientY - y, x: ev.clientX, y: ev.clientY };
      dragging = false;
      element.setPointerCapture(ev.pointerId);
      // 文字の選択や、画像のドラッグを始めない
      ev.preventDefault();
    },
    true,
  );
  // タッチで絵をつかんだときは、ページをスクロールさせない
  host.listen(
    document,
    "touchstart",
    (e) => {
      const touch = (e as TouchEvent).touches[0];
      if (touch && host.hitTest(touch.clientX, touch.clientY)) e.preventDefault();
    },
    { capture: true, passive: false },
  );
  const end = () => {
    if (!grab) return;
    grab = undefined;
    if (!dragging) return;
    dragging = false;
    suppressClick = true;
    // click はこの後すぐに来る (来なければ、次の操作までに戻しておく)
    window.setTimeout(() => (suppressClick = false), 0);
    host.dragend();
  };
  host.listen(element, "pointerup", end);
  // ヘルプモードで押した操作の click / dblclick が済んだら戻す
  host.listen(
    document,
    "pointerup",
    () => {
      if (helpPress) window.setTimeout(() => (helpPress = false), 0);
    },
    true,
  );
  host.listen(element, "pointercancel", end);
  host.listen(element, "lostpointercapture", end);

  host.listen(element, "click", (e) => {
    if (suppressClick || helpPress) {
      suppressClick = false;
      e.stopPropagation();
      return;
    }
    host.click(pointerDetail(e as MouseEvent));
  });
  host.listen(element, "dblclick", (e) => {
    if (!helpPress) host.dblclick(pointerDetail(e as MouseEvent));
  });
  // 中ボタンは auxclick が来ないブラウザがあるので、絵の上で押して離したことで見る
  let middleDown = false;
  host.listen(element, "pointerdown", (e) => {
    if ((e as PointerEvent).button === 1) middleDown = true;
  });
  host.listen(element, "pointerup", (e) => {
    const ev = e as PointerEvent;
    if (ev.button !== 1 || !middleDown) return;
    middleDown = false;
    if (helpPress) return;
    if (host.hitTest(ev.clientX, ev.clientY)) host.click(pointerDetail(ev));
  });
  host.listen(element, "contextmenu", (e) => host.contextmenu(e as MouseEvent));
}
