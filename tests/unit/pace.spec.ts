import { expect, test } from "@playwright/test";
import { withTrailingPunctuation } from "../../src/pace";

test("withTrailingPunctuation: 言葉の後ろの句読点・閉じ括弧も一緒に出す", () => {
  const cut = (text: string, end: number) => text.slice(0, withTrailingPunctuation(text, end));
  expect(cut("こんにちは！元気？", 5)).toBe("こんにちは！");
  expect(cut("「こんにちは」。次", 6)).toBe("「こんにちは」。");
  expect(cut("Hello, world!", 5)).toBe("Hello,");
  expect(cut("Hello, world!", 12)).toBe("Hello, world!");
  // 空白や、次の言葉の始まりの括弧は含めない
  expect(cut("Hello world", 5)).toBe("Hello");
  expect(cut("はい「次」", 2)).toBe("はい");
  expect(cut("！", 0)).toBe("");
});
