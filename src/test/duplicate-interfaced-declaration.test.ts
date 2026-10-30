import { EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";

/**
 * `duplicate-interfaced-declaration`: one identifier, two or more different
 * declarations in one schema's scope (ISO 10303-11:2004 10.1 b, clause 11).
 * The cases mirror the `#guard`s of lean/ExpressSuite/Interfaces.lean.
 */
/** Fresh services per case: the helper's workspace keeps every earlier document, and same-named schemas would shadow each other. */
async function check(source: string) {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const { diagnostics, document } = await validationHelper(services)(source);
  expect(document.parseResult.parserErrors, "fixture must parse").toHaveLength(0);
  return {
    errors: diagnostics.filter((d) => d.code === ExpressP11Issues.DuplicateInterfacedDeclaration),
    warnings: diagnostics.filter((d) => d.code === ExpressP11Issues.RedundantDeclaration),
  };
}

/** Zero-based line of the first occurrence of `text` in `source`. */
function lineOf(source: string, text: string): number {
  const index = source.indexOf(text);
  expect(index, `fixture contains ${text}`).toBeGreaterThanOrEqual(0);
  return source.slice(0, index).split("\n").length - 1;
}

describe("duplicate-interfaced-declaration", () => {
  test("reports the clash in the interfacing schema only, at each interface line (10.1 b)", async () => {
    const source = `
      SCHEMA Module_arm;
      ENTITY Assignment_object_relationship;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA Ap_arm;
      ENTITY Assignment_object_relationship;
      END_ENTITY;
      ENTITY Other;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA P400;
      USE FROM Ap_arm;
      USE FROM Module_arm;
      END_SCHEMA;
    `;
    const { errors } = await check(source);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.range.start.line).sort()).toEqual([lineOf(source, "USE FROM Ap_arm"), lineOf(source, "USE FROM Module_arm")].sort());
    expect(errors[0].message).toContain("ENTITY 'Assignment_object_relationship' is declared in Ap_arm and in Module_arm; both are visible in P400");
    expect(errors[0].relatedInformation).toHaveLength(2);
  });

  test("counts one declaration reached by two routes once (10.1 b, second sentence)", async () => {
    const { errors } = await check(`
      SCHEMA S1;
      ENTITY e;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA S2;
      USE FROM S1;
      END_SCHEMA;

      SCHEMA S3;
      USE FROM S1;
      USE FROM S2;
      REFERENCE FROM S1 (e);
      END_SCHEMA;
    `);
    expect(errors).toHaveLength(0);
  });

  test("does not chain REFERENCE (11.3)", async () => {
    const { errors } = await check(`
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      REFERENCE FROM A;
      END_SCHEMA;

      SCHEMA C;
      USE FROM B;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA D;
      REFERENCE FROM B;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(errors).toHaveLength(0);
  });

  test("a full REFERENCE FROM sees what the foreign schema use's (11.2)", async () => {
    const source = `
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      USE FROM A;
      END_SCHEMA;

      SCHEMA C;
      REFERENCE FROM B;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;
    `;
    const { errors } = await check(source);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.range.start.line).sort()).toEqual([lineOf(source, "REFERENCE FROM B"), lineOf(source, "ENTITY x;\n      END_ENTITY;\n      END_SCHEMA;\n    ")].sort());
  });

  test("honours explicit item lists", async () => {
    const { errors } = await check(`
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      ENTITY y;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A (y);
      REFERENCE FROM A (y);
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(errors).toHaveLength(0);
  });

  test("a rename clashes under its effective name and frees the original", async () => {
    const clashing = `
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A (x AS z);
      ENTITY z;
      END_ENTITY;
      END_SCHEMA;
    `;
    const { errors } = await check(clashing);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.range.start.line).sort()).toEqual([lineOf(clashing, "x AS z"), lineOf(clashing, "ENTITY z")].sort());

    const free = await check(`
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A (x AS z);
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(free.errors).toHaveLength(0);
  });

  test("short form: entity names are case-significant, type names are not (rulings 2026-10-29/30)", async () => {
    const entities = await check(`
      SCHEMA A;
      ENTITY Mesh;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A;
      ENTITY mesh;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(entities.errors).toHaveLength(0);

    const types = await check(`
      SCHEMA A;
      TYPE cell = INTEGER;
      END_TYPE;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A;
      TYPE Cell = REAL;
      END_TYPE;
      END_SCHEMA;
    `);
    expect(types.errors).toHaveLength(2);
  });

  test("one namespace across kinds, keyed per kind rule", async () => {
    const clash = await check(`
      SCHEMA A;
      TYPE foo = INTEGER;
      END_TYPE;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A;
      ENTITY foo;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(clash.errors).toHaveLength(2);
    expect(clash.errors[0].message).toContain("Identifier 'foo' (ENTITY, TYPE)");

    const distinct = await check(`
      SCHEMA A;
      TYPE foo = INTEGER;
      END_TYPE;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A;
      ENTITY Foo;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(distinct.errors).toHaveLength(0);
  });

  test("local duplicates of every kind are reported (replaces the entity-only check)", async () => {
    const { errors } = await check(`
      SCHEMA S;
      CONSTANT
        c : INTEGER := 1;
        c : INTEGER := 2;
      END_CONSTANT;
      ENTITY e;
      END_ENTITY;
      ENTITY e;
      END_ENTITY;
      FUNCTION f : INTEGER;
        RETURN (1);
      END_FUNCTION;
      FUNCTION f : INTEGER;
        RETURN (2);
      END_FUNCTION;
      RULE r FOR (e);
      WHERE
        wr1 : TRUE;
      END_RULE;
      RULE r FOR (e);
      WHERE
        wr1 : TRUE;
      END_RULE;
      END_SCHEMA;
    `);
    const byIdentifier = new Map<string, number>();
    for (const error of errors) {
      const identifier = (error.data as { identifier: string }).identifier;
      byIdentifier.set(identifier, (byIdentifier.get(identifier) ?? 0) + 1);
    }
    expect([...byIdentifier.entries()].sort()).toEqual([
      ["c", 2],
      ["e", 2],
      ["f", 2],
      ["r", 2],
    ]);
    expect(errors.every((e) => String(e.message).includes("is declared more than once in S"))).toBe(true);
  });

  test("long form: identical repeats are a warning, differing ones an error (WG11 N239)", async () => {
    const identical = await check(`
      SCHEMA x_lf;
      ENTITY a;
      END_ENTITY;
      ENTITY A;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(identical.errors).toHaveLength(0);
    expect(identical.warnings).toHaveLength(2);
    expect(identical.warnings[0].message).toContain("identical text");

    const differing = await check(`
      SCHEMA y_lf;
      ENTITY a;
        b : INTEGER;
      END_ENTITY;
      ENTITY A;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(differing.errors).toHaveLength(2);
    expect(differing.warnings).toHaveLength(0);
    expect(differing.errors[0].message).toContain("different definitions");
  });

  test("interface cycles terminate and still propagate", async () => {
    const source = `
      SCHEMA A;
      USE FROM B;
      ENTITY a;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      USE FROM A;
      ENTITY b;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A;
      ENTITY b;
      END_ENTITY;
      END_SCHEMA;
    `;
    const { errors } = await check(source);
    expect(errors).toHaveLength(2);
    const schemaC = lineOf(source, "SCHEMA C;");
    expect(errors.map((e) => e.range.start.line).sort()).toEqual([schemaC + 1, schemaC + 2]);
  });

  test("an unresolved interface reports nothing and does not throw", async () => {
    const { errors } = await check(`
      SCHEMA C;
      USE FROM Nowhere;
      REFERENCE FROM Nowhere (gone AS here);
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(errors).toHaveLength(0);
  });
});
