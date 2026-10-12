import { describe, expect, it } from "vitest";

import { applyEdit } from "../src/github-edit";

describe("applyEdit", () => {
  it("replaces a single match", () => {
    expect(applyEdit("a b c", "b", "X")).toEqual({ content: "a X c", replacements: 1 });
  });

  it("matches across newlines exactly", () => {
    expect(applyEdit("one\ntwo\nthree\n", "two\nthree", "2\n3").content).toBe("one\n2\n3\n");
  });

  it("refuses when the text is missing", () => {
    expect(() => applyEdit("a b c", "z", "X")).toThrow(/not found/);
  });

  it("refuses several matches unless replace_all", () => {
    expect(() => applyEdit("a b a", "a", "X")).toThrow(/matches 2 places/);
    expect(applyEdit("a b a", "a", "X", true)).toEqual({ content: "X b X", replacements: 2 });
  });

  it("treats $ patterns in the new text as plain text", () => {
    expect(applyEdit("price: N", "N", "$& $1 $$").content).toBe("price: $& $1 $$");
  });

  it("can delete text with an empty new_text", () => {
    expect(applyEdit("keep drop keep", " drop", "").content).toBe("keep keep");
  });

  it("refuses an empty or unchanged old_text", () => {
    expect(() => applyEdit("abc", "", "X")).toThrow(/required/);
    expect(() => applyEdit("abc", "b", "b")).toThrow(/identical/);
  });
});
