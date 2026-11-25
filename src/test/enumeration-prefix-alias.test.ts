import { EmptyFileSystem, URI } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * An enumeration item may be prefixed by the name of a defined data type that
 * renames an enumeration, `TYPE alias = base;` (ISO 10303-11:2004 12.7.2 with
 * 9.1 and 8.3.2: the alias is a defined data type whose underlying type is the
 * enumeration). The long-form procedure writes every extending enumeration this
 * way (G.5.3.1 EXAMPLE 2 and EXAMPLE 3), e.g.
 * `TYPE ps_initial_application_domain_enumeration =
 * initial_application_domain_enumeration;` followed by
 * `ps_initial_application_domain_enumeration.electrical` in a WHERE rule
 * (55 diagnostics in long forms built from the SMRL v8 modules). Accepting the
 * prefix is a reading of 12.7.2: 8.4.1 NOTE 3 says a type_id that qualifies an
 * enumeration_id is always an enumeration data type. The prefix used to resolve
 * only when the named type was itself an ENUMERATION, so each such item was
 * reported "The attribute '…' could not be found."
 */
const schema = (body: string) => `
  SCHEMA alias_prefix_schema;
  TYPE base = ENUMERATION OF (electrical, thermal, unspecified); END_TYPE;
  TYPE ps = base;
  WHERE
    wr1 : SELF <> base.unspecified;
  END_TYPE;
  TYPE ps2 = ps; END_TYPE;
  TYPE count = INTEGER; END_TYPE;
  ${body}
  END_SCHEMA;
`;

async function messagesOf(text: string): Promise<string[]> {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = services.shared.workspace;
  const document = LangiumDocumentFactory.fromString(text, URI.parse("memory:///alias_prefix.exp"));
  LangiumDocuments.addDocument(document);
  await DocumentBuilder.build([document], { validation: true });
  expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
  return (document.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => String(d.message));
}

const entity = (rule: string) => `
  ENTITY e;
    domain : base;
  WHERE
    wr1 : ${rule};
  END_ENTITY;
`;

describe("enumeration item prefixed by an alias of its enumeration (12.7.2)", () => {
  test("the control: a prefix naming the enumeration itself resolves", async () => {
    expect(await messagesOf(schema(entity("domain = base.electrical")))).toEqual([]);
  });

  test("a prefix naming an alias of the enumeration resolves", async () => {
    expect(await messagesOf(schema(entity("domain = ps.electrical")))).toEqual([]);
  });

  test("a prefix naming an alias of an alias resolves", async () => {
    expect(await messagesOf(schema(entity("domain = ps2.thermal")))).toEqual([]);
  });

  test("an item the aliased enumeration does not declare is still reported", async () => {
    expect(await messagesOf(schema(entity("domain = ps.mechanical")))).toEqual([
      "The attribute 'mechanical' could not be found.",
    ]);
  });

  test("a prefix naming an alias of a simple type is still reported", async () => {
    expect(await messagesOf(schema(entity("domain = count.electrical")))).toEqual([
      "The attribute 'electrical' could not be found.",
    ]);
  });

  test("a cycle of aliases ends the search instead of looping", async () => {
    const cyclic = `
      SCHEMA alias_cycle_schema;
      TYPE a = b; END_TYPE;
      TYPE b = a; END_TYPE;
      ENTITY e;
        x : INTEGER;
      WHERE
        wr1 : x = a.electrical;
      END_ENTITY;
      END_SCHEMA;
    `;
    expect(await messagesOf(cyclic)).toContain("The attribute 'electrical' could not be found.");
  });

  test("an alias from another schema takes its items from its own enumeration, not from a same-named type of the referencing schema", async () => {
    const text = (rule: string) => `
      SCHEMA alias_source_schema;
      TYPE base = ENUMERATION OF (electrical, thermal); END_TYPE;
      TYPE ps = base; END_TYPE;
      END_SCHEMA;
      SCHEMA alias_user_schema;
      USE FROM alias_source_schema (ps);
      TYPE base = ENUMERATION OF (red, green); END_TYPE;
      ENTITY e;
        domain : ps;
      WHERE
        wr1 : ${rule};
      END_ENTITY;
      END_SCHEMA;
    `;
    expect(await messagesOf(text("domain = ps.electrical"))).toEqual([]);
    expect(await messagesOf(text("domain = ps.red"))).toEqual(["The attribute 'red' could not be found."]);
  });

  test("an alias from another schema resolves when its enumeration is not interfaced by name", async () => {
    const text = `
      SCHEMA alias_source_schema;
      TYPE base = ENUMERATION OF (electrical, thermal); END_TYPE;
      TYPE ps = base; END_TYPE;
      END_SCHEMA;
      SCHEMA alias_user_schema;
      USE FROM alias_source_schema (ps);
      ENTITY e;
        domain : ps;
      WHERE
        wr1 : domain = ps.thermal;
      END_ENTITY;
      END_SCHEMA;
    `;
    expect(await messagesOf(text)).toEqual([]);
  });
});
