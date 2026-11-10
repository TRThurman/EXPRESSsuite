import { EmptyFileSystem, TextDocument, type LangiumDocument } from "langium";
import { parseDocument } from "langium/test";
import type { TextEdit } from "vscode-languageserver";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { DescribeService, isDescribeRequest, type DescribeRequest } from "../language/annotation/describe.js";

const SUPPORT = `SCHEMA support_schema;
ENTITY shape_aspect;
END_ENTITY;
ENTITY item;
END_ENTITY;
END_SCHEMA;
`;

/** demo_schema comes last, so its annotation context runs to the end of the file. */
function demo(comment = "(* A widget is used here. *)", tail = ""): string {
  return `${SUPPORT}
SCHEMA demo_schema;
USE FROM support_schema;
${comment}
ENTITY widget;
  size : OPTIONAL REAL;
  count : INTEGER;
END_ENTITY;
FUNCTION f (a : INTEGER; b : REAL) : BOOLEAN;
  RETURN (TRUE);
END_FUNCTION;
END_SCHEMA;
${tail}`;
}

const DEMO = demo();
const WIDGET_BLOCK = '(*"demo_schema.widget"\nA **widget** is used here.\n*)';

interface Fixture {
  service: DescribeService;
  document: LangiumDocument;
  uri: string;
  version: number;
}

async function load(source: string): Promise<Fixture> {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const document = await parseDocument(services, source);
  await services.shared.workspace.DocumentBuilder.build([document]);
  return { service: new DescribeService(services), document, uri: document.uri.toString(), version: document.textDocument.version };
}

function request(fixture: Fixture, overrides: Partial<DescribeRequest>): DescribeRequest {
  return {
    uri: fixture.uri,
    version: fixture.version,
    key: "demo_schema.widget",
    role: "description",
    text: "",
    accepted: [],
    members: [],
    mode: "new",
    source: { kind: "typed" },
    ...overrides,
  };
}

/** Applies the edits to the document's text; they must come sorted and must not overlap. */
function apply(fixture: Fixture, edits: TextEdit[]): string {
  const document = fixture.document.textDocument;
  const text = document.getText();
  let result = "";
  let cursor = 0;
  for (const edit of edits) {
    const start = document.offsetAt(edit.range.start);
    const end = document.offsetAt(edit.range.end);
    expect(start).toBeGreaterThanOrEqual(cursor);
    result += text.slice(cursor, start) + edit.newText;
    cursor = end;
  }
  return result + text.slice(cursor);
}

/** The selection source covering `selected`, the first occurrence in `source`. */
function selection(source: string, selected: string): { kind: "selection"; start: number; end: number } {
  const start = source.indexOf(selected);
  expect(start).toBeGreaterThanOrEqual(0);
  return { kind: "selection", start, end: start + selected.length };
}

async function describeTyped(source: string, overrides: Partial<DescribeRequest>): Promise<{ fixture: Fixture; after: string; result: ReturnType<DescribeService["edit"]> }> {
  const fixture = await load(source);
  const result = fixture.service.edit(request(fixture, overrides));
  return { fixture, after: apply(fixture, result.edits), result };
}

describe("describe targets", () => {
  test("a cursor inside an explicit attribute defaults to the attribute", async () => {
    const fixture = await load(DEMO);
    const inName = DEMO.indexOf("size :") + 2;
    expect(fixture.service.targets(fixture.uri, inName, inName).defaultKey).toBe("demo_schema.widget.size");
    const inType = DEMO.indexOf("REAL;");
    expect(fixture.service.targets(fixture.uri, inType, inType).defaultKey).toBe("demo_schema.widget.size");
  });

  test("a cursor in a comment above a declaration defaults to that declaration", async () => {
    const fixture = await load(DEMO);
    const inComment = DEMO.indexOf("A widget is used");
    expect(fixture.service.targets(fixture.uri, inComment, inComment + 5).defaultKey).toBe("demo_schema.widget");
  });

  test("members come before their declaration", async () => {
    const fixture = await load(DEMO);
    const onParameter = DEMO.indexOf("a : INTEGER");
    expect(fixture.service.targets(fixture.uri, onParameter, onParameter).defaultKey).toBe("demo_schema.f.a");
    const inBody = DEMO.indexOf("RETURN");
    expect(fixture.service.targets(fixture.uri, inBody, inBody).defaultKey).toBe("demo_schema.f");
    const onHead = DEMO.indexOf("SCHEMA demo_schema") + 8;
    expect(fixture.service.targets(fixture.uri, onHead, onHead).defaultKey).toBe("demo_schema");
  });

  test("outside every declaration: the next declaration of the schema, else the schema, else the next target", async () => {
    const source = `-- a file header\n${DEMO}`;
    const fixture = await load(source);
    const at = (offset: number) => fixture.service.targets(fixture.uri, offset, offset).defaultKey;
    expect(at(3)).toBe("support_schema");
    expect(at(source.indexOf("USE FROM"))).toBe("demo_schema.widget");
    expect(at(source.lastIndexOf("END_SCHEMA"))).toBe("demo_schema");
    expect(at(source.length)).toBeUndefined();
  });

  test("lists the targets, the document version and the keys that have a block", async () => {
    const source = demo(undefined, '\n(*"Demo_Schema.Widget"\nA **widget**.\n*)\n(*"demo_schema.widget.__note"\nA note.\n*)\n');
    const fixture = await load(source);
    const result = fixture.service.targets(fixture.uri, 0, 0);
    expect(result.version).toBe(fixture.version);
    expect(result.targets.map((target) => target.key)).toEqual([
      "support_schema", "support_schema.shape_aspect", "support_schema.item",
      "demo_schema", "demo_schema.widget", "demo_schema.widget.size", "demo_schema.widget.count",
      "demo_schema.f", "demo_schema.f.a", "demo_schema.f.b",
    ]);
    expect(result.existing).toEqual(["demo_schema.widget", "demo_schema.widget.__note"]);
  });

  test("an unknown document gives no targets", async () => {
    const fixture = await load(DEMO);
    expect(fixture.service.targets("file:///nowhere.exp", 0, 0)).toEqual({ version: -1, targets: [], existing: [] });
  });
});

describe("describe proposals", () => {
  test("proposes links in the author's text for the target", async () => {
    const fixture = await load(DEMO);
    const proposals = fixture.service.proposals(fixture.uri, "Demo_Schema.Widget", "A widget refines a shape_aspect and an item.");
    expect(proposals.map((p) => [p.text, p.status])).toEqual([
      ["widget", "subject"],
      ["shape_aspect", "auto"],
      ["item", "proposed"],
    ]);
    expect(fixture.service.proposals(fixture.uri, "demo_schema.nothing", "A widget.")).toEqual([]);
  });
});

describe("describe edit: new blocks", () => {
  test("a typed description goes after END_SCHEMA with two blank lines, and the check finds nothing", async () => {
    const { after, result } = await describeTyped(DEMO, { text: "A widget is used here." });
    expect(result.refused).toBeUndefined();
    expect(after).toBe(`${DEMO}\n\n${WIDGET_BLOCK}\n`);
    expect(after.endsWith(`END_SCHEMA;\n\n\n${WIDGET_BLOCK}\n`)).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test("a second block lands after the first with the same separator", async () => {
    const first = (await describeTyped(DEMO, { text: "A widget is used here." })).after;
    const { after } = await describeTyped(first, { key: "demo_schema.widget.count", text: "The count of parts." });
    expect(after).toBe(`${first}\n\n(*"demo_schema.widget.count"\nThe count of parts.\n*)\n`);
  });

  test("the separator is the one found between neighbouring blocks", async () => {
    const source = demo(undefined, '\n(*"demo_schema"\nA demo.\n*)\n(*"demo_schema.widget"\nA **widget**.\n*)\n');
    const { after } = await describeTyped(source, { key: "demo_schema.widget.count", text: "The count of parts." });
    expect(after).toBe(`${source}(*"demo_schema.widget.count"\nThe count of parts.\n*)\n`);
  });

  test("a block goes after the nearest preceding target that has one, not at the end", async () => {
    const source = demo(undefined, '\n(*"demo_schema"\nA demo.\n*)\n\n(*"demo_schema.f"\nReturns TRUE.\n*)\n');
    const { after } = await describeTyped(source, { text: "A widget is used here." });
    expect(after).toBe(demo(undefined, `\n(*"demo_schema"\nA demo.\n*)\n\n${WIDGET_BLOCK}\n\n(*"demo_schema.f"\nReturns TRUE.\n*)\n`));
  });

  test("an OPTIONAL attribute's description ends with the mandatory sentence after one space", async () => {
    const { after, result } = await describeTyped(DEMO, { key: "demo_schema.widget.size", text: "The size of the widget." });
    expect(after).toBe(
      `${DEMO}\n\n(*"demo_schema.widget.size"\nThe size of the **widget**. The value of this attribute need not be specified.\n*)\n`
    );
    expect(result.findings).toEqual([]);
  });

  test("the mandatory sentence is not written twice", async () => {
    const text = "The size. The value of this attribute need not be specified.";
    const { after } = await describeTyped(DEMO, { key: "demo_schema.widget.size", text });
    expect(after).toBe(`${DEMO}\n\n(*"demo_schema.widget.size"\n${text}\n*)\n`);
  });

  test("member texts get blocks of their own after the owner's, in member order; an empty one gets none", async () => {
    const { after } = await describeTyped(DEMO, {
      key: "demo_schema.f",
      text: "Returns TRUE.",
      members: [
        { key: "demo_schema.f.b", text: "  ", accepted: [] },
        { key: "demo_schema.f.a", text: "The first value.", accepted: [] },
      ],
    });
    expect(after).toBe(`${DEMO}\n\n(*"demo_schema.f"\nReturns TRUE.\n*)\n\n\n(*"demo_schema.f.a"\nThe first value.\n*)\n`);
  });

  test("role note writes the .__note block", async () => {
    const { after } = await describeTyped(DEMO, { role: "note", text: "A note on use." });
    expect(after).toBe(`${DEMO}\n\n(*"demo_schema.widget.__note"\nA note on use.\n*)\n`);
  });

  test("a note goes after the description it belongs to", async () => {
    const source = demo(undefined, `\n${WIDGET_BLOCK}\n\n(*"demo_schema.f"\nReturns TRUE.\n*)\n`);
    const { after } = await describeTyped(source, { role: "example", text: "An example." });
    expect(after).toBe(demo(undefined, `\n${WIDGET_BLOCK}\n\n(*"demo_schema.widget.__example"\nAn example.\n*)\n\n(*"demo_schema.f"\nReturns TRUE.\n*)\n`));
  });

  test("auto and subject links are always written, proposed ones only when ticked and matched (R2)", async () => {
    const fixture = await load(DEMO);
    const text = "A widget refines a shape_aspect and an item.";
    const item = fixture.service.proposals(fixture.uri, "demo_schema.widget", text).find((p) => p.text === "item")!;
    const stray = { start: 0, end: 1, text: "A", name: "A", status: "proposed" as const, schema: "support_schema" };
    const result = fixture.service.edit(request(fixture, { text, accepted: [item, stray] }));
    expect(apply(fixture, result.edits)).toBe(
      `${DEMO}\n\n(*"demo_schema.widget"\nA **widget** refines a <<express:support_schema.shape_aspect,shape_aspect>> and an <<express:support_schema.item,item>>.\n*)\n`
    );
  });

  test("a hand-written undeclared link is returned as a finding", async () => {
    const { result } = await describeTyped(DEMO, { text: "See <<express:support_schema.nope,nope>>." });
    expect(result.findings).toEqual([expect.objectContaining({ code: "annotation-link-undeclared" })]);
    expect(result.edits).toHaveLength(1);
  });

  test("a CRLF document gets CRLF line endings", async () => {
    const source = DEMO.replace(/\n/g, "\r\n");
    const { after } = await describeTyped(source, { text: "A widget is used here." });
    expect(after).toBe(`${source}\r\n\r\n${WIDGET_BLOCK.replace(/\n/g, "\r\n")}\r\n`);
  });

  test("a multi-line text is written with the document's line endings", async () => {
    const { after } = await describeTyped(DEMO, { text: "A widget is used here.\r\n\r\nIt has a size." });
    expect(after).toBe(`${DEMO}\n\n(*"demo_schema.widget"\nA **widget** is used here.\n\nIt has a size.\n*)\n`);
  });
});

describe("describe edit: existing blocks", () => {
  const EXISTING = demo(undefined, '\n(*"demo_schema.widget"\nA **widget** is a thing.\n*)\n');

  test("append adds a blank line and the new body before the closing line", async () => {
    const { after, result } = await describeTyped(EXISTING, { mode: "append", text: "It is used here." });
    expect(after).toBe(demo(undefined, '\n(*"demo_schema.widget"\nA **widget** is a thing.\n\nIt is used here.\n*)\n'));
    expect(result.findings).toEqual([]);
  });

  test("append to an OPTIONAL attribute ending with the mandatory sentence keeps one sentence, after the new text (R7)", async () => {
    const source = demo(undefined, '\n(*"demo_schema.widget.size"\nThe size. The value of this attribute need not be specified.\n*)\n');
    const { after, result } = await describeTyped(source, { key: "demo_schema.widget.size", mode: "append", text: "More about size." });
    expect(after).toBe(
      demo(undefined, '\n(*"demo_schema.widget.size"\nThe size.\n\nMore about size. The value of this attribute need not be specified.\n*)\n')
    );
    expect(result.findings).toEqual([]);
  });

  test("append to an OPTIONAL attribute whose body is only the mandatory sentence leaves one sentence (R7)", async () => {
    const source = demo(undefined, '\n(*"demo_schema.widget.size"\nThe value of this attribute need not be specified.\n*)\n');
    const { after, result } = await describeTyped(source, { key: "demo_schema.widget.size", mode: "append", text: "More about size." });
    expect(after).toBe(demo(undefined, '\n(*"demo_schema.widget.size"\nMore about size. The value of this attribute need not be specified.\n*)\n'));
    expect(result.findings).toEqual([]);
  });

  test("append to an OPTIONAL attribute whose body lacks the sentence ends the new paragraph with it", async () => {
    const source = demo(undefined, '\n(*"demo_schema.widget.size"\nThe size.\n*)\n');
    const { after, result } = await describeTyped(source, { key: "demo_schema.widget.size", mode: "append", text: "More about size." });
    expect(after).toBe(
      demo(undefined, '\n(*"demo_schema.widget.size"\nThe size.\n\nMore about size. The value of this attribute need not be specified.\n*)\n')
    );
    expect(result.findings).toEqual([]);
  });

  test("replace writes the whole body", async () => {
    const { after } = await describeTyped(EXISTING, { mode: "replace", text: "A widget is used here." });
    expect(after).toBe(demo(undefined, `\n${WIDGET_BLOCK}\n`));
  });

  test("append and replace find a block written in another case", async () => {
    const source = demo(undefined, '\n(*"Demo_Schema.Widget"\nA **widget** is a thing.\n*)\n');
    const { after } = await describeTyped(source, { mode: "append", text: "It is used here." });
    expect(after).toBe(demo(undefined, '\n(*"Demo_Schema.Widget"\nA **widget** is a thing.\n\nIt is used here.\n*)\n'));
  });

  test("an existing member block follows the mode; a missing one is created", async () => {
    const source = demo(undefined, '\n(*"demo_schema.f"\nOld.\n*)\n(*"demo_schema.f.b"\nOld b.\n*)\n');
    const { after } = await describeTyped(source, {
      key: "demo_schema.f",
      mode: "replace",
      text: "Returns TRUE.",
      members: [
        { key: "demo_schema.f.a", text: "The first value.", accepted: [] },
        { key: "demo_schema.f.b", text: "The second value.", accepted: [] },
      ],
    });
    expect(after).toBe(
      demo(undefined, '\n(*"demo_schema.f"\nReturns TRUE.\n*)\n(*"demo_schema.f.a"\nThe first value.\n*)\n(*"demo_schema.f.b"\nThe second value.\n*)\n')
    );
  });

  test("new on an existing block is refused", async () => {
    const { result } = await describeTyped(EXISTING, { mode: "new", text: "A widget is used here." });
    expect(result.refused).toMatch(/already has a block/);
    expect(result.edits).toEqual([]);
  });

  test("new is refused when a member with text already has a block", async () => {
    const source = demo(undefined, '\n(*"demo_schema.f.a"\nOld a.\n*)\n');
    const { result } = await describeTyped(source, {
      key: "demo_schema.f",
      text: "Returns TRUE.",
      members: [{ key: "demo_schema.f.a", text: "The first value.", accepted: [] }],
    });
    expect(result.refused).toMatch(/demo_schema\.f\.a/);
    expect(result.edits).toEqual([]);
  });

  test("append without a block is refused", async () => {
    const { result } = await describeTyped(DEMO, { mode: "append", text: "It is used here." });
    expect(result.refused).toMatch(/no block/);
    expect(result.edits).toEqual([]);
  });

  test("an unterminated block is neither appended to nor replaced", async () => {
    // The outer remark never closes; the last two characters are the inner remark's `*)`.
    const source = `${DEMO}\n(*"demo_schema.widget"\nA thing (* inner *)`;
    for (const mode of ["append", "replace"] as const) {
      const { result } = await describeTyped(source, { mode, text: "It is used here." });
      expect(result.refused).toMatch(/not closed/);
      expect(result.edits).toEqual([]);
    }
  });
});

describe("describe edit: an unclosed anchor block", () => {
  test("a new block whose anchor block is not closed is refused, nothing is written", async () => {
    // The outer remark never closes, so the block runs to the end of the file.
    const source = `${DEMO}\n(*"demo_schema.widget"\nA widget (* inner *)`;
    const { result } = await describeTyped(source, { key: "demo_schema.widget.count", text: "The count of parts." });
    expect(result.refused).toMatch(/"demo_schema\.widget" is not closed/);
    expect(result.edits).toEqual([]);
  });

  test("a note after an unclosed description block is refused", async () => {
    const source = `${DEMO}\n(*"demo_schema.widget"\nA widget (* inner *)`;
    const { result } = await describeTyped(source, { role: "note", text: "A note on use." });
    expect(result.refused).toMatch(/"demo_schema\.widget" is not closed/);
    expect(result.edits).toEqual([]);
  });
});

describe("describe edit: removal of the source", () => {
  test("a selection inside a (* *) remark removes exactly that text", async () => {
    const source = demo("(* A widget is used here. Keep this note. *)");
    const { after, result } = await describeTyped(source, { text: "A widget is used here.", source: selection(source, "A widget is used here.") });
    expect(result.refused).toBeUndefined();
    expect(after).toBe(`${demo("(*  Keep this note. *)")}\n\n${WIDGET_BLOCK}\n`);
  });

  test("a remark left blank goes whole, with its line", async () => {
    const { after } = await describeTyped(DEMO, { text: "A widget is used here.", source: selection(DEMO, "A widget is used here.") });
    expect(after).toBe(`${DEMO.replace("(* A widget is used here. *)\n", "")}\n\n${WIDGET_BLOCK}\n`);
  });

  test("a remark selected with its delimiters goes whole, with its line", async () => {
    const { after } = await describeTyped(DEMO, { text: "A widget is used here.", source: selection(DEMO, "(* A widget is used here. *)") });
    expect(after).toBe(`${DEMO.replace("(* A widget is used here. *)\n", "")}\n\n${WIDGET_BLOCK}\n`);
  });

  test("a selection over two -- lines removes both lines", async () => {
    const source = demo("-- A widget is\n-- used here.");
    const { after } = await describeTyped(source, { text: "A widget is used here.", source: selection(source, "A widget is\n-- used here.") });
    expect(after).toBe(`${demo("").replace("USE FROM support_schema;\n\n", "USE FROM support_schema;\n")}\n\n${WIDGET_BLOCK}\n`);
  });

  test("part of a -- line is removed, the rest stays", async () => {
    const source = demo("-- Widget: a widget is used here.");
    const { after } = await describeTyped(source, { text: "a widget is used here.", source: selection(source, "a widget is used here.") });
    expect(after).toBe(`${demo("-- Widget:")}\n\n(*"demo_schema.widget"\na **widget** is used here.\n*)\n`);
  });

  test("a trailing -- comment on a code line left blank loses its delimiter", async () => {
    const source = DEMO.replace("count : INTEGER;", "count : INTEGER; -- the count of parts");
    const { after } = await describeTyped(source, {
      key: "demo_schema.widget.count",
      text: "The count of parts.",
      source: selection(source, "the count of parts"),
    });
    expect(after).toBe(`${DEMO}\n\n(*"demo_schema.widget.count"\nThe count of parts.\n*)\n`);
  });

  test("an unkeyed remark after END_SCHEMA becomes the block and goes, in one set of edits", async () => {
    const remark = "(* Note: widgets are used here. *)";
    const source = demo("", `\n${remark}\n`);
    const { after, result } = await describeTyped(source, { text: "Widgets are used here.", source: selection(source, remark) });
    expect(result.refused).toBeUndefined();
    expect(after).toBe(`${demo("")}\n\n(*"demo_schema.widget"\nWidgets are used here.\n*)\n\n`);
  });

  test("typed and clipboard sources remove nothing", async () => {
    for (const kind of ["typed", "clipboard"] as const) {
      const { result } = await describeTyped(DEMO, { text: "A widget is used here.", source: { kind } });
      expect(result.edits).toHaveLength(1);
    }
  });
});

describe("describe edit: refusals", () => {
  test("Review Focus 4: the document changed after the targets request, nothing is written", async () => {
    const fixture = await load(DEMO);
    const { version } = fixture.service.targets(fixture.uri, 0, 0);
    TextDocument.update(fixture.document.textDocument, [{ text: `${DEMO}-- an edit\n` }], version + 1);
    const result = fixture.service.edit(request(fixture, { version, text: "A widget is used here." }));
    expect(result.refused).toMatch(/changed/);
    expect(result.edits).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  test("Review Focus 5: a selection running from a comment into code is refused, nothing is removed", async () => {
    const fromRemark = await describeTyped(DEMO, { text: "A widget is used here.", source: selection(DEMO, "A widget is used here. *)\nENTITY widget") });
    expect(fromRemark.result.refused).toMatch(/not wholly inside/);
    expect(fromRemark.result.edits).toEqual([]);

    const tail = demo("-- A widget is used here.");
    const fromTail = await describeTyped(tail, { text: "A widget is used here.", source: selection(tail, "A widget is used here.\nENTITY") });
    expect(fromTail.result.refused).toMatch(/not wholly inside/);
    expect(fromTail.result.edits).toEqual([]);
  });

  test("a selection spanning two remarks is refused", async () => {
    const source = demo("(* A widget *) (* is used here. *)");
    const { result } = await describeTyped(source, { text: "A widget is used here.", source: selection(source, "A widget *) (* is used here.") });
    expect(result.refused).toMatch(/not wholly inside/);
  });

  test("-- lines with a blank line between them are not one run", async () => {
    const source = demo("-- A widget is\n\n-- used here.");
    const { result } = await describeTyped(source, { text: "A widget is used here.", source: selection(source, "A widget is\n\n-- used here.") });
    expect(result.refused).toMatch(/not wholly inside/);
  });

  test("a selection that would break a nested remark is refused", async () => {
    const source = demo("(* A widget (* inner *) is used here. *)");
    const { result } = await describeTyped(source, { text: "A widget", source: selection(source, "A widget (* inner") });
    expect(result.refused).toMatch(/break/);
    expect(result.edits).toEqual([]);
  });

  test("a selection inside the block being written is refused", async () => {
    const source = demo(undefined, '\n(*"demo_schema.widget"\nA **widget** is a thing.\n*)\n');
    const { result } = await describeTyped(source, { mode: "replace", text: "a thing", source: selection(source, "is a thing") });
    expect(result.refused).toMatch(/block being written/);
    expect(result.edits).toEqual([]);
  });

  test("removing a selected block where the new block goes is refused", async () => {
    const block = '(*"demo_schema.widget"\nA **widget** is a thing.\n*)';
    const source = demo(undefined, `\n${block}\n`);
    const { result } = await describeTyped(source, { key: "demo_schema.widget.count", text: "The count.", source: selection(source, block) });
    expect(result.refused).toMatch(/overlaps/);
    expect(result.edits).toEqual([]);
  });

  test("an unknown key, empty text, a foreign member or member text with a note are refused", async () => {
    const fixture = await load(DEMO);
    const refused = (overrides: Partial<DescribeRequest>) => fixture.service.edit(request(fixture, overrides));
    expect(refused({ key: "demo_schema.nothing", text: "x" }).refused).toMatch(/not a declaration/);
    expect(refused({ text: "  \n" }).refused).toMatch(/empty/);
    expect(refused({ role: "note", text: " " }).refused).toMatch(/empty/);
    expect(refused({ key: "demo_schema.f", text: "x", members: [{ key: "demo_schema.widget.size", text: "y", accepted: [] }] }).refused).toMatch(
      /not a parameter or item/
    );
    expect(refused({ key: "demo_schema.f", role: "note", text: "x", members: [{ key: "demo_schema.f.a", text: "y", accepted: [] }] }).refused).toMatch(
      /only with a description/
    );
    expect(refused({ uri: "file:///nowhere.exp", text: "x" }).refused).toBeDefined();
    expect(refused({ text: "An unmatched *) here." }).refused).toMatch(/unmatched/);
  });
});

describe("isDescribeRequest", () => {
  test("accepts a well-formed request and rejects malformed ones", () => {
    const valid: DescribeRequest = {
      uri: "file:///a.exp", version: 1, key: "s.e", role: "description", text: "x", accepted: [],
      members: [{ key: "s.f.a", text: "y", accepted: [] }], mode: "new", source: { kind: "selection", start: 0, end: 1 },
    };
    expect(isDescribeRequest(valid)).toBe(true);
    expect(isDescribeRequest(null)).toBe(false);
    expect(isDescribeRequest({ ...valid, role: "figure" })).toBe(false);
    expect(isDescribeRequest({ ...valid, mode: "merge" })).toBe(false);
    expect(isDescribeRequest({ ...valid, version: 1.5 })).toBe(false);
    expect(isDescribeRequest({ ...valid, source: { kind: "selection", start: 0 } })).toBe(false);
    expect(isDescribeRequest({ ...valid, accepted: [{ start: 0, end: 1 }] })).toBe(false);
    expect(isDescribeRequest({ ...valid, members: [{ key: "s.f.a", text: 3, accepted: [] }] })).toBe(false);
  });
});
