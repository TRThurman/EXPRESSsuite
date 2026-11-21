import { EmptyFileSystem, URI } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * ISO 10303-11:2004 12.7.3 with 9.2.3.3 b) (ruling 2026-11-21): `x.a` with `x : e` is ambiguous
 * when two or more entities among e and its supertypes, at any depth, declare `a`. Declarations
 * in subtypes never make it ambiguous: EXPRESS cannot guarantee that further subtypes will not
 * be added. Lean: `resolve_ambiguous_iff`, `ambiguous_stable` in lean/ExpressSuite/Inheritance.lean.
 */
async function ambiguityWarnings(body: string): Promise<string[]> {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = services.shared.workspace;
  const document = LangiumDocumentFactory.fromString(`SCHEMA ambiguity_schema;\n${body}\nEND_SCHEMA;\n`, URI.parse("memory:///ambiguity.exp"));
  LangiumDocuments.addDocument(document);
  await DocumentBuilder.build([document], { validation: true });
  expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
  return (document.diagnostics ?? []).filter((d) => d.code === "ambiguous-attribute-reference").map((d) => String(d.message));
}

describe("ambiguous-attribute-reference: the operand's type and its supertypes, at any depth", () => {
  test("two supertypes at the same depth (the 9.2.3.3 EXAMPLE)", async () => {
    const warnings = await ambiguityWarnings(`
      ENTITY s1; x : INTEGER; END_ENTITY;
      ENTITY s2; x : INTEGER; END_ENTITY;
      ENTITY e SUBTYPE OF (s1, s2); END_ENTITY;
      FUNCTION f(v : e) : BOOLEAN; RETURN (v.x > 0); END_FUNCTION;`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("declared in s1 and s2, among e and its supertypes");
  });

  test("two supertypes at different depths", async () => {
    const warnings = await ambiguityWarnings(`
      ENTITY s1; x : INTEGER; END_ENTITY;
      ENTITY ss; x : INTEGER; END_ENTITY;
      ENTITY s2 SUBTYPE OF (ss); END_ENTITY;
      ENTITY e SUBTYPE OF (s1, s2); END_ENTITY;
      FUNCTION f(v : e) : BOOLEAN; RETURN (v.x > 0); END_FUNCTION;`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("declared in s1 and ss");
  });

  test("a diamond: one declaration inherited along two paths is not ambiguous", async () => {
    expect(
      await ambiguityWarnings(`
      ENTITY t; x : INTEGER; END_ENTITY;
      ENTITY l SUBTYPE OF (t); END_ENTITY;
      ENTITY r SUBTYPE OF (t); END_ENTITY;
      ENTITY e SUBTYPE OF (l, r); END_ENTITY;
      FUNCTION f(v : e) : BOOLEAN; RETURN (v.x > 0); END_FUNCTION;`)
    ).toEqual([]);
  });

  test("a redeclaration declares no new name", async () => {
    expect(
      await ambiguityWarnings(`
      ENTITY s; x : NUMBER; END_ENTITY;
      ENTITY e SUBTYPE OF (s); SELF\\s.x : INTEGER; END_ENTITY;
      FUNCTION f(v : e) : BOOLEAN; RETURN (v.x > 0); END_FUNCTION;`)
    ).toEqual([]);
  });
});

describe("ambiguous-attribute-reference: declarations in subtypes are never reported", () => {
  const subtypes = (extra: string) => `
      ENTITY r; END_ENTITY;
      ENTITY a SUBTYPE OF (r); d : INTEGER; END_ENTITY;
      ENTITY c SUBTYPE OF (r); END_ENTITY;
      ENTITY b SUBTYPE OF (c); d : INTEGER; END_ENTITY;
      ${extra}
      FUNCTION f(v : r) : BOOLEAN; RETURN (v.d > 0); END_FUNCTION;`;

  test("two subtypes at the same depth", async () => {
    expect(
      await ambiguityWarnings(`
      ENTITY r; END_ENTITY;
      ENTITY a SUBTYPE OF (r); d : INTEGER; END_ENTITY;
      ENTITY b SUBTYPE OF (r); d : INTEGER; END_ENTITY;
      FUNCTION f(v : r) : BOOLEAN; RETURN (v.d > 0); END_FUNCTION;`)
    ).toEqual([]);
  });

  test("two subtypes at different depths", async () => {
    expect(await ambiguityWarnings(subtypes(""))).toEqual([]);
  });

  test("adding a further subtype that declares the name changes nothing", async () => {
    expect(await ambiguityWarnings(subtypes("ENTITY n SUBTYPE OF (r); d : INTEGER; END_ENTITY;"))).toEqual([]);
  });
});

describe("the type of an ambiguous attribute reference is unknown (12.7.3: indeterminate)", () => {
  async function codes(body: string): Promise<string[]> {
    const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
    const { LangiumDocuments, LangiumDocumentFactory, DocumentBuilder } = services.shared.workspace;
    const document = LangiumDocumentFactory.fromString(`SCHEMA ambiguity_type_schema;\n${body}\nEND_SCHEMA;\n`, URI.parse("memory:///ambiguity_type.exp"));
    LangiumDocuments.addDocument(document);
    await DocumentBuilder.build([document], { validation: true });
    expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
    return (document.diagnostics ?? []).map((d) => String(d.code));
  }

  test("two supertypes at different depths: no type, so indexing it is not reported", async () => {
    const found = await codes(`
      ENTITY s1; x : INTEGER; END_ENTITY;
      ENTITY ss; x : INTEGER; END_ENTITY;
      ENTITY s2 SUBTYPE OF (ss); END_ENTITY;
      ENTITY e SUBTYPE OF (s1, s2); END_ENTITY;
      FUNCTION f(v : e) : BOOLEAN; RETURN (v.x[1] > 0); END_FUNCTION;`);
    expect(found).toContain("ambiguous-attribute-reference");
    expect(found).not.toContain("index-on-non-aggregate");
  });

  test("the control: one declaration above, so its type is known and indexing an INTEGER is reported", async () => {
    const found = await codes(`
      ENTITY s1; x : INTEGER; END_ENTITY;
      ENTITY e SUBTYPE OF (s1); END_ENTITY;
      FUNCTION f(v : e) : BOOLEAN; RETURN (v.x[1] > 0); END_FUNCTION;`);
    expect(found).toContain("index-on-non-aggregate");
  });
});
