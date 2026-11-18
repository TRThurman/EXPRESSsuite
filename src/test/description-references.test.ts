import { EmptyFileSystem, URI } from "langium";
import type { LangiumDocument } from "langium";
import { describe, expect, test } from "vitest";
import type { TextEdit } from "vscode-languageserver";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * Find All References and Rename with the description blocks after END_SCHEMA: the keys, the
 * `<<express:...>>` cross-references and the names in the text that name a declaration.
 * The grammar reads these blocks as remarks, so Langium's own providers see nothing of them.
 */
const widgets = `SCHEMA ref_widgets;
USE FROM ref_base (anchor);
TYPE finish_kind = ENUMERATION OF (matte, glossy);
END_TYPE;
ENTITY widget;
  name : STRING;
  teeth : OPTIONAL INTEGER;
  fixed_to : anchor;
DERIVE
  toothed : BOOLEAN := EXISTS(teeth);
UNIQUE
  one_name: name;
WHERE
  named: name <> '';
END_ENTITY;
ENTITY geared_widget SUBTYPE OF (widget);
  SELF\\widget.teeth : INTEGER;
END_ENTITY;
ENTITY assembly;
  parts : SET [1:?] OF widget;
END_ENTITY;
FUNCTION count_teeth (w : widget) : INTEGER;
  RETURN (w.teeth);
END_FUNCTION;
END_SCHEMA;
(*"ref_widgets"
The schema of widgets.
*)
(*"ref_widgets.widget"
A **widget** is a part; a Widget has teeth.
See <<express:ref_widgets.widget.teeth,teeth>> and <<express:ref_widgets.widget.teeth,its teeth>>.
It is fixed to <<express:ref_widgets.anchor,anchor>>, cited under its own schema's name.
*)
(*"ref_widgets.widget.__note"
A note.
*)
(*"ref_widgets.widget.teeth"
The teeth.
*)
(*"ref_widgets.widget.wr:named"
Named.
*)
(*"ref_widgets.widget.named"
The same rule, keyed without wr.
*)
(*"ref_widgets.widget.ur:one_name"
Unique.
*)
(*"ref_widgets.geared_widget.teeth"
Redeclared.
*)
(*"ref_widgets.geared_widget.SELF\\widget.teeth"
Redeclared, written with the supertype.
*)
(*"ref_widgets.finish_kind.glossy"
Shiny.
*)
(*"ref_widgets.count_teeth.w"
The widget counted.
*)
(*"ref_widgets.assembly"
An assembly of <<express:ref_widgets.widget,widget>> parts; see <<express:ref_widgets.widget,the widget>>.
*)
`;
const base = `SCHEMA ref_base;
ENTITY anchor;
  depth : REAL;
END_ENTITY;
ENTITY widget;
END_ENTITY;
END_SCHEMA;
(*"ref_base.anchor"
An **anchor** holds a <<express:ref_widgets.widget>> in place.
*)
(*"ref_base.widget"
Another widget, not the one of ref_widgets.
*)
`;

async function workspace() {
  const { shared, ExpressP11 } = createExpressP11Services(EmptyFileSystem);
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
  const documents = (
    [
      ["ref_widgets", widgets],
      ["ref_base", base],
    ] as const
  ).map(([name, text]) => {
    const document = LangiumDocumentFactory.fromString(text, URI.parse(`memory:///${name}.exp`));
    LangiumDocuments.addDocument(document);
    return document;
  });
  await DocumentBuilder.build(documents, { validation: true });
  const byUri = new Map(documents.map((document) => [document.textDocument.uri, document]));
  /** The position `into` characters into the first `needle` that follows the first `after`. */
  const at = (document: LangiumDocument, after: string, needle: string, into = 1) => {
    const text = document.textDocument.getText();
    const from = text.indexOf(after);
    const found = text.indexOf(needle, from);
    if (from < 0 || found < 0) throw new Error(`no "${needle}" after "${after}"`);
    return { textDocument: { uri: document.textDocument.uri }, position: document.textDocument.positionAt(found + into) };
  };
  /** `file:line | the line, with the place in brackets`, in file and position order. */
  const show = (uri: string, range: TextEdit["range"]): string => {
    const target = byUri.get(uri)!.textDocument;
    const line = target.getText({ start: { line: range.start.line, character: 0 }, end: { line: range.start.line + 1, character: 0 } }).replace(/\r?\n$/, "");
    return `${uri.split("/").pop()}:${String(range.start.line + 1).padStart(2, "0")} | ${line.slice(0, range.start.character)}[${line.slice(range.start.character, range.end.character)}]${line.slice(range.end.character)}`;
  };
  const references = async (document: LangiumDocument, after: string, needle: string, into = 1): Promise<string[]> => {
    const found = await ExpressP11.lsp.ReferencesProvider!.findReferences(document, { ...at(document, after, needle, into), context: { includeDeclaration: true } });
    return found.map((location) => show(location.uri, location.range)).sort();
  };
  const rename = async (document: LangiumDocument, after: string, needle: string, newName: string, into = 1): Promise<string[] | undefined> => {
    const edit = await ExpressP11.lsp.RenameProvider!.rename(document, { ...at(document, after, needle, into), newName });
    if (!edit) return undefined;
    return Object.entries(edit.changes ?? {})
      .flatMap(([uri, edits]) => edits.map((change) => show(uri, change.range)))
      .sort();
  };
  const prepare = async (document: LangiumDocument, after: string, needle: string, into = 1): Promise<string | undefined> => {
    const range = (await ExpressP11.lsp.RenameProvider!.prepareRename!(document, at(document, after, needle, into))) as TextEdit["range"] | undefined;
    return range ? document.textDocument.getText(range) : undefined;
  };
  return { widgetsDoc: documents[0], baseDoc: documents[1], references, rename, prepare };
}

const W = "ref_widgets.exp";
const B = "ref_base.exp";

describe("Find All References with the description blocks", () => {
  test("from an entity: its uses in EXPRESS, the keys, the cross-references and the name in the text", async () => {
    const { widgetsDoc, references } = await workspace();
    expect(await references(widgetsDoc, "ENTITY widget", "widget")).toEqual([
      `${B}:09 | An **anchor** holds a <<express:ref_widgets.[widget]>> in place.`,
      `${W}:05 | ENTITY [widget];`,
      `${W}:16 | ENTITY geared_widget SUBTYPE OF ([widget]);`,
      `${W}:17 |   SELF\\[widget].teeth : INTEGER;`,
      `${W}:20 |   parts : SET [1:?] OF [widget];`,
      `${W}:22 | FUNCTION count_teeth (w : [widget]) : INTEGER;`,
      `${W}:29 | (*"ref_widgets.[widget]"`,
      `${W}:30 | A **[widget]** is a part; a Widget has teeth.`,
      `${W}:30 | A **widget** is a part; a [Widget] has teeth.`,
      `${W}:31 | See <<express:ref_widgets.[widget].teeth,teeth>> and <<express:ref_widgets.widget.teeth,its teeth>>.`,
      `${W}:31 | See <<express:ref_widgets.widget.teeth,teeth>> and <<express:ref_widgets.[widget].teeth,its teeth>>.`,
      `${W}:34 | (*"ref_widgets.[widget].__note"`,
      `${W}:37 | (*"ref_widgets.[widget].teeth"`,
      `${W}:40 | (*"ref_widgets.[widget].wr:named"`,
      `${W}:43 | (*"ref_widgets.[widget].named"`,
      `${W}:46 | (*"ref_widgets.[widget].ur:one_name"`,
      `${W}:52 | (*"ref_widgets.geared_widget.SELF\\[widget].teeth"`,
      `${W}:59 | The [widget] counted.`,
      `${W}:62 | An assembly of <<express:ref_widgets.[widget],widget>> parts; see <<express:ref_widgets.widget,the widget>>.`,
      `${W}:62 | An assembly of <<express:ref_widgets.widget,widget>> parts; see <<express:ref_widgets.[widget],the widget>>.`,
    ]);
  });

  test("from a key, a cross-reference and a name in the text: the same list as from the declaration", async () => {
    const { widgetsDoc, baseDoc, references } = await workspace();
    const fromDeclaration = await references(widgetsDoc, "ENTITY widget", "widget");
    expect(await references(widgetsDoc, '(*"ref_widgets.widget"', ".widget", 2)).toEqual(fromDeclaration);
    expect(await references(baseDoc, "holds a <<express:", ".widget", 2)).toEqual(fromDeclaration);
    expect(await references(widgetsDoc, "An assembly of", "the widget", 0)).toEqual(fromDeclaration);
    expect(await references(widgetsDoc, "A **widget**", "widget")).toEqual(fromDeclaration);
  });

  test("an entity of the same name in another schema is another declaration", async () => {
    const { baseDoc, references } = await workspace();
    expect(await references(baseDoc, "ENTITY widget", "widget")).toEqual([
      `${B}:05 | ENTITY [widget];`,
      `${B}:11 | (*"ref_base.[widget]"`,
      `${B}:12 | Another [widget], not the one of ref_widgets.`,
    ]);
  });

  test("an attribute and the attribute that redeclares it are listed together", async () => {
    const { widgetsDoc, references } = await workspace();
    const expected = [
      `${W}:07 |   [teeth] : OPTIONAL INTEGER;`,
      `${W}:10 |   toothed : BOOLEAN := EXISTS([teeth]);`,
      `${W}:17 |   SELF\\widget.[teeth] : INTEGER;`,
      `${W}:23 |   RETURN (w.[teeth]);`,
      `${W}:30 | A **widget** is a part; a Widget has [teeth].`,
      `${W}:31 | See <<express:ref_widgets.widget.[teeth],teeth>> and <<express:ref_widgets.widget.teeth,its teeth>>.`,
      `${W}:31 | See <<express:ref_widgets.widget.teeth,teeth>> and <<express:ref_widgets.widget.[teeth],its teeth>>.`,
      `${W}:37 | (*"ref_widgets.widget.[teeth]"`,
      `${W}:38 | The [teeth].`,
      `${W}:49 | (*"ref_widgets.geared_widget.[teeth]"`,
      `${W}:52 | (*"ref_widgets.geared_widget.SELF\\widget.[teeth]"`,
    ];
    expect(await references(widgetsDoc, "  teeth :", "teeth")).toEqual(expected);
    expect(await references(widgetsDoc, '(*"ref_widgets.geared_widget.teeth"', "teeth")).toEqual(expected);
  });

  test("a WHERE rule, which nothing in EXPRESS refers to: its label and its keys, with and without wr", async () => {
    const { widgetsDoc, references } = await workspace();
    expect(await references(widgetsDoc, "  named:", "named")).toEqual([
      `${W}:14 |   [named]: name <> '';`,
      `${W}:40 | (*"ref_widgets.widget.wr:[named]"`,
      `${W}:43 | (*"ref_widgets.widget.[named]"`,
    ]);
  });

  test("an interfaced entity cited under the name of the schema that uses it", async () => {
    const { baseDoc, references } = await workspace();
    expect(await references(baseDoc, "ENTITY anchor", "anchor")).toEqual([
      `${B}:02 | ENTITY [anchor];`,
      `${B}:08 | (*"ref_base.[anchor]"`,
      `${B}:09 | An **[anchor]** holds a <<express:ref_widgets.widget>> in place.`,
      `${W}:02 | USE FROM ref_base ([anchor]);`,
      `${W}:08 |   fixed_to : [anchor];`,
      `${W}:32 | It is fixed to <<express:ref_widgets.[anchor],anchor>>, cited under its own schema's name.`,
    ]);
  });

  test("a word of a description that names nothing has no references", async () => {
    const { widgetsDoc, references } = await workspace();
    expect(await references(widgetsDoc, "The schema of widgets", "schema")).toEqual([]);
  });
});

describe("Rename with the description blocks", () => {
  test("an entity: EXPRESS, keys, cross-reference targets, and display text only where it is the old name", async () => {
    const { widgetsDoc, rename } = await workspace();
    const expected = [
      `${B}:09 | An **anchor** holds a <<express:ref_widgets.[widget]>> in place.`,
      `${W}:05 | ENTITY [widget];`,
      `${W}:16 | ENTITY geared_widget SUBTYPE OF ([widget]);`,
      `${W}:17 |   SELF\\[widget].teeth : INTEGER;`,
      `${W}:20 |   parts : SET [1:?] OF [widget];`,
      `${W}:22 | FUNCTION count_teeth (w : [widget]) : INTEGER;`,
      `${W}:29 | (*"ref_widgets.[widget]"`,
      `${W}:31 | See <<express:ref_widgets.[widget].teeth,teeth>> and <<express:ref_widgets.widget.teeth,its teeth>>.`,
      `${W}:31 | See <<express:ref_widgets.widget.teeth,teeth>> and <<express:ref_widgets.[widget].teeth,its teeth>>.`,
      `${W}:34 | (*"ref_widgets.[widget].__note"`,
      `${W}:37 | (*"ref_widgets.[widget].teeth"`,
      `${W}:40 | (*"ref_widgets.[widget].wr:named"`,
      `${W}:43 | (*"ref_widgets.[widget].named"`,
      `${W}:46 | (*"ref_widgets.[widget].ur:one_name"`,
      `${W}:52 | (*"ref_widgets.geared_widget.SELF\\[widget].teeth"`,
      `${W}:62 | An assembly of <<express:ref_widgets.[widget],widget>> parts; see <<express:ref_widgets.widget,the widget>>.`,
      `${W}:62 | An assembly of <<express:ref_widgets.widget,[widget]>> parts; see <<express:ref_widgets.widget,the widget>>.`,
      `${W}:62 | An assembly of <<express:ref_widgets.widget,widget>> parts; see <<express:ref_widgets.[widget],the widget>>.`,
    ];
    expect(await rename(widgetsDoc, "ENTITY widget", "widget", "gadget")).toEqual(expected);
    // The same edits when Rename starts from the key of its description.
    expect(await rename(widgetsDoc, '(*"ref_widgets.widget"', ".widget", "gadget", 2)).toEqual(expected);
  });

  test("the name in the text of a block is left to the author", async () => {
    const { widgetsDoc, rename } = await workspace();
    const edits = (await rename(widgetsDoc, "ENTITY widget", "widget", "gadget"))!;
    expect(edits.some((edit) => edit.includes("A **"))).toBe(false);
    expect(edits.some((edit) => edit.includes("counted"))).toBe(false);
  });

  test("an attribute from the key of its redeclaration: the attribute, the redeclaration and both descriptions", async () => {
    const { widgetsDoc, rename } = await workspace();
    expect(await rename(widgetsDoc, '(*"ref_widgets.geared_widget.teeth"', "teeth", "cogs")).toEqual([
      `${W}:07 |   [teeth] : OPTIONAL INTEGER;`,
      `${W}:10 |   toothed : BOOLEAN := EXISTS([teeth]);`,
      `${W}:17 |   SELF\\widget.[teeth] : INTEGER;`,
      `${W}:23 |   RETURN (w.[teeth]);`,
      `${W}:31 | See <<express:ref_widgets.widget.[teeth],teeth>> and <<express:ref_widgets.widget.teeth,its teeth>>.`,
      `${W}:31 | See <<express:ref_widgets.widget.teeth,[teeth]>> and <<express:ref_widgets.widget.teeth,its teeth>>.`,
      `${W}:31 | See <<express:ref_widgets.widget.teeth,teeth>> and <<express:ref_widgets.widget.[teeth],its teeth>>.`,
      `${W}:37 | (*"ref_widgets.widget.[teeth]"`,
      `${W}:49 | (*"ref_widgets.geared_widget.[teeth]"`,
      `${W}:52 | (*"ref_widgets.geared_widget.SELF\\widget.[teeth]"`,
    ]);
  });

  test("a WHERE rule, a UNIQUE rule, an enumeration item and a parameter", async () => {
    const { widgetsDoc, rename } = await workspace();
    expect(await rename(widgetsDoc, '(*"ref_widgets.widget.wr:named"', "named", "has_name")).toEqual([
      `${W}:14 |   [named]: name <> '';`,
      `${W}:40 | (*"ref_widgets.widget.wr:[named]"`,
      `${W}:43 | (*"ref_widgets.widget.[named]"`,
    ]);
    expect(await rename(widgetsDoc, "  one_name:", "one_name", "unique_name")).toEqual([
      `${W}:12 |   [one_name]: name;`,
      `${W}:46 | (*"ref_widgets.widget.ur:[one_name]"`,
    ]);
    expect(await rename(widgetsDoc, "ENUMERATION OF", "glossy", "shiny")).toEqual([
      `${W}:03 | TYPE finish_kind = ENUMERATION OF (matte, [glossy]);`,
      `${W}:55 | (*"ref_widgets.finish_kind.[glossy]"`,
    ]);
    expect(await rename(widgetsDoc, "FUNCTION count_teeth", "w ", "part", 0)).toEqual([
      `${W}:22 | FUNCTION count_teeth ([w] : widget) : INTEGER;`,
      `${W}:23 |   RETURN ([w].teeth);`,
      `${W}:58 | (*"ref_widgets.count_teeth.[w]"`,
    ]);
  });

  test("an interfaced entity: also where it is cited under the name of the schema that uses it", async () => {
    const { baseDoc, rename } = await workspace();
    expect(await rename(baseDoc, "ENTITY anchor", "anchor", "mooring")).toEqual([
      `${B}:02 | ENTITY [anchor];`,
      `${B}:08 | (*"ref_base.[anchor]"`,
      `${W}:02 | USE FROM ref_base ([anchor]);`,
      `${W}:08 |   fixed_to : [anchor];`,
      `${W}:32 | It is fixed to <<express:ref_widgets.[anchor],anchor>>, cited under its own schema's name.`,
      `${W}:32 | It is fixed to <<express:ref_widgets.anchor,[anchor]>>, cited under its own schema's name.`,
    ]);
  });

  test("an entity of the same name in another schema is not touched", async () => {
    const { baseDoc, rename } = await workspace();
    expect(await rename(baseDoc, "ENTITY widget", "widget", "thing")).toEqual([`${B}:05 | ENTITY [widget];`, `${B}:11 | (*"ref_base.[widget]"`]);
  });

  test("a schema: its name, the interface statements, and the first part of every key and cross-reference", async () => {
    const { baseDoc, rename } = await workspace();
    expect(await rename(baseDoc, "SCHEMA ref_base", "ref_base", "ref_ground")).toEqual([
      `${B}:01 | SCHEMA [ref_base];`,
      `${B}:08 | (*"[ref_base].anchor"`,
      `${B}:11 | (*"[ref_base].widget"`,
      `${W}:02 | USE FROM [ref_base] (anchor);`,
    ]);
  });

  test("where Rename may start: on a name in a key or a cross-reference target, not on a role, display text or a word", async () => {
    const { widgetsDoc, prepare } = await workspace();
    expect(await prepare(widgetsDoc, "ENTITY widget", "widget")).toBe("widget");
    expect(await prepare(widgetsDoc, "  named:", "named")).toBe("named");
    expect(await prepare(widgetsDoc, '(*"ref_widgets.widget.wr:named"', "named", 2)).toBe("named");
    expect(await prepare(widgetsDoc, '(*"ref_widgets.widget.wr:named"', "wr:", 1)).toBeUndefined();
    expect(await prepare(widgetsDoc, "See <<express:", "teeth")).toBe("teeth");
    expect(await prepare(widgetsDoc, '(*"ref_widgets.widget.__note"', "__note", 3)).toBeUndefined();
    expect(await prepare(widgetsDoc, "See <<express:", "its teeth")).toBeUndefined();
    expect(await prepare(widgetsDoc, "A **widget**", "widget")).toBeUndefined();
    expect(await prepare(widgetsDoc, '(*"ref_widgets.geared_widget.SELF', "widget.teeth", 2)).toBeUndefined();
  });

  test("a new name that is not an EXPRESS identifier is refused", async () => {
    const { widgetsDoc, rename } = await workspace();
    await expect(rename(widgetsDoc, "ENTITY widget", "widget", "2 gadgets")).rejects.toThrow(/not an EXPRESS identifier/);
    await expect(rename(widgetsDoc, "ENTITY widget", "widget", "_gadget")).rejects.toThrow(/not an EXPRESS identifier/);
  });
});
