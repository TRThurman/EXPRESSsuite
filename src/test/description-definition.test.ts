import { EmptyFileSystem, URI } from "langium";
import type { LangiumDocument } from "langium";
import { describe, expect, test } from "vitest";
import { validateMessage } from "../extension/webview-message.js";
import { createExpressP11Services } from "../language/express-module.js";
import type { ExpressP11DefinitionProvider } from "../language/express-p11-definition-provider.js";

/**
 * Go to Definition from a description block after END_SCHEMA: from each form of key, from an
 * `<<express:...>>` cross-reference and from a name in the text, to the declaration named.
 * The grammar reads these blocks as remarks, so Langium's own provider finds nothing in them.
 */
const widgets = `SCHEMA probe_widgets;
USE FROM probe_base (anchor);
CONSTANT
  max_teeth : INTEGER := 12;
END_CONSTANT;
TYPE finish_kind = ENUMERATION OF (matte, glossy);
END_TYPE;
TYPE tooth_count = INTEGER;
WHERE
  positive_count: SELF > 0;
END_TYPE;
ENTITY widget;
  name : STRING;
  teeth : OPTIONAL tooth_count;
  fixed_to : anchor;
DERIVE
  toothed : BOOLEAN := EXISTS(teeth);
INVERSE
  used_in : SET OF assembly FOR parts;
UNIQUE
  one_name: name;
WHERE
  named: name <> '';
  --IP1: The name shall be meaningful.
END_ENTITY;
ENTITY geared_widget SUBTYPE OF (widget);
  SELF\\widget.teeth : tooth_count;
END_ENTITY;
ENTITY assembly;
  parts : SET [1:?] OF widget;
END_ENTITY;
SUBTYPE_CONSTRAINT widget_kinds FOR widget;
  ONEOF(geared_widget);
END_SUBTYPE_CONSTRAINT;
FUNCTION count_teeth (w : widget) : INTEGER;
  FUNCTION inner_count (x : INTEGER) : INTEGER;
    RETURN (x);
  END_FUNCTION;
  RETURN (inner_count(0));
END_FUNCTION;
ENTITY gasket;
END_ENTITY;
PROCEDURE reset_teeth (VAR w : widget);
END_PROCEDURE;
RULE some_widget FOR (widget);
WHERE
  at_least_one: SIZEOF(widget) > 0;
END_RULE;
END_SCHEMA;
(*"probe_widgets"
The schema of widgets.
*)
(*"probe_widgets.__fund_cons"
Fundamental concepts, with <<express:probe_widgets.widget,widget>> first.
*)
(*"probe_widgets.max_teeth"
A constant.
*)
(*"probe_widgets.finish_kind"
A kind of finish.
*)
(*"probe_widgets.finish_kind.glossy"
Shiny.
*)
(*"probe_widgets.tooth_count"
A count.
*)
(*"probe_widgets.tooth_count.wr:positive_count"
The count is positive.
*)
(*"probe_widgets.widget"
A **widget** is a part. It is fixed to an anchor and has teeth.
See <<express:probe_widgets.geared_widget,geared widget>> and <<express:probe_base.anchor>>
and <<express:probe_widgets.widget.teeth,its teeth>> and <<express:probe_base>> and count_teeth.
It cites <<express:probe_widgets.anchor,the anchor>> under its own schema's name.
The rule is <<express:probe_widgets.widget.wr:named>>. Anchors come from probe_base as a whole.
*)
(*"probe_widgets.widget.__note"
A note on the widget.
*)
(*"probe_widgets.widget.name"
The name.
*)
(*"probe_widgets.widget.toothed"
Derived.
*)
(*"probe_widgets.widget.used_in"
Inverse.
*)
(*"probe_widgets.widget.ur:one_name"
Unique.
*)
(*"probe_widgets.widget.wr:named"
Named.
*)
(*"probe_widgets.widget.wr:IP1"
An informal proposition.
*)
(*"probe_widgets.widget.name.__example"
An example of a name.
*)
(*"probe_widgets.geared_widget.teeth"
Redeclared.
*)
(*"probe_widgets.geared_widget.SELF\\widget.teeth"
Redeclared, written with the supertype.
*)
(*"probe_widgets.widget_kinds"
A constraint.
*)
(*"probe_widgets.count_teeth"
A function.
*)
(*"probe_widgets.count_teeth.w"
Its parameter.
*)
(*"probe_widgets.reset_teeth"
A procedure.
*)
(*"probe_widgets.some_widget"
A global rule.
*)
(*"probe_widgets.some_widget.wr:at_least_one"
Its WHERE rule.
*)
(*"probe_widgets.widget.no_such_member"
A key whose last part names nothing.
*)
(*"probe_widgets.reset_teeth.w"
The parameter of the procedure.
*)
(*"probe_widgets.widget.IP1"
An informal proposition, keyed without wr.
*)
(*"probe_widgets.widget.named"
A WHERE rule keyed without wr.
*)
(*"probe_widgets.widget.one_name"
A UNIQUE rule keyed without ur.
*)
(*"probe_widgets.inner_count"
A function declared inside a function.
*)
(*"probe_widgets.__expressg"
[.svgmap]
====
image::probe_widgetsexpg1.svg[]

* <<express:probe_widgets.assembly>>; 1
====
*)
`;
const base = `SCHEMA probe_base;
ENTITY anchor;
  depth : REAL;
END_ENTITY;
END_SCHEMA;
(*"probe_base.anchor"
An **anchor** holds a widget in place.
See <<express:probe_base.widget>> and <<express:probe_base.no_such_thing>>.
A gasket is not an anchor.
*)
`;

const other = `SCHEMA probe_other;
ENTITY gasket;
END_ENTITY;
END_SCHEMA;
`;

async function workspace() {
  const { shared, ExpressP11 } = createExpressP11Services(EmptyFileSystem);
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
  const documents = (
    [
      ["probe_widgets", widgets],
      ["probe_base", base],
      ["probe_other", other],
    ] as const
  ).map(([name, text]) => {
    const document = LangiumDocumentFactory.fromString(text, URI.parse(`memory:///${name}.exp`));
    LangiumDocuments.addDocument(document);
    return document;
  });
  await DocumentBuilder.build(documents, { validation: true });
  const byUri = new Map(documents.map((document) => [document.textDocument.uri, document]));
  /**
   * Go to Definition with the cursor `into` characters into the first occurrence of `needle` that
   * follows the first occurrence of `after`. Each result is `file: line of the target | name selected`.
   */
  const goto = async (document: LangiumDocument, after: string, needle: string, into = 1): Promise<string[]> => {
    const text = document.textDocument.getText();
    const from = text.indexOf(after);
    const at = text.indexOf(needle, from);
    if (from < 0 || at < 0) throw new Error(`no "${needle}" after "${after}"`);
    const links = (await ExpressP11.lsp.DefinitionProvider!.getDefinition(document, {
      textDocument: { uri: document.textDocument.uri },
      position: document.textDocument.positionAt(at + into),
    })) ?? [];
    return links.map((link) => {
      const target = byUri.get(link.targetUri)!.textDocument;
      const line = target.getText({ start: { line: link.targetSelectionRange.start.line, character: 0 }, end: { line: link.targetSelectionRange.start.line + 1, character: 0 } }).trim();
      return `${link.targetUri.split("/").pop()}: ${line} | ${target.getText(link.targetSelectionRange)}`;
    });
  };
  const show = (links: Array<{ targetUri: string; targetSelectionRange: { start: { line: number; character: number }; end: { line: number; character: number } } }>): string[] =>
    links.map((link) => {
      const target = byUri.get(link.targetUri)!.textDocument;
      const line = target.getText({ start: { line: link.targetSelectionRange.start.line, character: 0 }, end: { line: link.targetSelectionRange.start.line + 1, character: 0 } }).trim();
      return `${link.targetUri.split("/").pop()}: ${line} | ${target.getText(link.targetSelectionRange)}`;
    });
  /** What the "Go to declaration" link of the Show Description panel asks: the declarations of a key. */
  const ofKey = (key: string, from?: LangiumDocument): string[] =>
    show((ExpressP11.lsp.DefinitionProvider as ExpressP11DefinitionProvider).declarationsOfKey(key, from));
  return { goto, ofKey, widgetsDoc: documents[0], baseDoc: documents[1] };
}

const END = "END_SCHEMA;";

describe("Go to Definition from the key of a description block", async () => {
  const { goto, widgetsDoc } = await workspace();
  const key = (name: string, needle: string, into = 1) => goto(widgetsDoc, `(*"${name}"`, needle, into);

  test.each([
    ["the schema", "probe_widgets", "probe_widgets", "SCHEMA probe_widgets; | probe_widgets"],
    ["a schema-level role block", "probe_widgets.__fund_cons", "__fund_cons", "SCHEMA probe_widgets; | probe_widgets"],
    ["a constant", "probe_widgets.max_teeth", "max_teeth", "max_teeth : INTEGER := 12; | max_teeth"],
    ["a type", "probe_widgets.tooth_count", "tooth_count", "TYPE tooth_count = INTEGER; | tooth_count"],
    ["an enumeration type", "probe_widgets.finish_kind", "finish_kind", "TYPE finish_kind = ENUMERATION OF (matte, glossy); | finish_kind"],
    ["an enumeration item", "probe_widgets.finish_kind.glossy", "glossy", "TYPE finish_kind = ENUMERATION OF (matte, glossy); | glossy"],
    ["a WHERE rule of a type", "probe_widgets.tooth_count.wr:positive_count", "wr:positive_count", "positive_count: SELF > 0; | positive_count"],
    ["an entity", "probe_widgets.widget", ".widget\"", "ENTITY widget; | widget"],
    ["a note on an entity", "probe_widgets.widget.__note", "__note", "ENTITY widget; | widget"],
    ["an explicit attribute", "probe_widgets.widget.name", "name", "name : STRING; | name"],
    ["a derived attribute", "probe_widgets.widget.toothed", "toothed", "toothed : BOOLEAN := EXISTS(teeth); | toothed"],
    ["an inverse attribute", "probe_widgets.widget.used_in", "used_in", "used_in : SET OF assembly FOR parts; | used_in"],
    ["a UNIQUE rule", "probe_widgets.widget.ur:one_name", "ur:one_name", "one_name: name; | one_name"],
    ["a WHERE rule of an entity", "probe_widgets.widget.wr:named", "wr:named", "named: name <> ''; | named"],
    ["an informal proposition", "probe_widgets.widget.wr:IP1", "wr:IP1", "--IP1: The name shall be meaningful. | --IP1: The name shall be meaningful."],
    ["an example on an attribute", "probe_widgets.widget.name.__example", "__example", "name : STRING; | name"],
    ["a redeclared attribute", "probe_widgets.geared_widget.teeth", "teeth", "SELF\\widget.teeth : tooth_count; | teeth"],
    ["a redeclared attribute written with its supertype", "probe_widgets.geared_widget.SELF\\widget.teeth", "SELF\\widget.teeth", "SELF\\widget.teeth : tooth_count; | teeth"],
    ["a subtype constraint", "probe_widgets.widget_kinds", "widget_kinds", "SUBTYPE_CONSTRAINT widget_kinds FOR widget; | widget_kinds"],
    ["a function", "probe_widgets.count_teeth", "count_teeth", "FUNCTION count_teeth (w : widget) : INTEGER; | count_teeth"],
    ["a parameter", "probe_widgets.count_teeth.w", ".w\"", "FUNCTION count_teeth (w : widget) : INTEGER; | w"],
    ["a procedure", "probe_widgets.reset_teeth", "reset_teeth", "PROCEDURE reset_teeth (VAR w : widget); | reset_teeth"],
    ["a global rule", "probe_widgets.some_widget", "some_widget", "RULE some_widget FOR (widget); | some_widget"],
    ["a WHERE rule of a global rule", "probe_widgets.some_widget.wr:at_least_one", "wr:at_least_one", "at_least_one: SIZEOF(widget) > 0; | at_least_one"],
    ["a member that does not exist: its owner", "probe_widgets.widget.no_such_member", "no_such_member", "ENTITY widget; | widget"],
    ["a parameter of a procedure", "probe_widgets.reset_teeth.w", ".w\"", "PROCEDURE reset_teeth (VAR w : widget); | w"],
    ["an informal proposition keyed without wr:", "probe_widgets.widget.IP1", ".IP1", "--IP1: The name shall be meaningful. | --IP1: The name shall be meaningful."],
    ["a WHERE rule keyed without wr:", "probe_widgets.widget.named", ".named", "named: name <> ''; | named"],
    ["a UNIQUE rule keyed without ur:", "probe_widgets.widget.one_name", ".one_name", "one_name: name; | one_name"],
    ["a function declared inside a function", "probe_widgets.inner_count", "inner_count", "FUNCTION inner_count (x : INTEGER) : INTEGER; | inner_count"],
  ])("%s", async (_what, name, needle, expected) => {
    expect(await key(name, needle)).toEqual([`probe_widgets.exp: ${expected}`]);
  });

  test("the cursor on an earlier part of the key goes to what that part names", async () => {
    expect(await key("probe_widgets.widget.name", "probe_widgets")).toEqual(["probe_widgets.exp: SCHEMA probe_widgets; | probe_widgets"]);
    expect(await key("probe_widgets.widget.name", ".widget.", 2)).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
  });
});

describe("Go to Definition from the text of a description block", async () => {
  const { goto, widgetsDoc, baseDoc } = await workspace();
  const body = (needle: string, into = 1) => goto(widgetsDoc, '(*"probe_widgets.widget"', needle, into);

  test("a cross-reference to a declaration of the same schema", async () => {
    expect(await body("<<express:probe_widgets.geared_widget", "<<express:probe_widgets.".length + 2)).toEqual(["probe_widgets.exp: ENTITY geared_widget SUBTYPE OF (widget); | geared_widget"]);
  });
  test("the display text of a cross-reference", async () => {
    expect(await body("geared widget>>")).toEqual(["probe_widgets.exp: ENTITY geared_widget SUBTYPE OF (widget); | geared_widget"]);
  });
  test("a cross-reference to a declaration of another schema, in another file", async () => {
    expect(await body("<<express:probe_base.anchor", "<<express:probe_base.".length + 2)).toEqual(["probe_base.exp: ENTITY anchor; | anchor"]);
  });
  test("the schema part of a cross-reference, and a cross-reference to a schema", async () => {
    expect(await body("<<express:probe_base.anchor", "<<express:".length + 2)).toEqual(["probe_base.exp: SCHEMA probe_base; | probe_base"]);
    expect(await body("<<express:probe_base>>", "<<express:".length + 2)).toEqual(["probe_base.exp: SCHEMA probe_base; | probe_base"]);
  });
  test("a cross-reference under the name of a schema that interfaces the declaration", async () => {
    expect(await body("<<express:probe_widgets.anchor", "<<express:probe_widgets.".length + 2)).toEqual(["probe_base.exp: ENTITY anchor; | anchor"]);
  });
  test("a cross-reference under the name of a schema that does not declare it, declared in one other schema", async () => {
    expect(await goto(baseDoc, '(*"probe_base.anchor"', "<<express:probe_base.widget", "<<express:probe_base.".length + 2)).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
  });
  test("a cross-reference whose name no schema declares: the schema named", async () => {
    expect(await goto(baseDoc, '(*"probe_base.anchor"', "<<express:probe_base.no_such_thing", "<<express:probe_base.".length + 2)).toEqual(["probe_base.exp: SCHEMA probe_base; | probe_base"]);
  });
  test("a cross-reference to a WHERE rule", async () => {
    expect(await body("<<express:probe_widgets.widget.wr:named", "<<express:probe_widgets.widget.".length + 2)).toEqual(["probe_widgets.exp: named: name <> ''; | named"]);
  });
  test("a mapping line of an EXPRESS-G block", async () => {
    expect(await goto(widgetsDoc, '(*"probe_widgets.__expressg"', "<<express:probe_widgets.assembly", "<<express:probe_widgets.".length + 2)).toEqual(["probe_widgets.exp: ENTITY assembly; | assembly"]);
  });
  test("a plain name that is the name of a schema", async () => {
    expect(await body("probe_base as")).toEqual(["probe_base.exp: SCHEMA probe_base; | probe_base"]);
  });
  test("a plain name that several other schemas declare: each of them", async () => {
    expect((await goto(baseDoc, '(*"probe_base.anchor"', "gasket is")).sort()).toEqual(["probe_other.exp: ENTITY gasket; | gasket", "probe_widgets.exp: ENTITY gasket; | gasket"]);
  });
  test("a cross-reference to an attribute", async () => {
    expect(await body("<<express:probe_widgets.widget.teeth", "<<express:probe_widgets.widget.".length + 1)).toEqual(["probe_widgets.exp: teeth : OPTIONAL tooth_count; | teeth"]);
  });
  test("the bold subject", async () => {
    expect(await body("**widget**", 3)).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
  });
  test("a plain name: an attribute of the entity described, before a declaration", async () => {
    expect(await body("teeth.")).toEqual(["probe_widgets.exp: teeth : OPTIONAL tooth_count; | teeth"]);
  });
  test("a plain name: a declaration of the schema", async () => {
    expect(await body("count_teeth.")).toEqual(["probe_widgets.exp: FUNCTION count_teeth (w : widget) : INTEGER; | count_teeth"]);
  });
  test("a plain name: a declaration the schema reaches through an interface", async () => {
    expect(await body("anchor and")).toEqual(["probe_base.exp: ENTITY anchor; | anchor"]);
  });
  test("a plain name in the other file, declared only in a schema it does not interface", async () => {
    expect(await goto(baseDoc, '(*"probe_base.anchor"', "widget in")).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
  });
  test("a word that names nothing", async () => {
    expect(await body("part.")).toEqual([]);
  });
});

describe("Go to Definition in the EXPRESS of a schema", async () => {
  const { goto, widgetsDoc } = await workspace();
  test("is unchanged: a reference goes to the declaration it is bound to", async () => {
    expect(await goto(widgetsDoc, "ENTITY assembly;", "widget;")).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
    expect(await goto(widgetsDoc, "ENTITY widget;", "anchor;")).toEqual(["probe_base.exp: ENTITY anchor; | anchor"]);
  });
  test(`nothing before the first ${END} is read as a description`, async () => {
    expect(await goto(widgetsDoc, "--IP1", "name shall")).toEqual([]);
  });
});

describe("The Go to declaration link of the Show Description panel", async () => {
  const { ofKey, widgetsDoc } = await workspace();
  test("the key of the panel goes to its declaration, with or without the file that holds the block", () => {
    expect(ofKey("probe_widgets.widget", widgetsDoc)).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
    expect(ofKey("probe_widgets.widget")).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
    expect(ofKey("probe_base.anchor", widgetsDoc)).toEqual(["probe_base.exp: ENTITY anchor; | anchor"]);
  });
  test("a member, a rule, a redeclared attribute and a note go where the same key goes in the editor", () => {
    expect(ofKey("probe_widgets.widget.teeth")).toEqual(["probe_widgets.exp: teeth : OPTIONAL tooth_count; | teeth"]);
    expect(ofKey("probe_widgets.widget.wr:named")).toEqual(["probe_widgets.exp: named: name <> ''; | named"]);
    expect(ofKey("probe_widgets.geared_widget.SELF\\widget.teeth")).toEqual(ofKey("probe_widgets.geared_widget.teeth"));
    expect(ofKey("probe_widgets.widget.__note")).toEqual(["probe_widgets.exp: ENTITY widget; | widget"]);
    expect(ofKey("probe_widgets.__fund_cons")).toEqual(["probe_widgets.exp: SCHEMA probe_widgets; | probe_widgets"]);
  });
  test("an informal proposition goes to its --IPn: line", () => {
    expect(ofKey("probe_widgets.widget.wr:IP1")[0]).toContain("--IP1: The name shall be meaningful.");
  });
  test("a schema that is not loaded has no declaration", () => {
    expect(ofKey("no_such_schema.thing")).toEqual([]);
  });
  test("the panel's message carries nothing the host has to trust", () => {
    expect(validateMessage({ kind: "declaration", key: "anything", uri: "file:///etc/passwd" })).toEqual({ kind: "declaration" });
  });
});
