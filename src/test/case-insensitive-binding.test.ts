import { EmptyFileSystem, type Reference } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * Name binding under the case rule (express-p11-case-rule-scope.ts):
 * attribute, type, function, rule, enumeration, parameter and local names
 * bind regardless of case everywhere; entity and schema names bind exact-case
 * in a short form; every name binds regardless of case in a long form
 * (`_lf`). Project rulings 2026-10-29 and 2026-10-30; ISO 10303-11:2004
 * 7.1.2; WG11 N239.
 */
/** What every cross-reference written as `text` binds to, by its written spelling; fresh services per document. */
async function bindings(source: string): Promise<(written: string) => string[]> {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { document } = await validationHelper(services)(source);
  expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
  const byText = new Map<string, string[]>();
  for (const reference of document.references as Reference[]) {
    const target = reference.ref;
    const name = target ? (services.references.NameProvider.getName(target) ?? (target as { name?: string }).name ?? "?") : "UNRESOLVED";
    byText.set(reference.$refText, [...(byText.get(reference.$refText) ?? []), name]);
  }
  return (written) => {
    const found = byText.get(written);
    expect(found, `fixture references '${written}'`).toBeDefined();
    return found!;
  };
}

describe("names bind under the case rule", () => {
  test("short form: an attribute written in another case binds (ruling 2026-10-30)", async () => {
    const bound = await bindings(`
      SCHEMA s;
      TYPE unit_kind = STRING; END_TYPE;
      ENTITY Value_with_unit; unit : unit_kind; END_ENTITY;
      ENTITY Measure SUBTYPE OF (Value_with_unit);
      WHERE
        wr1 : EXISTS(SELF\\Value_with_unit.Unit);
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(bound("Unit")).toEqual(["unit"]);
    expect(bound("Value_with_unit")).toEqual(["Value_with_unit", "Value_with_unit"]);
  });

  test("short form: type, function, enumeration, parameter and local names bind regardless of case", async () => {
    const bound = await bindings(`
      SCHEMA s;
      TYPE unit_kind = STRING; END_TYPE;
      TYPE colour = ENUMERATION OF (red, green); END_TYPE;
      FUNCTION f(Count : INTEGER) : INTEGER;
        LOCAL
          Total : INTEGER := 0;
        END_LOCAL;
        total := count + 1;
        RETURN (TOTAL);
      END_FUNCTION;
      ENTITY e;
        x : Unit_Kind;
        c : colour;
      WHERE
        wr1 : F(1) = 1;
        wr2 : c = colour.RED;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(bound("Unit_Kind")).toEqual(["unit_kind"]);
    expect(bound("F")).toEqual(["f"]);
    expect(bound("RED")).toEqual(["red"]);
    expect(bound("count")).toEqual(["Count"]);
    expect(bound("total")).toEqual(["Total"]);
    expect(bound("TOTAL")).toEqual(["Total"]);
  });

  test("short form: INVERSE FOR binds the attribute regardless of case", async () => {
    const bound = await bindings(`
      SCHEMA s;
      ENTITY a;
      INVERSE
        parts : SET [0:?] OF b FOR OWNER;
      END_ENTITY;
      ENTITY b; owner : a; END_ENTITY;
      END_SCHEMA;
    `);
    expect(bound("OWNER")).toEqual(["owner"]);
  });

  test("short form: an entity written in another case does not bind (ruling 2026-10-29)", async () => {
    const bound = await bindings(`
      SCHEMA s;
      ENTITY Mesh; END_ENTITY;
      ENTITY cell SUBTYPE OF (mesh);
        owner : mesh;
      WHERE
        wr1 : EXISTS(SELF\\mesh.owner);
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(bound("mesh")).toEqual(["UNRESOLVED", "UNRESOLVED", "UNRESOLVED"]);
  });

  test("short form: an exact match wins, then a folded match among the kinds that fold", async () => {
    const bound = await bindings(`
      SCHEMA s;
      TYPE foo = STRING; END_TYPE;
      ENTITY Foo; END_ENTITY;
      ENTITY e;
        a : Foo;
        b : foo;
        c : FOO;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(bound("Foo")).toEqual(["Foo"]);
    expect(bound("foo")).toEqual(["foo"]);
    expect(bound("FOO")).toEqual(["foo"]);
  });

  test("short form: a schema reference binds exact-case (ruling 2026-10-30)", async () => {
    const bound = await bindings(`
      SCHEMA A_schema;
      ENTITY e; END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      USE FROM a_schema;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A_schema;
      END_SCHEMA;
    `);
    expect(bound("a_schema")).toEqual(["UNRESOLVED"]);
    expect(bound("A_schema")).toEqual(["A_schema"]);
  });

  test("long form: every name binds regardless of case (WG11 N239, ruling 2026-10-30)", async () => {
    const bound = await bindings(`
      SCHEMA x_lf;
      TYPE unit_kind = STRING; END_TYPE;
      ENTITY Value_with_unit; unit : unit_kind; END_ENTITY;
      ENTITY Measure SUBTYPE OF (value_with_unit);
        other : VALUE_WITH_UNIT;
      WHERE
        wr1 : EXISTS(SELF\\value_with_unit.Unit);
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(bound("value_with_unit")).toEqual(["Value_with_unit", "Value_with_unit"]);
    expect(bound("VALUE_WITH_UNIT")).toEqual(["Value_with_unit"]);
    expect(bound("Unit")).toEqual(["unit"]);
  });
});
