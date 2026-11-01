import { AstUtils, EmptyFileSystem, isReference, URI } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";
import { isSchemaDefinition } from "../language/generated/ast.js";

/**
 * An unqualified name binds through the schema's interfaces (ISO 10303-11:2004
 * clause 11) before the workspace index, and the index is consulted in
 * document-URI order, so the binding does not depend on the order in which
 * the file system lists the documents. The published SMRL v8 showed the gap:
 * three documents declare `ENTITY class`, and `Catalog_data_information_mim`
 * bound its `RULE ... FOR (class)` to the wrong one on macOS and to the right
 * one on Linux.
 */
const classification = `
  SCHEMA classification_schema;
  ENTITY group;
  END_ENTITY;
  ENTITY class SUBTYPE OF (group);
  END_ENTITY;
  END_SCHEMA;
`;
const other = `
  SCHEMA other_schema;
  ENTITY group;
  END_ENTITY;
  ENTITY class SUBTYPE OF (group);
  END_ENTITY;
  END_SCHEMA;
`;
const interfacing = `
  SCHEMA Catalog_mim;
  USE FROM classification_schema;
  RULE restrict_class FOR (class);
  WHERE
    WR1: SIZEOF(QUERY(c <* class | NOT EXISTS(c))) = 0;
  END_RULE;
  END_SCHEMA;
`;
const standalone = `
  SCHEMA Lonely_mim;
  RULE restrict_class FOR (class);
  WHERE
    WR1: SIZEOF(QUERY(c <* class | NOT EXISTS(c))) = 0;
  END_RULE;
  END_SCHEMA;
`;

/** Builds the documents in the given order; returns the schema each `class` reference of `probe` bound to, and its import errors. */
async function bindingsOf(order: Array<[name: string, text: string]>, probe: string) {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = services.shared.workspace;
  const documents = order.map(([name, text]) => {
    const document = LangiumDocumentFactory.fromString(text, URI.parse(`memory:///${name}.exp`));
    LangiumDocuments.addDocument(document);
    return document;
  });
  await DocumentBuilder.build(documents, { validation: true });
  const document = documents.find((d) => d.uri.path.endsWith(`/${probe}.exp`))!;
  expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
  const targets = document.references
    .filter(isReference)
    .filter((reference) => reference.$refText === "class")
    .map((reference) => (reference.ref ? AstUtils.getContainerOfType(reference.ref, isSchemaDefinition)?.name : undefined) ?? "UNRESOLVED");
  const importErrors = (document.diagnostics ?? []).filter(
    (d) => d.code === ExpressP11Issues.ReferenceStatementMissing || d.code === ExpressP11Issues.ReferenceStatementIncomplete
  );
  return { targets, importErrors };
}

describe("binding order", () => {
  test("a name the interfaces bring in binds there, whichever document the file system listed first", async () => {
    for (const order of [
      [["classification", classification], ["other", other], ["probe", interfacing]],
      [["other", other], ["classification", classification], ["probe", interfacing]],
      [["probe", interfacing], ["other", other], ["classification", classification]],
    ] as Array<Array<[string, string]>>) {
      const { targets, importErrors } = await bindingsOf(order, "probe");
      expect(targets, order.map(([name]) => name).join(",")).toEqual(["classification_schema", "classification_schema"]);
      expect(importErrors, order.map(([name]) => name).join(",")).toHaveLength(0);
    }
  });

  test("a name no interface brings in binds to the first declaration in document-URI order, and the import is reported", async () => {
    for (const order of [
      [["classification", classification], ["other", other], ["probe", standalone]],
      [["other", other], ["classification", classification], ["probe", standalone]],
    ] as Array<Array<[string, string]>>) {
      const { targets, importErrors } = await bindingsOf(order, "probe");
      expect(targets, order.map(([name]) => name).join(",")).toEqual(["classification_schema", "classification_schema"]);
      expect(importErrors.map((d) => d.code), order.map(([name]) => name).join(",")).toEqual([
        ExpressP11Issues.ReferenceStatementMissing,
        ExpressP11Issues.ReferenceStatementMissing,
      ]);
    }
  });
});
