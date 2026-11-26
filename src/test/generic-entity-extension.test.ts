import { EmptyFileSystem, URI } from "langium";
import { TextDocument } from "vscode-languageserver-textdocument";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import type { ExtensionMissingGenericEntityData } from "../language/express-p11-validator.js";

/**
 * ISO 10303-11:2004 8.4.2: "All extensions of that select data type shall be generic-entity select
 * data types and shall specify the GENERIC_ENTITY reserved word", and the syntax admits
 * GENERIC_ENTITY only after EXTENSIBLE, so every extension of a GENERIC_ENTITY select is
 * EXTENSIBLE GENERIC_ENTITY (ruling 2026-11-26, replacing that of 2026-11-21, under which an
 * extension that is not EXTENSIBLE was accepted). EXPRESS Data Manager 10.2.6 reports the same
 * extensions as error C3142.
 */
async function check(body: string) {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = services.shared.workspace;
  const text = `SCHEMA generic_entity_schema;\nENTITY e1; END_ENTITY;\nENTITY e2; END_ENTITY;\n${body}\nEND_SCHEMA;\n`;
  const document = LangiumDocumentFactory.fromString(text, URI.parse("memory:///generic_entity.exp"));
  LangiumDocuments.addDocument(document);
  await DocumentBuilder.build([document], { validation: true });
  expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
  const found = (document.diagnostics ?? []).filter((d) => d.code === "extension-missing-generic-entity");
  const fixed = found.map((d) => {
    const fix = (d.data as ExtensionMissingGenericEntityData).fix;
    return TextDocument.applyEdits(TextDocument.create("memory:///x", "express", 1, text), [{ range: fix.range, newText: fix.newText }]);
  });
  return { found, fixed };
}

const base = "TYPE b = EXTENSIBLE GENERIC_ENTITY SELECT (e1); END_TYPE;";

describe("extension-missing-generic-entity", () => {
  test("an EXTENSIBLE extension of a GENERIC_ENTITY select without GENERIC_ENTITY is an error", async () => {
    const { found, fixed } = await check(`${base}\nTYPE x = EXTENSIBLE SELECT BASED_ON b WITH (e2); END_TYPE;`);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
    expect(found[0].message).toContain("'x' extends 'b', which is GENERIC_ENTITY, so it shall be EXTENSIBLE GENERIC_ENTITY");
    expect((found[0].data as ExtensionMissingGenericEntityData).fix.title).toBe("Add GENERIC_ENTITY");
    expect(fixed[0]).toContain("TYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;");
  });

  test("an extension that is not EXTENSIBLE is an error too: the correction adds EXTENSIBLE GENERIC_ENTITY", async () => {
    const { found, fixed } = await check(`${base}\nTYPE x = SELECT BASED_ON b WITH (e2); END_TYPE;`);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
    expect(found[0].message).toContain("'x' extends 'b', which is GENERIC_ENTITY, so it shall be EXTENSIBLE GENERIC_ENTITY");
    expect((found[0].data as ExtensionMissingGenericEntityData).fix.title).toBe("Add EXTENSIBLE GENERIC_ENTITY");
    expect(fixed[0]).toContain("TYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;");
  });

  test("GENERIC_ENTITY without EXTENSIBLE on an extension is left to generic-entity-without-extensible", async () => {
    expect((await check(`${base}\nTYPE x = GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;`)).found).toEqual([]);
  });

  test("the trial schema sent to Jotne: the three extensions EXPRESS Data Manager 10.2.6 reports (C3142)", async () => {
    const family = [
      "ENTITY a1; END_ENTITY; ENTITY a2; END_ENTITY; ENTITY b1; END_ENTITY; ENTITY c1; END_ENTITY; ENTITY d1; END_ENTITY;",
      "TYPE root_select = EXTENSIBLE GENERIC_ENTITY SELECT; END_TYPE;",
      "TYPE ext_a_select = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON root_select WITH (a1, a2); END_TYPE;",
      "TYPE ext_b_select = SELECT BASED_ON root_select WITH (b1); END_TYPE;",
      "TYPE ext_c_select = SELECT BASED_ON root_select WITH (c1); END_TYPE;",
      "TYPE ext_d_select = SELECT BASED_ON ext_a_select WITH (d1); END_TYPE;",
    ].join("\n");
    const asSent = await check(family);
    expect(asSent.found.map((d) => (d.data as ExtensionMissingGenericEntityData).extension)).toEqual(["ext_b_select", "ext_c_select", "ext_d_select"]);
    const corrected = family.replace(/= SELECT BASED_ON/g, "= EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON");
    expect((await check(corrected)).found).toEqual([]);
  });

  test("an EXTENSIBLE GENERIC_ENTITY extension is not reported", async () => {
    expect((await check(`${base}\nTYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;`)).found).toEqual([]);
  });

  test("an extension of a base that is not GENERIC_ENTITY is not reported", async () => {
    const plain = "TYPE b = EXTENSIBLE SELECT (e1); END_TYPE;";
    expect((await check(`${plain}\nTYPE x = EXTENSIBLE SELECT BASED_ON b WITH (e2); END_TYPE;`)).found).toEqual([]);
  });

  test("an extension of an extension: both extensions of the GENERIC_ENTITY extension are reported", async () => {
    const { found } = await check(
      `${base}\nTYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;\nTYPE y = EXTENSIBLE SELECT BASED_ON x; END_TYPE;\nTYPE z = SELECT BASED_ON x; END_TYPE;`
    );
    expect(found.map((d) => d.message)).toEqual([expect.stringContaining("'y' extends 'x'"), expect.stringContaining("'z' extends 'x'")]);
  });
});

describe("generic-entity-without-extensible: GENERIC_ENTITY only after EXTENSIBLE (8.4.2 syntax)", () => {
  async function diagnosticsOf(body: string) {
    const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
    const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = services.shared.workspace;
    const text = `SCHEMA generic_entity_syntax_schema;\nENTITY e1; END_ENTITY;\nENTITY e2; END_ENTITY;\n${body}\nEND_SCHEMA;\n`;
    const document = LangiumDocumentFactory.fromString(text, URI.parse("memory:///generic_entity_syntax.exp"));
    LangiumDocuments.addDocument(document);
    await DocumentBuilder.build([document], { validation: true });
    const found = (document.diagnostics ?? []).filter((d) => d.code === "generic-entity-without-extensible");
    const apply = (d: (typeof found)[number]) =>
      (d.data as { fixes: { title: string; newText: string; range: never }[] }).fixes.map((fix) => [
        fix.title,
        TextDocument.applyEdits(TextDocument.create("memory:///x", "express", 1, text), [{ range: fix.range, newText: fix.newText }]),
      ]);
    return { found, apply };
  }

  test("a select list: the one correction is to add EXTENSIBLE", async () => {
    const { found, apply } = await diagnosticsOf("TYPE b = GENERIC_ENTITY SELECT (e1); END_TYPE;");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
    const fixes = apply(found[0]);
    expect(fixes.map(([title]) => title)).toEqual(["Add EXTENSIBLE"]);
    expect(fixes[0][1]).toContain("TYPE b = EXTENSIBLE GENERIC_ENTITY SELECT (e1); END_TYPE;");
  });

  test("an extension of a GENERIC_ENTITY select: the one correction is to add EXTENSIBLE", async () => {
    const { found, apply } = await diagnosticsOf(`${base}\nTYPE x = GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;`);
    expect(found).toHaveLength(1);
    expect(found[0].message).not.toContain("without GENERIC_ENTITY");
    const fixes = apply(found[0]);
    expect(fixes.map(([title]) => title)).toEqual(["Add EXTENSIBLE"]);
    expect(fixes[0][1]).toContain("TYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;");
  });

  test("an extension of a select that is not GENERIC_ENTITY: add EXTENSIBLE, or remove GENERIC_ENTITY", async () => {
    const plain = "TYPE p = EXTENSIBLE SELECT (e1); END_TYPE;";
    const { found, apply } = await diagnosticsOf(`${plain}\nTYPE x = GENERIC_ENTITY SELECT BASED_ON p WITH (e2); END_TYPE;`);
    expect(found).toHaveLength(1);
    const fixes = apply(found[0]);
    expect(fixes.map(([title]) => title)).toEqual(["Add EXTENSIBLE", "Remove GENERIC_ENTITY"]);
    expect(fixes[0][1]).toContain("TYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON p WITH (e2); END_TYPE;");
    expect(fixes[1][1]).toContain("TYPE x = SELECT BASED_ON p WITH (e2); END_TYPE;");
  });

  test("EXTENSIBLE GENERIC_ENTITY is not reported", async () => {
    expect((await diagnosticsOf("TYPE b = EXTENSIBLE GENERIC_ENTITY SELECT (e1); END_TYPE;")).found).toEqual([]);
  });
});

describe("the quick fixes through the code action provider", () => {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  let documentCount = 0;
  async function actions(text: string, code: string) {
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, URI.parse(`memory:///${code}-${++documentCount}.exp`));
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
    const diagnostic = (document.diagnostics ?? []).find((d) => d.code === code)!;
    const found = await services.lsp.CodeActionProvider?.getCodeActions(document as never, {
      textDocument: { uri: document.uri.toString() },
      range: diagnostic.range,
      context: { diagnostics: [diagnostic] },
    });
    return (found ?? []).map((action) =>
      "edit" in action ? [action.title, TextDocument.applyEdits(document.textDocument, action.edit?.changes?.[document.uri.toString()] ?? [])] : [action.title, ""]
    );
  }
  const schema = (body: string) => `SCHEMA s;\nENTITY e1; END_ENTITY;\nENTITY e2; END_ENTITY;\n${base}\n${body}\nEND_SCHEMA;\n`;

  test("extension-missing-generic-entity offers Add GENERIC_ENTITY", async () => {
    const found = await actions(schema("TYPE x = EXTENSIBLE SELECT BASED_ON b WITH (e2); END_TYPE;"), "extension-missing-generic-entity");
    expect(found.map(([title]) => title)).toEqual(["Add GENERIC_ENTITY"]);
    expect(found[0][1]).toContain("TYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;");
  });

  test("extension-missing-generic-entity on an extension that is not EXTENSIBLE offers Add EXTENSIBLE GENERIC_ENTITY", async () => {
    const found = await actions(schema("TYPE x = SELECT BASED_ON b WITH (e2); END_TYPE;"), "extension-missing-generic-entity");
    expect(found.map(([title]) => title)).toEqual(["Add EXTENSIBLE GENERIC_ENTITY"]);
    expect(found[0][1]).toContain("TYPE x = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;");
  });

  test("generic-entity-without-extensible on an extension of a GENERIC_ENTITY select offers Add EXTENSIBLE only", async () => {
    const found = await actions(schema("TYPE x = GENERIC_ENTITY SELECT BASED_ON b WITH (e2); END_TYPE;"), "generic-entity-without-extensible");
    expect(found.map(([title]) => title)).toEqual(["Add EXTENSIBLE"]);
  });
});
