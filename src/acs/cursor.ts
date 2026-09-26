export interface Location {
  offset: number;
  size: number;
}

/** リトルエンディアンのバイト列を、先頭から順に読む */
export class Cursor {
  private readonly view: DataView;
  pos: number;
  /**
   * @param nulTerminated 文字列の後ろに終端の NUL (2 バイト) があるか。ACS はある (文字数 > 0 のとき)、ACF / ACA は無い
   */
  constructor(
    readonly buf: ArrayBuffer,
    pos = 0,
    private readonly nulTerminated = true,
  ) {
    this.view = new DataView(buf);
    this.pos = pos;
  }
  u8() {
    return this.view.getUint8(this.pos++);
  }
  u16() {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16() {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32() {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n: number) {
    this.pos += n;
  }
  bytes(n: number) {
    const v = new Uint8Array(this.buf, this.pos, n);
    this.pos += n;
    return v;
  }
  /** GUID ("{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}" の形) */
  guid(): string {
    const hex = (v: number, n: number) => v.toString(16).padStart(n, "0");
    const d1 = hex(this.u32(), 8),
      d2 = hex(this.u16(), 4),
      d3 = hex(this.u16(), 4);
    const d4 = [...this.bytes(8)].map((b) => hex(b, 2)).join("");
    return `{${d1}-${d2}-${d3}-${d4.slice(0, 4)}-${d4.slice(4)}}`.toUpperCase();
  }
  location(): Location {
    return { offset: this.u32(), size: this.u32() };
  }
  /** DWORD 文字数 + UTF-16LE (nulTerminated なら、文字数 > 0 のとき終端 NUL 付き) */
  string(): string {
    const len = this.u32();
    if (len === 0) return "";
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(this.u16());
    if (this.nulTerminated) this.skip(2);
    return s;
  }
}
