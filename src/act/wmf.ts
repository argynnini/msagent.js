import type { AcsImage } from "../acs/reader";

/**
 * Windows メタファイル (WMF、プレースブル形式) を canvas に描いて RGBA にする。
 * Office 97 のアシスタント (ACT) のベクター画像の部品を描くためのもので、実際に使われている記録だけに対応する
 * (多角形・折れ線・楕円・長方形と、ペン・ブラシ。描画モードは常に上書き (R2_COPYPEN))。ブラウザ専用
 */

/** プレースブル WMF の識別子 (先頭 4 バイト) */
export const WMF_PLACEABLE_KEY = 0x9ac6cdd7;
const PLACEABLE_HEADER_SIZE = 22;
const META_HEADER_SIZE = 18;

const META_EOF = 0x0000;
const META_SETWINDOWORG = 0x020b;
const META_SETWINDOWEXT = 0x020c;
const META_SETPOLYFILLMODE = 0x0106;
const META_SAVEDC = 0x001e;
const META_RESTOREDC = 0x0127;
const META_CREATEPENINDIRECT = 0x02fa;
const META_CREATEBRUSHINDIRECT = 0x02fc;
const META_SELECTOBJECT = 0x012d;
const META_DELETEOBJECT = 0x01f0;
const META_POLYGON = 0x0324;
const META_POLYLINE = 0x0325;
const META_POLYPOLYGON = 0x0538;
const META_ELLIPSE = 0x0418;
const META_RECTANGLE = 0x041b;

const PS_NULL = 5;
const BS_NULL = 1;
const ALTERNATE = 1;

interface Pen { kind: "pen"; none: boolean; width: number; color: string }
interface Brush { kind: "brush"; none: boolean; color: string }
type GdiObject = Pen | Brush | undefined;

interface DcState {
  orgX: number;
  orgY: number;
  extX: number;
  extY: number;
  pen: Pen;
  brush: Brush;
  fillRule: CanvasFillRule;
}

/** COLORREF (0x00BBGGRR) → CSS の色 */
const colorRef = (v: DataView, at: number) => `rgb(${v.getUint8(at)},${v.getUint8(at + 1)},${v.getUint8(at + 2)})`;

/** WMF の外枠 (論理単位) の大きさ。読めなければ undefined */
export function wmfSize(data: Uint8Array): { width: number; height: number } | undefined {
  if (data.length < PLACEABLE_HEADER_SIZE) return undefined;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint32(0, true) !== WMF_PLACEABLE_KEY) return undefined;
  return { width: Math.abs(v.getInt16(10, true) - v.getInt16(6, true)), height: Math.abs(v.getInt16(12, true) - v.getInt16(8, true)) };
}

/** プレースブル WMF を width x height に拡大・縮小して描く */
export function renderWmf(data: Uint8Array, width: number, height: number): AcsImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const left = v.getInt16(6, true), top = v.getInt16(8, true), right = v.getInt16(10, true), bottom = v.getInt16(12, true);
  const numObjects = v.getUint16(PLACEABLE_HEADER_SIZE + 10, true);
  const objects: GdiObject[] = new Array(numObjects).fill(undefined);
  let dc: DcState = {
    orgX: left,
    orgY: top,
    extX: right - left || 1,
    extY: bottom - top || 1,
    pen: { kind: "pen", none: false, width: 0, color: "#000" },
    brush: { kind: "brush", none: false, color: "#fff" },
    fillRule: "evenodd",
  };
  const stack: DcState[] = [];

  // 論理座標 → canvas の画素
  const px = (x: number) => ((x - dc.orgX) * w) / dc.extX;
  const py = (y: number) => ((y - dc.orgY) * h) / dc.extY;
  const points = (at: number, count: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < count; i++) pts.push([px(v.getInt16(at + i * 4, true)), py(v.getInt16(at + i * 4 + 2, true))]);
    return pts;
  };
  const tracePath = (pts: [number, number][], close: boolean) => {
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    if (close) ctx.closePath();
  };
  const fillAndStroke = (fill: boolean) => {
    if (fill && !dc.brush.none) {
      ctx.fillStyle = dc.brush.color;
      ctx.fill(dc.fillRule);
    }
    if (!dc.pen.none) {
      ctx.strokeStyle = dc.pen.color;
      // 太さ 0 は、拡大・縮小に関わらず 1 画素
      ctx.lineWidth = dc.pen.width === 0 ? 1 : Math.max(1, (dc.pen.width * w) / Math.abs(dc.extX));
      ctx.stroke();
    }
  };

  let p = PLACEABLE_HEADER_SIZE + META_HEADER_SIZE;
  while (p + 6 <= data.length) {
    const size = v.getUint32(p, true) * 2;
    const fn = v.getUint16(p + 4, true);
    const a = p + 6; // 引数の先頭
    if (fn === META_EOF || size < 6) break;
    switch (fn) {
      case META_SETWINDOWORG:
        dc.orgY = v.getInt16(a, true);
        dc.orgX = v.getInt16(a + 2, true);
        break;
      case META_SETWINDOWEXT:
        dc.extY = v.getInt16(a, true) || 1;
        dc.extX = v.getInt16(a + 2, true) || 1;
        break;
      case META_SETPOLYFILLMODE:
        dc.fillRule = v.getUint16(a, true) === ALTERNATE ? "evenodd" : "nonzero";
        break;
      case META_SAVEDC:
        stack.push({ ...dc });
        break;
      case META_RESTOREDC:
        dc = stack.pop() ?? dc;
        break;
      case META_CREATEPENINDIRECT:
      case META_CREATEBRUSHINDIRECT: {
        const obj: GdiObject =
          fn === META_CREATEPENINDIRECT
            ? { kind: "pen", none: v.getUint16(a, true) === PS_NULL, width: v.getInt16(a + 2, true), color: colorRef(v, a + 6) }
            : { kind: "brush", none: v.getUint16(a, true) === BS_NULL, color: colorRef(v, a + 2) };
        // 空いている一番小さい番号に入る
        const slot = objects.findIndex((o) => o === undefined);
        if (slot >= 0) objects[slot] = obj;
        else objects.push(obj);
        break;
      }
      case META_SELECTOBJECT: {
        const obj = objects[v.getUint16(a, true)];
        if (obj?.kind === "pen") dc.pen = obj;
        else if (obj?.kind === "brush") dc.brush = obj;
        break;
      }
      case META_DELETEOBJECT:
        objects[v.getUint16(a, true)] = undefined;
        break;
      case META_POLYGON:
      case META_POLYLINE: {
        ctx.beginPath();
        tracePath(points(a + 2, v.getInt16(a, true)), fn === META_POLYGON);
        fillAndStroke(fn === META_POLYGON);
        break;
      }
      case META_POLYPOLYGON: {
        const n = v.getUint16(a, true);
        let at = a + 2 + n * 2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const count = v.getUint16(a + 2 + i * 2, true);
          tracePath(points(at, count), true);
          at += count * 4;
        }
        fillAndStroke(true);
        break;
      }
      case META_ELLIPSE:
      case META_RECTANGLE: {
        // 引数は bottom, right, top, left の順
        const b = py(v.getInt16(a, true)), r = px(v.getInt16(a + 2, true)), t = py(v.getInt16(a + 4, true)), l = px(v.getInt16(a + 6, true));
        ctx.beginPath();
        if (fn === META_ELLIPSE) ctx.ellipse((l + r) / 2, (t + b) / 2, Math.abs(r - l) / 2, Math.abs(b - t) / 2, 0, 0, Math.PI * 2);
        else ctx.rect(l, t, r - l, b - t);
        fillAndStroke(true);
        break;
      }
      // SETMAPMODE / SETROP2 / SETBKMODE / SETBKCOLOR / SETTEXTCOLOR などは、描く結果に影響しないので無視する
    }
    p += size;
  }

  const rgba = ctx.getImageData(0, 0, w, h).data;
  return { width: w, height: h, rgba: new Uint8ClampedArray(rgba) };
}
