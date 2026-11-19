import { EmptyFileSystem, URI } from "langium";
import { describe, expect, test } from "vitest";
import type { CompletionItem, TextEdit } from "vscode-languageserver";
import { CompletionTriggerKind, InsertTextFormat } from "vscode-languageserver";
import { completionSiteAt } from "../language/annotation/completion.js";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * Type-ahead in the description blocks after END_SCHEMA: the parts of a key, the target of an
 * `<<express:...>>` cross-reference, the bold subject, and names in the text when asked for.
 * The grammar reads these blocks as remarks, so Langium's completion offers nothing there.
 */
const widgets = `SCHEMA cmp_widgets;
USE FROM cmp_base (anchor);
CONSTANT
  max_teeth : INTEGER := 40;
END_CONSTANT;
TYPE finish_kind = ENUMERATION OF (matte, glossy);
END_TYPE;
ENTITY widget;
  name : STRING;
  teeth : OPTIONAL INTEGER;
DERIVE
  toothed : BOOLEAN := EXISTS(teeth);
UNIQUE
  one_name: name;
WHERE
  named: name <> '';
  --IP1: A widget is made of one material.
END_ENTITY;
ENTITY geared_widget SUBTYPE OF (widget);
  SELF\\widget.teeth : INTEGER;
END_ENTITY;
FUNCTION count_teeth (w : widget) : INTEGER;
  RETURN (w.teeth);
END_FUNCTION;
RULE some_widget FOR (widget);
WHERE
  any: SIZEOF(widget) > 0;
END_RULE;
END_SCHEMA;
(*"cmp_widgets.widget"
A **widget** is a part.
*)
(*"cmp_widgets.widget.teeth"
The number of teeth.
*)
(*"cmp_widgets.__expressg"
[.svgmap]
*)
`;
const base = `SCHEMA cmp_base;
ENTITY anchor;
  depth : REAL;
END_ENTITY;
ENTITY hook;
END_ENTITY;
END_SCHEMA;
(*"cmp_base.anchor"
An **anchor** holds a part.
*)
`;

/**
 * The entries offered at the `|` of `tail`, which is appended to the schema file `cmp_widgets.exp`
 * (or put in place of `replace` in it). `typed`: the list was opened by a trigger character.
 */
async function offered(tail: string, options: { typed?: boolean; replace?: string } = {}) {
  const { shared, ExpressP11 } = createExpressP11Services(EmptyFileSystem);
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = shared.workspace;
  const marked = options.replace ? widgets.replace(options.replace, tail) : widgets + tail;
  const at = marked.indexOf("|");
  if (at < 0) throw new Error("no cursor in the text");
  const text = marked.slice(0, at) + marked.slice(at + 1);
  const documents = [
    LangiumDocumentFactory.fromString(text, URI.parse("memory:///cmp_widgets.exp")),
    LangiumDocumentFactory.fromString(base, URI.parse("memory:///cmp_base.exp")),
  ];
  for (const document of documents) LangiumDocuments.addDocument(document);
  await DocumentBuilder.build(documents, { validation: true });
  const position = documents[0].textDocument.positionAt(at);
  const list = await ExpressP11.lsp.CompletionProvider!.getCompletion(documents[0], {
    textDocument: { uri: documents[0].textDocument.uri },
    position,
    context: options.typed ? { triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: text[at - 1] } : { triggerKind: CompletionTriggerKind.Invoked },
  });
  const items = [...(list?.items ?? [])].sort((a, b) => (a.sortText ?? "").localeCompare(b.sortText ?? ""));
  /** The text of the line of the cursor after the entry is accepted, the snippet's place in brackets. */
  const accept = (label: string): string => {
    const item = items.find((candidate) => candidate.label === label);
    if (!item) throw new Error(`no entry ${label} among ${items.map((candidate) => candidate.label).join(", ")}`);
    const edit = item.textEdit as TextEdit;
    const start = documents[0].textDocument.offsetAt(edit.range.start);
    const end = documents[0].textDocument.offsetAt(edit.range.end);
    const inserted = item.insertTextFormat === InsertTextFormat.Snippet ? edit.newText.replace(/\$\{1:([^}]*)\}/, "[$1]") : edit.newText;
    const after = text.slice(0, start) + inserted + text.slice(end);
    const lineStart = after.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = after.indexOf("\n", start);
    return after.slice(lineStart, lineEnd < 0 ? after.length : lineEnd);
  };
  return { list, items, labels: items.map((item) => item.label), accept, of: (label: string): CompletionItem | undefined => items.find((item) => item.label === label) };
}

describe("type-ahead in the key of a description block", () => {
  test("with nothing typed: the schema whose END_SCHEMA the block follows", async () => {
    const { labels, accept } = await offered('(*"|', { typed: true });
    expect(labels).toEqual(["cmp_widgets"]);
    expect(accept("cmp_widgets")).toBe('(*"cmp_widgets');
  });

  test("after the schema: its declarations, the ones without a block first, then the schema-level roles", async () => {
    const { labels, of } = await offered('(*"cmp_widgets.|', { typed: true });
    expect(labels).toEqual(["count_teeth", "finish_kind", "geared_widget", "max_teeth", "some_widget", "widget", "__example", "__expressg", "__figure", "__fund_cons", "__note", "__table"]);
    expect(of("widget")).toMatchObject({ detail: "Entity, described", documentation: "A **widget** is a part." });
    expect(of("count_teeth")).toMatchObject({ detail: "Function" });
    expect(of("max_teeth")).toMatchObject({ detail: "Constant" });
    expect(of("some_widget")).toMatchObject({ detail: "Rule" });
    expect(of("__note")).toMatchObject({ detail: "Role" });
  });

  test("after an entity: its attributes, its rules, its informal propositions, then the roles", async () => {
    const { labels, of, accept } = await offered('(*"cmp_widgets.widget.|', { typed: true });
    expect(labels).toEqual(["name", "toothed", "ur:one_name", "wr:IP1", "wr:named", "teeth", "__example", "__figure", "__note", "__table"]);
    expect(of("teeth")).toMatchObject({ detail: "Attribute, described" });
    expect(of("toothed")).toMatchObject({ detail: "Derived attribute" });
    expect(of("wr:named")).toMatchObject({ detail: "WHERE rule" });
    expect(of("ur:one_name")).toMatchObject({ detail: "UNIQUE rule" });
    expect(of("wr:IP1")).toMatchObject({ detail: "Informal proposition" });
    expect(accept("wr:named")).toBe('(*"cmp_widgets.widget.wr:named');
  });

  test("a rule label being typed is replaced whole, the wr: with it", async () => {
    const { labels, accept } = await offered('(*"cmp_widgets.widget.wr:na|', { typed: false });
    expect(labels).toContain("wr:named");
    expect(accept("wr:named")).toBe('(*"cmp_widgets.widget.wr:named');
  });

  test("a redeclared attribute is offered as it is keyed; an enumeration type offers its items; a function its parameters", async () => {
    expect((await offered('(*"cmp_widgets.geared_widget.|')).labels).toEqual(["teeth", "__example", "__figure", "__note", "__table"]);
    expect((await offered('(*"cmp_widgets.finish_kind.|')).labels).toEqual(["glossy", "matte", "__example", "__figure", "__note", "__table"]);
    expect((await offered('(*"cmp_widgets.count_teeth.|')).labels).toEqual(["w", "__example", "__figure", "__note", "__table"]);
  });

  test("after a member: the roles; after a role, another schema or a name that is not declared: nothing", async () => {
    expect((await offered('(*"cmp_widgets.widget.teeth.|')).labels).toEqual(["__example", "__figure", "__note", "__table"]);
    expect((await offered('(*"cmp_widgets.widget.__note.|')).labels).toEqual([]);
    expect((await offered('(*"cmp_base.|')).labels).toEqual([]);
    expect((await offered('(*"cmp_widgets.gadget.|')).labels).toEqual([]);
  });

  test("in the key of a block that is already written, the part under the cursor is replaced", async () => {
    const { accept } = await offered('(*"cmp_widgets.widget.te|eth"', { replace: '(*"cmp_widgets.widget.teeth"' });
    expect(accept("name")).toBe('(*"cmp_widgets.widget.name"');
  });
});

describe("type-ahead in a cross-reference", () => {
  const inBlock = (line: string) => `(*"cmp_widgets.finish_kind"\n${line}\n*)\n`;

  test("with nothing typed: this schema, the schemas it interfaces, then the others; a dot follows", async () => {
    const { labels, of, accept } = await offered(inBlock("See <<express:|"), { typed: true });
    expect(labels).toEqual(["cmp_widgets", "cmp_base"]);
    expect(of("cmp_widgets")).toMatchObject({ detail: "This schema" });
    expect(of("cmp_base")).toMatchObject({ detail: "Schema, interfaced", command: { command: "editor.action.triggerSuggest" } });
    expect(accept("cmp_base")).toBe("See <<express:cmp_base.");
  });

  test("after a schema: what it declares, then what it reaches, written under the schema that declares it", async () => {
    const { labels, of, accept } = await offered(inBlock("See <<express:cmp_widgets.|"), { typed: true });
    // The block's own subject, finish_kind, is not offered.
    expect(labels).toEqual(["count_teeth", "geared_widget", "max_teeth", "some_widget", "widget", "anchor"]);
    expect(of("anchor")).toMatchObject({ detail: "Entity, declared in cmp_base" });
    expect(of("widget")).toMatchObject({ detail: "Entity", documentation: "A **widget** is a part." });
    expect(accept("widget")).toBe("See <<express:cmp_widgets.widget,[widget]>>");
    expect(accept("anchor")).toBe("See <<express:cmp_base.anchor,[anchor]>>");
    expect(accept("count_teeth")).toBe("See <<express:cmp_widgets.count_teeth,[count teeth]>>");
  });

  test("the `*)` that the editor writes right after the cursor is kept", async () => {
    const link = await offered('(*"cmp_widgets.finish_kind"\nSee <<express:cmp_widgets.|*)\n', { typed: true });
    expect(link.accept("widget")).toBe("See <<express:cmp_widgets.widget,[widget]>>*)");
    const bold = await offered('(*"cmp_widgets.finish_kind"\nA **|*)\n', { typed: true });
    expect(bold.accept("finish_kind")).toBe("A **finish_kind***)");
    const key = await offered('(*"cmp_widgets.|*)\n', { typed: true });
    expect(key.accept("widget")).toBe('(*"cmp_widgets.widget*)');
  });

  test("after an owner: its attributes, items or parameters, without rules and roles", async () => {
    const { labels, accept } = await offered(inBlock("See <<express:cmp_widgets.widget.|"), { typed: true });
    expect(labels).toEqual(["name", "teeth", "toothed"]);
    expect(accept("teeth")).toBe("See <<express:cmp_widgets.widget.teeth,[teeth]>>");
    expect((await offered(inBlock("See <<express:cmp_base.anchor.|"))).labels).toEqual(["depth"]);
  });

  test("in a cross-reference that is already closed, only the part under the cursor is replaced", async () => {
    const { accept } = await offered(inBlock("See <<express:cmp_widgets.wid|get,the widget>> here."));
    expect(accept("geared_widget")).toBe("See <<express:cmp_widgets.geared_widget,the widget>> here.");
    const bare = await offered(inBlock("See <<express:cmp_widgets.wid|>> here."));
    expect(bare.accept("widget")).toBe("See <<express:cmp_widgets.widget>> here.");
  });

  test("in a .__expressg block the line ends with the place of the area number", async () => {
    const { accept } = await offered("* <<express:cmp_widgets.|\n", { replace: "[.svgmap]\n", typed: true });
    expect(accept("widget")).toBe("* <<express:cmp_widgets.widget>>; ");
  });

  test("a schema that is not loaded, or an owner that is not declared: nothing", async () => {
    expect((await offered(inBlock("See <<express:nowhere.|"))).labels).toEqual([]);
    expect((await offered(inBlock("See <<express:cmp_widgets.gadget.|"))).labels).toEqual([]);
  });
});

describe("type-ahead in the text of a block", () => {
  const inBlock = (key: string, line: string) => `(*"${key}"\n${line}\n*)\n`;

  test("after **: the name of the block's subject, closed", async () => {
    const { labels, accept } = await offered(inBlock("cmp_widgets.finish_kind", "A **|"), { typed: true });
    expect(labels).toEqual(["finish_kind"]);
    expect(accept("finish_kind")).toBe("A **finish_kind**");
    expect((await offered(inBlock("cmp_widgets.widget.wr:named", "The rule **|"))).labels).toEqual(["named"]);
    expect((await offered(inBlock("cmp_widgets.geared_widget.SELF\\widget.teeth.__note", "The **|"))).labels).toEqual(["teeth"]);
  });

  test("after ** that closes a bold name: nothing of the subject", async () => {
    expect((await offered(inBlock("cmp_widgets.finish_kind", "A **finish_kind**|"), { typed: true })).labels).toEqual([]);
  });

  test("a name in the text: nothing while typing; when asked, the subject's members, then the schema's names", async () => {
    expect((await offered(inBlock("cmp_widgets.widget.__note", "It has tee|"), { typed: true })).list?.items).toEqual([]);
    const { labels, accept, of } = await offered(inBlock("cmp_widgets.widget.__note", "It has tee|"));
    expect(labels.slice(0, 5)).toEqual(["name", "named", "one_name", "teeth", "toothed"]);
    expect(labels).toContain("geared_widget");
    expect(of("anchor")).toMatchObject({ detail: "Entity, declared in cmp_base" });
    expect(accept("teeth")).toBe("It has teeth");
  });
});

describe("where nothing of the description blocks is offered", () => {
  test("in the EXPRESS of the schema a trigger character opens no list, and Ctrl+Space gives Langium's list as before", async () => {
    const typed = await offered("  fixed_to : |anchor;", { replace: "  teeth : OPTIONAL INTEGER;", typed: true });
    expect(typed.list).toBeUndefined();
    const asked = await offered("  fixed_to : |anchor;", { replace: "  teeth : OPTIONAL INTEGER;" });
    expect(asked.labels).toContain("anchor");
    expect(asked.labels).toContain("widget");
  });

  test("in a remark inside the schema, in an unkeyed remark after it, and outside every remark", async () => {
    expect((await offered('(*"cmp_widgets.|"\n*)\nENTITY widget;', { replace: "ENTITY widget;", typed: true })).list).toBeUndefined();
    expect((await offered("(* A note: see <<express:|\n*)\n", { typed: true })).list).toBeUndefined();
    expect((await offered("<<express:|", { typed: true })).list).toBeUndefined();
  });

  test("in a long form", () => {
    const text = 'SCHEMA Cmp_widgets_mim_lf;\nEND_SCHEMA;\n(*"Cmp_widgets_mim_lf.';
    const context = { schema: "Cmp_widgets_mim_lf", start: text.indexOf("\n(*"), end: text.length, blocks: [], unkeyed: [] };
    expect(completionSiteAt([context], text, text.length)).toBeUndefined();
    expect(completionSiteAt([{ ...context, schema: "cmp_widgets" }], text, text.length)).toMatchObject({ kind: "key", typed: "Cmp_widgets_mim_lf." });
  });
});
