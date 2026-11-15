import { describe, expect, test } from "vitest";
import { publicationFindings } from "../language/annotation/publication.js";

const find = (body: string, hazards = true) => publicationFindings(body, { hazards });
const codes = (body: string, hazards = true): string[] => find(body, hazards).map((f) => f.code);
const at = (body: string, code: string) => find(body).filter((f) => f.code === code).map((f) => body.slice(f.start, f.end));

describe("annotation-continuation-without-list (XS-PUB-001)", () => {
  test("a + after a plain paragraph, before a macro", () => {
    const body = "Some text.\n+\nimage::a.gif[]";
    expect(codes(body)).toEqual(["annotation-continuation-without-list"]);
    expect(find(body)[0]).toMatchObject({ severity: "warning", start: 11, end: 12, fix: { newText: "" } });
  });

  test("a + after a paragraph of several lines", () => {
    expect(codes("one\ntwo\n+\nimage::a.gif[]")).toEqual(["annotation-continuation-without-list"]);
  });

  test("a + after a paragraph that follows a blank line below a list item", () => {
    expect(codes(". item\n\nparagraph\n+\nimage::a.gif[]")).toEqual(["annotation-continuation-without-list"]);
  });

  test("a chain that starts at a paragraph is wrong at every + of it", () => {
    expect(codes("para\n+\nimage::a.gif[]\n+\nimage::b.gif[]")).toEqual([
      "annotation-continuation-without-list",
      "annotation-continuation-without-list",
    ]);
  });

  test("a + after a delimited block that no + attaches", () => {
    expect(codes("====\ntext\n====\n+\nimage::a.gif[]")).toEqual(["annotation-continuation-without-list"]);
  });

  test("a + after a block title and a block that follow a paragraph", () => {
    expect(codes("para\n\n.Title\n----\ncode\n----\n+\nimage::a.gif[]")).toEqual(["annotation-continuation-without-list"]);
  });

  test.each([
    "* item",
    "** item",
    "***** item",
    "- item",
    ". item",
    "..... item",
    "1. item",
    "a. item",
    "A. item",
    "i) item",
    "I) item",
    "1) item",
    "* [ ] item",
    "* [x] item",
    "term:: text",
    "term::: text",
    "term:::: text",
    "term;; text",
    "term::",
  ])("a chain of the list item %s is not reported", (item) => {
    expect(codes(`${item}\n+\nimage::a.gif[]`, false)).toEqual([]);
  });

  test("a chain of several blocks from a list item is not reported", () => {
    expect(codes(". item\n+\nimage::a.gif[]\n+\ntext\n+\nimage::b.gif[]\n+\ntext", false)).toEqual([]);
  });

  test("a delimited block attached to a list item, then a macro attached after it", () => {
    expect(codes(". item\n+\n====\ntext\n====\n+\nimage::a.gif[]", false)).toEqual([]);
    expect(codes(". item\n+\n[NOTE]\n====\ntext\n====\n+\nimage::a.gif[]", false)).toEqual([]);
  });

  test("a continuation line of the item text, and a blank line before the +", () => {
    expect(codes("* item\nmore of the item\n+\nimage::a.gif[]", false)).toEqual([]);
    expect(codes("* item\n\n+\nimage::a.gif[]", false)).toEqual([]);
  });

  test("the item the + belongs to is the nearest above, in a list of several", () => {
    expect(codes("* one\n* two\n+\nimage::a.gif[]", false)).toEqual([]);
  });

  test("a list nested in a block, with its own chain", () => {
    expect(codes("====\n. item\n+\nimage::a.gif[]\n====", false)).toEqual([]);
  });

  test("the previous line alone does not decide: a macro line after a + chain from an item", () => {
    expect(codes(". item\n+\nimage::a.gif[]\n+\nimage::b.gif[]", false)).toEqual([]);
  });

  test("a delimited block directly under a list item's text is not part of the item (Asciidoctor 2.0.26)", () => {
    expect(codes("* item text\n[stem]\n++++\nx\n++++\n+\nimage::a.gif[]", false)).toEqual(["annotation-continuation-without-list"]);
    expect(codes("* item text\n----\ncode\n----\n+\nimage::a.gif[]", false)).toEqual(["annotation-continuation-without-list"]);
  });

  test("the same block attached with a + is part of the item", () => {
    expect(codes("* item text\n+\n[stem]\n++++\nx\n++++\n+\nimage::a.gif[]", false)).toEqual([]);
  });

  test("a + inside a listing block is text", () => {
    expect(codes("----\npara\n+\nimage::a.gif[]\n----")).toEqual([]);
  });
});

describe("annotation-glued-continuation (XS-PUB-002)", () => {
  test("a + glued to the ] of a macro is removed when no chain holds the macro", () => {
    const body = "image::a.gif[]+";
    expect(codes(body)).toEqual(["annotation-glued-continuation"]);
    expect(find(body)[0]).toMatchObject({ severity: "warning", start: 14, end: 15, fix: { newText: "" } });
  });

  test("with attributes", () => {
    expect(codes("image::a.gif[Alt text,width=10]+")).toEqual(["annotation-glued-continuation"]);
  });

  test("inside a list item's chain the + moves to a line of its own", () => {
    const body = ". item\n+\nimage::a.gif[]+\nimage::b.gif[]";
    const f = find(body).filter((x) => x.code === "annotation-glued-continuation");
    expect(f).toHaveLength(1);
    expect(f[0].fix?.newText).toBe("\n+");
  });

  test("a + on its own line after a macro is fine", () => {
    expect(codes(". item\n+\nimage::a.gif[]\n+\nimage::b.gif[]", false)).toEqual([]);
  });

  test("a + in a macro's text is not glued", () => {
    expect(codes("image::a+b.gif[]")).toEqual([]);
  });
});

describe("annotation-block-macro-inline (XS-PUB-003)", () => {
  test("a macro that does not start its line", () => {
    expect(at("See image::a.gif[] here.", "annotation-block-macro-inline")).toEqual(["image::a.gif[]"]);
  });

  test("a macro after a list marker", () => {
    expect(codes(". image::a.gif[]")).toEqual(["annotation-block-macro-inline"]);
  });

  test.each(["image", "video", "audio", "toc"])("%s::", (name) => {
    expect(codes(`text ${name}::x[]`)).toEqual(["annotation-block-macro-inline"]);
  });

  test("a second macro on a line is reported, the first at the line start is not", () => {
    expect(at("image::a.gif[] image::b.gif[]", "annotation-block-macro-inline")).toEqual(["image::b.gif[]"]);
  });

  test("include:: and link:: are not block macros of this rule", () => {
    expect(codes("see include::a.adoc[] and link::b[]")).toEqual([]);
  });

  test("an inline image: macro and a macro in backticks are fine", () => {
    expect(codes("see image:a.gif[] and `image::a.gif[]`")).toEqual([]);
  });

  test("a macro at the start of a line is fine", () => {
    expect(codes("text\n\nimage::a.gif[]")).toEqual([]);
  });

  test("a macro in a cell without the AsciiDoc style", () => {
    expect(codes("|===\n|image::a.gif[]\n|===")).toEqual(["annotation-block-macro-inline"]);
    expect(codes("|===\n2+|image::a.gif[]\n|===")).toEqual(["annotation-block-macro-inline"]);
  });

  test("a macro in an a| cell, on the cell's line or on its own line", () => {
    expect(codes("|===\na|image::a.gif[]\n2+a|text\nimage::b.gif[]\n|===")).toEqual([]);
  });

  test("a macro in an a| cell that does not start the cell content", () => {
    expect(codes("|===\na|text image::a.gif[]\n|===")).toEqual(["annotation-block-macro-inline"]);
  });

  test("a continued line of a plain cell", () => {
    expect(codes("|===\n|text\nimage::a.gif[]\n|===")).toEqual(["annotation-block-macro-inline"]);
  });

  test("the cols attribute gives a column the AsciiDoc style", () => {
    const body = (cell: string) => `[cols="1,2a"]\n|===\n|text |${cell}\n|===`;
    expect(codes(body("image::a.gif[]"))).toEqual([]);
    expect(codes('[cols="1,2a"]\n|===\n|image::a.gif[] |text\n|===')).toEqual(["annotation-block-macro-inline"]);
  });

  test("a table whose cols cannot be read: its cells are plain unless written a|", () => {
    expect(codes('[cols="1,weird"]\n|===\n|text |image::a.gif[]\n|===')).toEqual(["annotation-block-macro-inline"]);
  });

  test("a macro in a listing block is text", () => {
    expect(codes("----\nsee image::a.gif[]\n----")).toEqual([]);
  });
});

describe("annotation-open-block-delimiter (XS-PUB-006)", () => {
  test("every line that is exactly -- is reported", () => {
    const body = "[NOTE]\n--\ntext\n--\n\n  --\n---";
    const found = find(body).filter((f) => f.code === "annotation-open-block-delimiter");
    expect(found.map((f) => body.slice(f.start, f.end))).toEqual(["--", "--"]);
    expect(found[0]).toMatchObject({ severity: "information" });
    expect(found[0].message).toContain("issue 857");
    expect(found[0].message).toContain("0.5.42");
  });

  test("also inside nested delimited blocks and listing blocks", () => {
    expect(codes("====\n--\nx\n--\n====")).toEqual(["annotation-open-block-delimiter", "annotation-open-block-delimiter"]);
    expect(codes("----\n--\n----")).toEqual(["annotation-open-block-delimiter"]);
  });

  test("a switched-off setting reports nothing", () => {
    expect(codes("--\nx\n--", false)).toEqual([]);
  });

  test("a CRLF line is exactly --", () => {
    expect(codes("--\r\nx")).toEqual(["annotation-open-block-delimiter"]);
  });
});

describe("annotation-list-chain-macro (XS-PUB-007)", () => {
  const LONG = ". step one\n+\nimage::a.gif[]\n+\nimage::b.gif[]\n+\ntext c\n+\nimage::d.gif[]\n+\ntext e";

  test("a '. ' item whose chain attaches macros is reported once, naming the + lines", () => {
    const found = find(LONG).filter((f) => f.code === "annotation-list-chain-macro");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("information");
    expect(LONG.slice(found[0].start, found[0].end)).toBe(". step one");
    expect(found[0].message).toContain("lines 2, 4, 8");
    expect(found[0].message).toContain("issue 862");
    expect(found[0].message).toContain("0.7.68");
  });

  test("the + lines are named from the file line the block starts on", () => {
    const found = publicationFindings(LONG, { hazards: true, firstLine: 100 }).filter((f) => f.code === "annotation-list-chain-macro");
    expect(found[0].message).toContain("lines 101, 103, 107");
  });

  test("an item the plugin's regex matches, with a macro right after the +, is fine", () => {
    expect(codes("* item\n+\nimage::a.gif[]")).toEqual([]);
    expect(codes("1. item\n+\nimage::a.gif[]")).toEqual([]);
    expect(codes("a. item\n+\nimage::a.gif[]")).toEqual([]);
    expect(codes("term:: text\n+\nimage::a.gif[]")).toEqual([]);
  });

  test("the line before the + decides, not the item: a macro line before the + in a * item", () => {
    expect(codes("* item\n+\nimage::a.gif[]\n+\nimage::b.gif[]")).toEqual(["annotation-list-chain-macro"]);
  });

  test("nested markers and text items are not in the plugin's regex", () => {
    expect(codes("** item\n+\nimage::a.gif[]")).toEqual(["annotation-list-chain-macro"]);
    expect(codes("term:::\n+\nimage::a.gif[]")).toEqual(["annotation-list-chain-macro"]);
  });

  test("a + before text, not a macro, is not blanked", () => {
    expect(codes(". item\n+\ntext")).toEqual([]);
  });

  test("macro names of the plugin: link, image, video, audio, include", () => {
    for (const name of ["link", "image", "video", "audio", "include"]) {
      expect(codes(`. item\n+\n${name}::x[]`)).toEqual(["annotation-list-chain-macro"]);
    }
  });

  test("two items are two findings", () => {
    expect(codes(". one\n+\nimage::a.gif[]\n\n. two\n+\nimage::b.gif[]")).toEqual(["annotation-list-chain-macro", "annotation-list-chain-macro"]);
  });

  test("a chain that does not start at a list item is 001 only, never 007", () => {
    expect(codes("para\n+\nimage::a.gif[]")).toEqual(["annotation-continuation-without-list"]);
  });

  test("a switched-off setting reports nothing", () => {
    expect(codes(LONG, false)).toEqual([]);
  });
});
