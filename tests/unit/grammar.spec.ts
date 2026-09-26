import { expect, test } from "@playwright/test";
import { AgentCommands } from "../../src/commands";
import { compileVoiceGrammar, GrammarError, normalizeSpeech } from "../../src/grammar";

/** 文法に合う文・合わない文を確かめる */
function check(grammar: string, yes: string[], no: string[]) {
  const match = compileVoiceGrammar(grammar);
  for (const s of yes) expect(match(s), `${grammar} ← "${s}"`).toBe(true);
  for (const s of no) expect(match(s), `${grammar} ← "${s}"`).toBe(false);
}

test("[ ] は省いてよい言葉、( | ) はどれか 1 つ", () => {
  check("(hello [there] | hi)", ["hello", "Hello there", "hi"], ["there", "hello hi", "hi there"]);
});

test("* は 0 回以上、+ は 1 回以上。直前の言葉だけに付く", () => {
  check("please* try this", ["try this", "please try this", "please please try this"], ["please"]);
  check("please+ try this", ["please try this", "please please try this"], ["try this"]);
  check("New York+", ["New York", "New York York"], ["New York New York"]);
  check("(New York)+", ["New York", "New York New York"], ["York"]);
});

test("... は何を言ってもよいところ。言葉の途中では切らない", () => {
  check(
    "[...] check mail [...]",
    ["check mail", "please check mail", "check mail please", "could you check mail now"],
    ["precheck mail", "check mailbox", "check the mail"],
  );
});

test("表示\\読み: どちらで聞き取っても合う。# で始まる読み (IPA) は使わない", () => {
  check("1st\\first place", ["1st place", "first place"], ["second place"]);
  check("tomato\\#təˈmeɪtoʊ", ["tomato"], []);
});

test("日本語: かな\\漢字、全角半角・カタカナとひらがな・空白・句読点の違いを気にしない", () => {
  check("けんさく\\検索 [して] [...]", ["検索", "けんさくして", "ケンサク して", "検索してください。"], ["検査"]);
  check("メール​を​見る", ["メールを見る", "めーる を 見る", "ﾒｰﾙを見る"], ["メールを読む"]);
});

test("大文字小文字・記号の違いを気にしない", () => {
  check("I'd like (cheese | pepperoni | and)+", ["I'd like cheese and pepperoni!", "id like cheese"], ["I'd like"]);
  expect(normalizeSpeech("  Hello,  WORLD!! ")).toBe("hello world");
  expect(normalizeSpeech("カタカナ")).toBe("かたかな");
});

test("括弧が合わない文法は GrammarError", () => {
  expect(() => compileVoiceGrammar("(hello | hi")).toThrow(GrammarError);
  expect(() => compileVoiceGrammar("hello]")).toThrow(GrammarError);
  expect(() => compileVoiceGrammar("* hello")).toThrow(GrammarError);
});

test("matchVoice: 候補の順に、合ったコマンドを最大 3 つ。選べない項目・voice の無い項目は使わない", () => {
  const commands = new AgentCommands();
  commands.add("search", "検索", { voice: "[please] (search | find) [...]" });
  commands.add("find", "探す", { voice: "find [...]" });
  commands.add("off", "使えない", { voice: "search", enabled: false });
  commands.add("menuOnly", "メニューだけ");
  const matches = commands.matchVoice(
    [
      { transcript: "find my file", confidence: 0.9 },
      { transcript: "fine my file", confidence: 0.4 },
      { transcript: "search", confidence: 0.3 },
    ],
    [{ id: "hide", voice: "hide" }],
  );
  expect(matches.map(({ name, confidence, voice }) => [name, confidence, voice])).toEqual([
    ["search", 90, "find my file"],
    ["find", 90, "find my file"],
    ["search", 30, "search"],
  ]);
  // msagent.js が用意したコマンドは name が ""。globalVoiceCommandsEnabled = false なら使わない
  expect(commands.matchVoice([{ transcript: "hide", confidence: 1 }], [{ id: "hide", voice: "hide" }])).toMatchObject([
    { name: "", global: "hide" },
  ]);
  commands.globalVoiceCommandsEnabled = false;
  expect(commands.matchVoice([{ transcript: "hide", confidence: 1 }], [{ id: "hide", voice: "hide" }])).toEqual([]);
});
