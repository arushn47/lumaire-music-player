import { expect, it } from "vitest";
import { resolveKuromojiDictDir, KUROMOJI_DICT_FILES } from "lyric-romanizer/dict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { romanizeForeignLocally } from "./foreign-romanization-engine";

it("uses local engines for ten common non-Indic languages and preserves Latin text", async () => {
  const lines = ["你好", "안녕하세요", "Привет", "Привіт", "Καλημέρα", "مرحبا", "שלום", "سلام", "สวัสดี", "Hello café!"];
  const values = await romanizeForeignLocally(lines);
  expect(values[0]).toBe("nǐ hǎo");
  expect(values[1]).toBe("annyeonghaseyo");
  expect(values[2]).toBe("Privet");
  expect(values[3]).toBe("Pryvit");
  for (let index = 0; index < 9; index++) {
    expect(values[index]).not.toBe(lines[index]);
    expect(values[index]).toMatch(/[A-Za-z]/);
    expect(values[index]).not.toMatch(/[\u0370-\u052f\u0590-\u08ff\u0e00-\u0e7f\u3400-\u9fff\uac00-\ud7af]/);
  }
  expect(values[9]).toBe("Hello café!");
});

it("uses the bundled Japanese dictionary for kanji readings rather than Chinese fallback", async () => {
  const dir = resolveKuromojiDictDir();
  for (const file of KUROMOJI_DICT_FILES) expect(existsSync(join(dir, file))).toBe(true);
  const lines = await romanizeForeignLocally(["日本語です", "君", "Hello!"], true, dir);
  expect(lines[0]).toMatch(/nihongo/i);
  expect(lines[1]).toMatch(/kimi/i);
  expect(lines[2]).toBe("Hello!");
}, 60000);
