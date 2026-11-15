import { EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

async function fixed(text: string, code: string): Promise<{ title: string; text: string } | undefined> {
  const result = await validate(text);
  const diagnostic = result.diagnostics.find((d) => d.code === code);
  if (!diagnostic) return undefined;
  const actions = await services.lsp.CodeActionProvider?.getCodeActions(result.document, {
    textDocument: { uri: result.document.uri.toString() },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });
  const action = actions?.[0];
  if (!action || !("edit" in action)) return undefined;
  const edits = action.edit?.changes?.[result.document.uri.toString()] ?? [];
  return { title: action.title, text: TextDocument.applyEdits(result.document.textDocument, edits) };
}

const wrap = (body: string, eol = "\n"): string =>
  ["SCHEMA demo_schema;", "ENTITY widget;", "END_ENTITY;", "END_SCHEMA;", '(*"demo_schema.widget"', body, "*)", ""].join(eol);

describe("annotation quick fixes", () => {
  test("annotation-continuation-without-list replaces the + with a blank line", async () => {
    const result = await fixed(wrap("Para.\n+\nimage::a.gif[]"), "annotation-continuation-without-list");
    expect(result?.title).toBe('Replace the "+" with a blank line');
    expect(result?.text).toBe(wrap("Para.\n\nimage::a.gif[]"));
  });

  test("annotation-glued-continuation removes the + outside a chain", async () => {
    expect((await fixed(wrap("image::a.gif[]+"), "annotation-glued-continuation"))?.text).toBe(wrap("image::a.gif[]"));
  });

  test("annotation-glued-continuation moves the + to its own line inside a chain, in the file's line ending", async () => {
    const result = await fixed(wrap(". item\r\n+\r\nimage::a.gif[]+\r\nimage::b.gif[]", "\r\n"), "annotation-glued-continuation");
    expect(result?.text).toContain("image::a.gif[]\r\n+\r\nimage::b.gif[]");
  });

  test("no quick fix for the Class B rules", async () => {
    expect(await fixed(wrap("--\ntext\n--"), "annotation-open-block-delimiter")).toBeUndefined();
    expect(await fixed(wrap(". item\n+\nimage::a.gif[]"), "annotation-list-chain-macro")).toBeUndefined();
  });
});
