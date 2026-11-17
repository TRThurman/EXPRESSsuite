import { describe, expect, it } from "vitest";
import { applyCleanups, ASCII_REPLACEMENTS, CleanupId, findCleanups } from "../shared/description-cleanup.js";

const pick = (text: string, id: CleanupId) => findCleanups(text).filter((c) => c.id === id);
const only = (id: CleanupId) => new Set<CleanupId>([id]);

describe("description-cleanup", () => {
  it("comment-markers removes -- on each line and the (* *) pair", () => {
    expect(applyCleanups("-- First line.\n-- Second line.", only("comment-markers"))).toBe("First line.\nSecond line.");
    expect(applyCleanups("(* A remark. *)", only("comment-markers"))).toBe("A remark.");
    expect(applyCleanups("(* Line one.\n   Line two. *)", only("comment-markers"))).toBe("Line one.\n   Line two.");
    expect(pick("-- a\n-- b", "comment-markers")).toEqual([{ id: "comment-markers", label: "Remove 2 comment markers", count: 2 }]);
    expect(findCleanups("(* a *)")[0]).toMatchObject({ id: "comment-markers", count: 2 });
  });

  it("hyphenation joins a word split at a line end", () => {
    expect(applyCleanups("the speci-\nfication of", only("hyphenation"))).toBe("the specification of");
    expect(applyCleanups("the speci-\r\n  fication", only("hyphenation"))).toBe("the specification");
    expect(applyCleanups("a - b\nc", only("hyphenation"))).toBe("a - b\nc");
    expect(pick("speci-\nfication and in-\ndependent", "hyphenation")).toEqual([
      { id: "hyphenation", label: "Join 2 words split by a hyphen at a line end", count: 2 },
    ]);
  });

  it("hard-wraps turns a single newline into a space and keeps blank lines", () => {
    expect(applyCleanups("one\ntwo\nthree", only("hard-wraps"))).toBe("one two three");
    expect(applyCleanups("one\ntwo\n\nthree\nfour", only("hard-wraps"))).toBe("one two\n\nthree four");
    expect(applyCleanups("one\r\ntwo\r\n\r\nthree", only("hard-wraps"))).toBe("one two\r\n\r\nthree");
    expect(pick("one\ntwo\n\nthree\nfour", "hard-wraps")).toEqual([
      { id: "hard-wraps", label: "Join 2 hard-wrapped lines into paragraphs", count: 2 },
    ]);
  });

  it("ascii replaces typographic characters and leaves others", () => {
    const input = "\u2018a\u2019 \u201Cb\u201D c\u2013d\u2014e\u2026 \uFB01\uFB02\uFB00\uFB03\uFB04 x\u00A0y\u2009z\u202Fw \u00E9";
    expect(applyCleanups(input, only("ascii"))).toBe(
      "'a' \"b\" c-d-e... fiflffffiffl x y z w \u00E9",
    );
    expect(findCleanups("\u201Cx\u201D")).toEqual([
      { id: "ascii", label: "Replace 2 typographic characters with ASCII", count: 2 },
    ]);
    expect(findCleanups("caf\u00E9")).toEqual([]);
    expect(ASCII_REPLACEMENTS.get("\uFB03")).toBe("ffi");
  });

  it("returns no cleanups for clean text and leaves it unchanged", () => {
    const clean = "A plain sentence.\n\nAnother paragraph.";
    expect(findCleanups("")).toEqual([]);
    expect(findCleanups("A plain sentence.")).toEqual([]);
    expect(applyCleanups("A plain sentence.", new Set(["comment-markers", "hyphenation", "hard-wraps", "ascii"]))).toBe("A plain sentence.");
    expect(applyCleanups(clean, new Set())).toBe(clean);
  });

  it("applies all four in order", () => {
    const input = "(* \u201CThe speci-\r\nfication\u201D covers\r\n-- the parts\u2026\r\n\r\nNext\r\nparagraph. *)";
    const ids = findCleanups(input).map((c) => c.id);
    expect(ids).toEqual(["comment-markers", "hyphenation", "hard-wraps", "ascii"]);
    expect(applyCleanups(input, new Set(ids))).toBe(
      "\"The specification\" covers the parts...\r\n\r\nNext paragraph.",
    );
  });
});
