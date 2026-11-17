import { describe, expect, test } from "vitest";
import { classifyLines, findBlockMacros, listMarkerOf } from "../language/annotation/asciidoc-lines.js";

const kinds = (text: string): string[] => classifyLines(text).map((l) => l.kind);

describe("AsciiDoc line classifier: list markers", () => {
  const cases: [string, string, number][] = [
    ["* item", "bullet", 1],
    ["***** item", "bullet", 5],
    ["- item", "dash", 1],
    [". item", "ordered", 1],
    [".... item", "ordered", 4],
    ["1. item", "number", 1],
    ["12) item", "number", 1],
    ["a. item", "alpha", 1],
    ["A. item", "alpha", 1],
    ["i) item", "roman", 1],
    ["I) item", "roman", 1],
    ["* [ ] open", "checklist", 1],
    ["* [x] done", "checklist", 1],
    ["term:: text", "description", 1],
    ["term:::", "description", 2],
    ["term:::: text", "description", 3],
    ["term;; text", "description", 1],
  ];
  test.each(cases)("%s is a %s list item", (text, kind, depth) => {
    const m = listMarkerOf(text);
    expect(m?.kind).toBe(kind);
    expect(m?.depth).toBe(depth);
  });

  test.each(["*item", "-item", ".Title", "......", "image::x.gif[]", "toc::[]", "plain text", "1.5 metres", "a.b", "word::x", "******* x"])(
    "%s is not a list item",
    (text) => {
      expect(listMarkerOf(text)).toBeUndefined();
    }
  );
});

describe("AsciiDoc line classifier: lines", () => {
  test("blank, text, lone plus, block macro, comment, attribute and title", () => {
    expect(kinds("a\n\n+\nimage::x.gif[]\n// note\n[NOTE]\n.Title\n* item")).toEqual([
      "text",
      "blank",
      "continuation",
      "block-macro",
      "comment",
      "block-attribute",
      "block-title",
      "list-item",
    ]);
  });

  test("a lone plus tolerates trailing blanks; a plus with text is not a continuation", () => {
    expect(kinds("+  \nx +\n++")).toEqual(["continuation", "text", "text"]);
  });

  test("offsets address the original text", () => {
    const lines = classifyLines("ab\r\ncd\n\nef");
    expect(lines.map((l) => [l.start, l.end, l.text])).toEqual([
      [0, 2, "ab"],
      [4, 6, "cd"],
      [7, 7, ""],
      [8, 10, "ef"],
    ]);
  });
});

describe("AsciiDoc line classifier: delimiters", () => {
  test.each([
    ["----", "listing"],
    ["....", "literal"],
    ["====", "example"],
    ["****", "sidebar"],
    ["____", "quote"],
    ["--", "open"],
    ["++++", "passthrough"],
    ["////", "comment"],
    ["|===", "table"],
    ["--------", "listing"],
  ])("%s opens and closes a %s block", (delimiter, kind) => {
    const lines = classifyLines(`${delimiter}\nx\n${delimiter}`);
    expect(lines[0].delimiter).toMatchObject({ kind, role: "open", match: 2 });
    expect(lines[2].delimiter).toMatchObject({ kind, role: "close", match: 0 });
  });

  test("three dashes and a bare |== are not delimiters", () => {
    expect(kinds("---\n|==")).toEqual(["text", "text"]);
  });

  test("a closing delimiter has the length of its opening one", () => {
    const lines = classifyLines("-----\n----\n-----");
    expect(lines[1].kind).toBe("verbatim");
    expect(lines[2].delimiter?.role).toBe("close");
  });

  test("verbatim blocks hold their lines unclassified", () => {
    expect(kinds("----\n* item\n+\nimage::x.gif[]\n----")).toEqual(["delimiter", "verbatim", "verbatim", "verbatim", "delimiter"]);
    expect(kinds("++++\n* item\n++++")).toEqual(["delimiter", "verbatim", "delimiter"]);
    expect(kinds("////\n* item\n////")).toEqual(["delimiter", "verbatim", "delimiter"]);
  });

  test("non-verbatim blocks are classified inside, and nest", () => {
    expect(kinds("====\n* item\n--\n+\n--\n====")).toEqual(["delimiter", "list-item", "delimiter", "continuation", "delimiter", "delimiter"]);
    const lines = classifyLines("====\n--\nx\n--\n====");
    expect(lines[0].delimiter?.match).toBe(4);
    expect(lines[1].delimiter?.match).toBe(3);
  });

  test("an unclosed delimiter has no match", () => {
    expect(classifyLines("--\nx").map((l) => l.delimiter?.match)).toEqual([-1, undefined]);
  });

  test("an exact -- line inside a listing block stays a -- line", () => {
    const lines = classifyLines("----\n--\n----");
    expect(lines[1].kind).toBe("verbatim");
    expect(lines[1].text).toBe("--");
  });
});

describe("AsciiDoc line classifier: block macros", () => {
  test("every occurrence is reported with its position", () => {
    const macros = findBlockMacros("see image::a.gif[x] and video::b.mp4[]");
    expect(macros.map((m) => [m.name, m.start, m.end])).toEqual([
      ["image", 4, 19],
      ["video", 24, 38],
    ]);
  });

  test("inline image: with one colon is not a block macro", () => {
    expect(findBlockMacros("image:a.gif[]")).toEqual([]);
  });

  test("a macro inside backticks is not reported", () => {
    expect(findBlockMacros("write `image::a.gif[]` here")).toEqual([]);
  });

  test("the macro starting a line is attached to the line", () => {
    const [line] = classifyLines("image::a.gif[]+");
    expect(line.kind).toBe("block-macro");
    expect(line.macro).toMatchObject({ name: "image", start: 0, end: 14 });
  });
});

describe("AsciiDoc line classifier: tables and cell styles", () => {
  const segs = (text: string, index: number) => classifyLines(text)[index].segments?.map((s) => [s.asciidoc, s.style ?? ""]);

  test("a| and 2+a| are AsciiDoc cells, | and 2+| are not", () => {
    expect(segs("|===\na|x a|y\n2+a|z |w 2+|v\n|===", 1)).toEqual([[true, "a"], [true, "a"]]);
    expect(segs("|===\na|x a|y\n2+a|z |w 2+|v\n|===", 2)).toEqual([[true, "a"], [false, ""], [false, ""]]);
  });

  test("[cols] gives the column styles, in the order of the columns", () => {
    const text = '[cols="1,2a"]\n|===\n|plain |rich\n|more |text\n|===';
    expect(segs(text, 2)).toEqual([[false, ""], [true, ""]]);
    expect(segs(text, 3)).toEqual([[false, ""], [true, ""]]);
  });

  test("cols with a multiplier, and a bare column count", () => {
    expect(segs('[cols="2*a,1"]\n|===\n|x |y |z\n|===', 2)).toEqual([[true, ""], [true, ""], [false, ""]]);
    expect(segs("[cols=3]\n|===\n|x |y |z\n|===", 2)).toEqual([[false, ""], [false, ""], [false, ""]]);
  });

  test("a cell style written in the cell overrides the column style", () => {
    expect(segs('[cols="a,a"]\n|===\ns|x |y\n|===', 2)).toEqual([[false, "s"], [true, ""]]);
  });

  test("a line that starts no cell continues the cell before it", () => {
    const text = "|===\na|x\nimage::a.gif[]\n|y\nmore\n|===";
    expect(segs(text, 2)).toEqual([[true, "a"]]);
    expect(segs(text, 4)).toEqual([[false, ""]]);
  });

  test("an escaped pipe starts no cell", () => {
    expect(segs("|===\n|x \\| y\n|===", 1)).toEqual([[false, ""]]);
  });
});
