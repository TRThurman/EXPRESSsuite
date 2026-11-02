import { EmptyFileSystem, URI, type Reference } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * An EXTENSIBLE ENUMERATION may declare no items (ISO 10303-11:2004 8.4.1):
 * `TYPE a3m_accuracy_type_name = EXTENSIBLE ENUMERATION; END_TYPE;` in the
 * published Annotated_3d_model_equivalence_criteria_arm. It is still an
 * enumeration, and a `BASED_ON` extension of it in an interfacing schema must
 * bind. The type factory used to file an item-less enumeration as a plain
 * type, so the BASED_ON scope (enumeration resources only) never offered it
 * and the linker reported "The type '…' is not available and may require an
 * interface" on every such extension (18 sites in the SMRL v8 short forms).
 */
const leaf = `
  SCHEMA leaf_schema;
  TYPE base_with_items = EXTENSIBLE ENUMERATION OF (one, two); END_TYPE;
  TYPE base_itemless = EXTENSIBLE ENUMERATION; END_TYPE;
  TYPE base_itemless_select = EXTENSIBLE GENERIC_ENTITY SELECT; END_TYPE;
  ENTITY leaf_entity; n : INTEGER; END_ENTITY;
  END_SCHEMA;
`;
const mid = (name: string, from: string) => `
  SCHEMA ${name};
  USE FROM ${from};
  ENTITY ${name}_entity; m : INTEGER; END_ENTITY;
  END_SCHEMA;
`;
const probe = (from: string) => `
  SCHEMA probe_schema;
  USE FROM ${from};
  TYPE ext_with_items = EXTENSIBLE ENUMERATION BASED_ON base_with_items WITH (three); END_TYPE;
  TYPE ext_itemless = EXTENSIBLE ENUMERATION BASED_ON base_itemless WITH (four); END_TYPE;
  TYPE ext_itemless_select = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON base_itemless_select WITH (probe_entity); END_TYPE;
  ENTITY probe_entity; ref : leaf_entity; END_ENTITY;
  END_SCHEMA;
`;

/** Builds the documents; returns what each BASED_ON target of `probe` bound to, by written name, and the probe's diagnostics. */
async function bindingsOf(docs: Array<[name: string, text: string]>) {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = services.shared.workspace;
  const documents = docs.map(([name, text]) => {
    const document = LangiumDocumentFactory.fromString(text, URI.parse(`memory:///${name}.exp`));
    LangiumDocuments.addDocument(document);
    return document;
  });
  await DocumentBuilder.build(documents, { validation: true });
  const document = documents.find((d) => d.uri.path.endsWith("/probe.exp"))!;
  expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
  const bound = new Map<string, string | undefined>();
  for (const reference of document.references as Reference[]) {
    if (reference.$refText.startsWith("base_")) {
      bound.set(reference.$refText, reference.ref ? services.references.NameProvider.getName(reference.ref) : undefined);
    }
  }
  const messages = (document.diagnostics ?? []).map((diagnostic) => diagnostic.message);
  return { bound, messages };
}

describe("BASED_ON an item-less EXTENSIBLE ENUMERATION", () => {
  test("binds through a direct USE FROM, beside the item-bearing and select controls", async () => {
    const { bound, messages } = await bindingsOf([
      ["leaf", leaf],
      ["probe", probe("leaf_schema")],
    ]);
    expect(bound.get("base_itemless")).toBe("base_itemless");
    expect(bound.get("base_with_items")).toBe("base_with_items");
    expect(bound.get("base_itemless_select")).toBe("base_itemless_select");
    expect(messages).toEqual([]);
  });

  test("binds through two USE FROM hops (clause 11 re-export), whatever the document order", async () => {
    const chain: Array<[string, string]> = [
      ["leaf", leaf],
      ["mid1", mid("mid1_schema", "leaf_schema")],
      ["mid2", mid("mid2_schema", "mid1_schema")],
      ["probe", probe("mid2_schema")],
    ];
    for (const order of [chain, [...chain].reverse()]) {
      const { bound, messages } = await bindingsOf(order);
      expect(bound.get("base_itemless")).toBe("base_itemless");
      expect(messages).toEqual([]);
    }
  });
});
