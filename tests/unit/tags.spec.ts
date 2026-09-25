import { expect, test } from "@playwright/test";
import { bookmarkNotifier, isRepeatTag, parseSpeechTags, plainSpeech, removeBookmarks, shownText, type SpeechPart } from "../../src/tags";

// 文の中の \ は、JavaScript の文字列では "\\" と書く

/** 部分を、比べやすい文字にする */
const describe = (parts: SpeechPart[]) =>
  parts.map((p) =>
    p.kind === "text"
      ? `text(${p.spoken}${p.spoken !== p.shown ? `→${p.shown}` : ""} r=${p.rate} p=${p.pitch} v=${p.volume.toFixed(2)})`
      : p.kind === "pause"
        ? `pause(${p.ms})`
        : `bookmark(${Number.isNaN(p.id) ? p.mark : p.id})`,
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

test("\\Emp\\ は次の言葉だけ、少しゆっくり・少し高く読む。\\Chr=Whisper\\ は小さい声 (Normal・\\Rst\\ で戻す)", () => {
  expect(describe(parseSpeechTags("This is \\Emp\\really great!"))).toEqual([
    "text(This is  r=1 p=1 v=1.00)",
    "text(really r=0.8 p=1.2 v=1.00)",
    "text( great! r=1 p=1 v=1.00)",
  ]);
  expect(describe(parseSpeechTags("\\Emp\\ずっと、待ってた"))).toEqual(["text(ずっと r=0.8 p=1.2 v=1.00)", "text(、待ってた r=1 p=1 v=1.00)"]);
  expect(describe(parseSpeechTags('a \\Chr="Whisper"\\secret \\Chr=Normal\\b \\Chr=whisper\\c \\Rst\\d'))).toEqual([
    "text(a  r=1 p=1 v=1.00)",
    "text(secret  r=1 p=1 v=0.35)",
    "text(b  r=1 p=1 v=1.00)",
    "text(c  r=1 p=1 v=0.35)",
    "text(d r=1 p=1 v=1.00)",
  ]);
});

test("吹き出しには Emp / Chr / Ctx のタグを出さず、知らないタグは文字のまま残す", () => {
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
  const notify = bookmarkNotifier(parseSpeechTags("ab\\Mrk=1\\cd\\Mrk=2\\ef\\Mrk=3\\"), (b) => fired.push(b.id));
  notify(1);
  expect(fired).toEqual([]);
  notify(2);
  expect(fired).toEqual([1]);
  notify(5);
  expect(fired).toEqual([1, 2]);
  notify(Infinity);
  expect(fired).toEqual([1, 2, 3]);
});

// --- SAPI 5 の XML のタグ ---

/** 言語・性別も含めた形 */
const withVoice = (parts: SpeechPart[]) =>
  parts.map((p) => (p.kind === "text" ? `${p.spoken}${p.spoken !== p.shown ? `→${p.shown}` : ""} ${p.lang ?? "-"} ${p.gender ?? "-"}` : p.kind));

test("SAPI 5: <rate> <pitch> <volume> は中身だけに効き、閉じたら元に戻る (入れ子も)", () => {
  const text = 'a <rate absspeed="10">fast <pitch absmiddle="-10">low</pitch> fast</rate> normal <volume level="50">quiet</volume>';
  expect(describe(parseSpeechTags(text))).toEqual([
    "text(a  r=1 p=1 v=1.00)",
    "text(fast  r=3 p=1 v=1.00)",
    "text(low r=3 p=0.5 v=1.00)",
    "text( fast r=3 p=1 v=1.00)",
    "text( normal  r=1 p=1 v=1.00)",
    "text(quiet r=1 p=1 v=0.50)",
  ]);
});

test("SAPI 5: speed / middle はいまの値から、absspeed / absmiddle は元の値から。閉じた形は囲んでいるタグが閉じるまで", () => {
  expect(brief(parseSpeechTags('<rate speed="10">x<rate speed="-10">y</rate></rate>z'))).toEqual(["text(x)", "text(y)", "text(z)"]);
  expect(describe(parseSpeechTags('<rate speed="10">x<rate speed="-10">y</rate></rate>z')).map((s) => s.match(/r=[\d.]+/)![0])).toEqual([
    "r=3",
    "r=1",
    "r=1",
  ]);
  expect(describe(parseSpeechTags('<volume level="50">a<rate absspeed="10"/>b</volume>c'))).toEqual([
    "text(a r=1 p=1 v=0.50)",
    "text(b r=3 p=1 v=0.50)",
    "text(c r=1 p=1 v=1.00)",
  ]);
  // キャラクターの声の速さ (base) と、\Spd\ で変えた速さの上に重なる
  expect(describe(parseSpeechTags('\\Spd=340\\<rate speed="-10">x</rate>y', { rate: 1, pitch: 1 }))).toEqual([
    "text(x r=0.6666666666666666 p=1 v=1.00)",
    "text(y r=2 p=1 v=1.00)",
  ]);
});

test("SAPI 5: <silence> は間、<bookmark> は目印 (数字でなければ id は NaN で、mark に名前)", () => {
  const parts = parseSpeechTags('Hi<silence msec="300"/>there<bookmark mark="7"/>x<bookmark mark="end"/>');
  expect(brief(parts)).toEqual(["text(Hi)", "pause(300)", "text(there)", "bookmark(7)", "text(x)", "bookmark(end)"]);
  const fired: { id: number; mark: string }[] = [];
  bookmarkNotifier(parts, (b) => fired.push(b))(Infinity);
  expect(fired).toEqual([{ id: 7, mark: "7" }, { id: NaN, mark: "end" }]);
});

test("SAPI 5: <emph> は中身を強調し、<spell> は 1 文字ずつ区切って読む (吹き出しはそのまま)", () => {
  expect(describe(parseSpeechTags("<emph>very big</emph> deal"))).toEqual(["text(very big r=0.8 p=1.2 v=1.00)", "text( deal r=1 p=1 v=1.00)"]);
  expect(brief(parseSpeechTags("Call <spell>ABC 12</spell> now"))).toEqual(["text(Call )", "text(A B C 1 2→ABC 12)", "text( now)"]);
});

test("SAPI 5: <lang> と <voice> で、中身の言語と声の性別を変える", () => {
  const parts = parseSpeechTags('a<lang langid="411">こんにちは</lang><voice required="Gender=Female;Language=409">hi</voice><voice optional="Gender=Male">b</voice>');
  expect(withVoice(parts)).toEqual(["a - -", "こんにちは ja-JP -", "hi en-US female", "b - male"]);
});

test("SAPI 5: ブラウザで効かないタグは取り除き、知らないタグは文字のまま。文字参照は SAPI 5 のタグがある文だけ戻す", () => {
  const parts = parseSpeechTags('<sapi><p><s><context id="date_mdy">1/2</context> <pron sym="h eh l ow">hello</pron> &lt;3 &amp; <b>x</b></s></p></sapi>');
  expect(shownText(parts)).toBe("1/2 hello <3 & <b>x</b>");
  // 取り除くだけのタグでは、文を区切らない
  expect(parts.filter((p) => p.kind === "text")).toHaveLength(1);
  // SAPI 5 のタグが無ければ、そのまま
  expect(shownText(parseSpeechTags("a &lt; b <3 <b>c</b>"))).toBe("a &lt; b <3 <b>c</b>");
});

test("SAPI 5: think 用 (目印だけ) では、<bookmark> 以外を取り除く。\Lst\ のために <bookmark> も取り除ける", () => {
  const parts = parseSpeechTags('<rate absspeed="5">Hmm<bookmark mark="3"/><silence msec="500"/></rate> ok', undefined, true);
  expect(describe(parts)).toEqual(["text(Hmm r=1 p=1 v=1.00)", "bookmark(3)", "text( ok r=1 p=1 v=1.00)"]);
  expect(removeBookmarks('One <bookmark mark="1"/>two <BOOKMARK mark="x" />three')).toBe("One two three");
});

test("SSML の <sub alias> は \Map\ と同じく、読みと表示を変える (alias が無ければ中身を読む)", () => {
  expect(brief(parseSpeechTags('Read <sub alias="World Wide Web">WWW</sub> now'))).toEqual(["text(Read )", "text(World Wide Web→WWW)", "text( now)"]);
  expect(brief(parseSpeechTags("<sub>as is</sub>"))).toEqual(["text(as is)"]);
  // 中にタグがあっても、alias は 1 回だけ読み、残りは表示だけ
  expect(brief(parseSpeechTags('<sub alias="ダブリュー">W<silence msec="100"/>W</sub>'))).toEqual(["text(ダブリュー→W)", "pause(100)", "text(→W)"]);
});

test("plainSpeech: タグを使わず、文をそのまま読んで出す", () => {
  const text = 'a \Pau=100\ <silence msec="100"/> &lt;';
  expect(plainSpeech(text, { rate: 2, pitch: 1 })).toEqual([{ kind: "text", spoken: text, shown: text, rate: 2, pitch: 1, volume: 1 }]);
  expect(plainSpeech("")).toEqual([]);
});

test("<map alias> は <sub alias> と同じ。<!-- コメント --> は取り除き、閉じていなければ文字のまま", () => {
  expect(brief(parseSpeechTags('<map alias="えいち・てぃー・えむ・える">HTML</map>です'))).toEqual(["text(えいち・てぃー・えむ・える→HTML)", "text(です)"]);
  const parts = parseSpeechTags("Hello <!-- 読まない\n2 行目 -->world <!-- 閉じていない");
  expect(parts).toHaveLength(1);
  expect(shownText(parts)).toBe("Hello world <!-- 閉じていない");
  // コメントだけの文でも取り除く。think 用 (目印だけ) でも取り除く
  expect(shownText(parseSpeechTags("a<!--x-->b"))).toBe("ab");
  expect(shownText(parseSpeechTags("a<!--x-->b", undefined, true))).toBe("ab");
});
