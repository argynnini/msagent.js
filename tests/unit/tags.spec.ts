import { expect, test } from "@playwright/test";
import { bookmarkNotifier, isRepeatTag, parseSpeechTags, removeBookmarks, shownText, type SpeechPart } from "../../src/tags";

// 文の中の \ は、JavaScript の文字列では "\\" と書く

/** 部分を、比べやすい文字にする */
const describe = (parts: SpeechPart[]) =>
  parts.map((p) =>
    p.kind === "text"
      ? `text(${p.spoken}${p.spoken !== p.shown ? `→${p.shown}` : ""} r=${p.rate} p=${p.pitch} v=${p.volume.toFixed(2)})`
      : p.kind === "pause"
        ? `pause(${p.ms})`
        : `bookmark(${p.id})`,
  );
/** 速さなどを除いた形 */
const brief = (parts: SpeechPart[]) => describe(parts).map((s) => s.replace(/ r=.*\)$/, ")"));

test("タグで区切り、速さ・高さ・音量・間・目印・読みと表示を分ける", () => {
  const text =
    'Hello \\Pau=300\\world. \\Spd=340\\Fast \\Pit=200\\high \\Vol=32768\\quiet \\Rst\\normal \\Mrk=7\\mark \\Map="spoken"="shown"\\ end';
  expect(describe(parseSpeechTags(text, { rate: 1, pitch: 1 }))).toEqual([
    "text(Hello  r=1 p=1 v=1.00)",
    "pause(300)",
    "text(world.  r=1 p=1 v=1.00)",
    "text(Fast  r=2 p=1 v=1.00)",
    "text(high  r=2 p=2 v=1.00)",
    "text(quiet  r=2 p=2 v=0.50)",
    "text(normal  r=1 p=1 v=1.00)",
    "bookmark(7)",
    "text(mark  r=1 p=1 v=1.00)",
    "text(spoken→shown r=1 p=1 v=1.00)",
    "text( end r=1 p=1 v=1.00)",
  ]);
});

test("ブラウザでできないタグ (Emp / Chr / Ctx) は取り除き、知らないタグは文字のまま残す", () => {
  const parts = parseSpeechTags('\\Emp\\big \\Chr="Whisper"\\voice \\Ctx="Address"\\here \\Unknown\\ end');
  expect(shownText(parts)).toBe("big voice here \\Unknown\\ end");
});

test("隣り合うタグと、\\\\ (\\ という文字)", () => {
  const parts = parseSpeechTags("Hi \\Pau=800\\\\Mrk=2\\there, back\\\\slash");
  expect(brief(parts)).toEqual(["text(Hi )", "pause(800)", "bookmark(2)", "text(there, back\\slash)"]);
});

test("大文字小文字を問わない", () => {
  expect(brief(parseSpeechTags("a\\PAU=100\\b\\mrk=3\\c"))).toEqual(["text(a)", "pause(100)", "text(b)", "bookmark(3)", "text(c)"]);
});

test("think 用 (目印だけ): ほかのタグは取り除く", () => {
  const parts = parseSpeechTags("Hmm \\Mrk=3\\\\Pau=500\\ok \\Spd=50\\done", undefined, true);
  expect(brief(parts)).toEqual(["text(Hmm )", "bookmark(3)", "text(ok done)"]);
});

test("Lst: 直前の発言を繰り返すタグだけの文か。繰り返すときは目印を除く", () => {
  expect(isRepeatTag("\\Lst\\")).toBe(true);
  expect(isRepeatTag("  \\lst\\  ")).toBe(true);
  expect(isRepeatTag("\\Lst\\ and more")).toBe(false);
  expect(removeBookmarks("One \\Mrk=1\\two \\mrk=2\\three")).toBe("One two three");
});

test("目印は、吹き出しに出した文字数に合わせて知らせる", () => {
  const fired: number[] = [];
  const notify = bookmarkNotifier(parseSpeechTags("ab\\Mrk=1\\cd\\Mrk=2\\ef\\Mrk=3\\"), (id) => fired.push(id));
  notify(1);
  expect(fired).toEqual([]);
  notify(2);
  expect(fired).toEqual([1]);
  notify(5);
  expect(fired).toEqual([1, 2]);
  notify(Infinity);
  expect(fired).toEqual([1, 2, 3]);
});
