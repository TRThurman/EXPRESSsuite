import { EmptyFileSystem, URI } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * The server-side remark index answers for every parsed document, whenever it
 * was first asked, and resolves the word at a position to the remarks of the
 * declaration it is bound to, through the schema's interfaces (ISO
 * 10303-11:2004 clause 11). The hover and Show Description depend on both: a
 * workspace is parsed before the first hover arrives, and a description
 * usually lives in the file that declares the entity, not the one that
 * references it.
 */
const expressions = `SCHEMA expressions_probe;
ENTITY string_literal;
  the_value : STRING;
END_ENTITY;
ENTITY real_literal;
  the_value : REAL;
END_ENTITY;
END_SCHEMA;
(*"expressions_probe.string_literal"
A *string_literal* is a literal whose value is a string.
*)
(*"expressions_probe.string_literal.__note"
Probe note.
*)
(*"expressions_probe.string_literal.the_value"
The string.
*)
(*"expressions_probe.real_literal"
A real.
*)
`;
const consumer = `SCHEMA consumer_probe;
REFERENCE FROM expressions_probe (string_literal);
ENTITY probe_item;
  label : string_literal;
END_ENTITY;
END_SCHEMA;
`;

/** Both documents built; the index is first touched before or after the build. */
async function workspace(touchIndexFirst: boolean) {
  const { shared } = createExpressP11Services(EmptyFileSystem);
  if (touchIndexFirst) void shared.workspace.AnnotationIndex;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
  const documents = (
    [
      ["expressions_probe", expressions],
      ["consumer_probe", consumer],
    ] as const
  ).map(([name, text]) => {
    const document = LangiumDocumentFactory.fromString(text, URI.parse(`memory:///${name}.exp`));
    LangiumDocuments.addDocument(document);
    return document;
  });
  await DocumentBuilder.build(documents, { validation: false });
  const [declaring, referencing] = documents;
  return { index: shared.workspace.AnnotationIndex, declaring, referencing };
}

const tags = (annotations: ReadonlyArray<{ tag: string }>) => annotations.map((a) => a.tag);

describe("server remark index", () => {
  test("answers for a document parsed before the index was first used", async () => {
    const { index, declaring, referencing } = await workspace(false);
    expect(tags(index.getAnnotations(declaring.uri))).toEqual([
      "expressions_probe.string_literal",
      "expressions_probe.string_literal.__note",
      "expressions_probe.string_literal.the_value",
      "expressions_probe.real_literal",
    ]);
    expect(index.getAnnotations(referencing.uri)).toEqual([]);
    expect(index.getAnnotations("memory:///absent.exp")).toEqual([]);
  });

  test("answers the same when the index observed the parse", async () => {
    const { index, declaring } = await workspace(true);
    expect(index.getAnnotations(declaring.uri.toString())).toHaveLength(4);
  });

  test("finds remarks by entity name across documents", async () => {
    const { index, declaring } = await workspace(false);
    const hits = index.findByEntityName("string_literal");
    expect(tags(hits.map((h) => h.annotation))).toEqual([
      "expressions_probe.string_literal",
      "expressions_probe.string_literal.__note",
      "expressions_probe.string_literal.the_value",
    ]);
    expect(new Set(hits.map((h) => h.uri))).toEqual(new Set([declaring.uri.toString()]));
    expect(index.findByEntityName("probe_item")).toEqual([]);
  });

  test("finds a tag path with its __ variants and nothing below it", async () => {
    const { index } = await workspace(false);
    expect(tags(index.findByPath("expressions_probe.string_literal").map((h) => h.annotation))).toEqual([
      "expressions_probe.string_literal",
      "expressions_probe.string_literal.__note",
    ]);
    expect(tags(index.findByPath("expressions_probe.string_literal.the_value").map((h) => h.annotation))).toEqual([
      "expressions_probe.string_literal.the_value",
    ]);
    expect(index.findByPath("expressions_probe.nothing")).toEqual([]);
  });
});

describe("remarks of the declaration at a position", () => {
  test("a reference bound through REFERENCE FROM yields the foreign declaration's remarks", async () => {
    const { index, declaring, referencing } = await workspace(false);
    // `  label : string_literal;` — line 3, the word starts at character 10.
    const result = index.annotationsAt(referencing.uri.toString(), { line: 3, character: 12 });
    expect(result?.path).toBe("expressions_probe.string_literal");
    expect(tags(result!.annotations.map((h) => h.annotation))).toEqual([
      "expressions_probe.string_literal",
      "expressions_probe.string_literal.__note",
    ]);
    expect(result!.annotations.every((h) => h.uri === declaring.uri.toString())).toBe(true);
  });

  test("the item of an interface specification resolves too", async () => {
    const { index, referencing } = await workspace(false);
    // `REFERENCE FROM expressions_probe (string_literal);` — line 1.
    const result = index.annotationsAt(referencing.uri.toString(), { line: 1, character: 36 });
    expect(result?.path).toBe("expressions_probe.string_literal");
  });

  test("a declaration's own name yields its remarks", async () => {
    const { index, declaring } = await workspace(false);
    // `ENTITY string_literal;` — line 1.
    const result = index.annotationsAt(declaring.uri.toString(), { line: 1, character: 9 });
    expect(result?.path).toBe("expressions_probe.string_literal");
    expect(result!.annotations).toHaveLength(2);
  });

  test("an attribute resolves to schema.entity.attribute", async () => {
    const { index, declaring } = await workspace(false);
    // `  the_value : STRING;` under string_literal — line 2.
    const result = index.annotationsAt(declaring.uri.toString(), { line: 2, character: 4 });
    expect(result?.path).toBe("expressions_probe.string_literal.the_value");
    expect(tags(result!.annotations.map((h) => h.annotation))).toEqual(["expressions_probe.string_literal.the_value"]);
  });

  test("a keyword, a declaration without remarks and an unknown document yield nothing", async () => {
    const { index, declaring, referencing } = await workspace(false);
    expect(index.annotationsAt(declaring.uri.toString(), { line: 2, character: 15 })).toBeUndefined(); // STRING
    expect(index.annotationsAt(referencing.uri.toString(), { line: 2, character: 9 })).toBeUndefined(); // probe_item
    expect(index.annotationsAt("memory:///absent.exp", { line: 0, character: 0 })).toBeUndefined();
  });
});
