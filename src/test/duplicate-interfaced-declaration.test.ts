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

  test("REFERENCE interfaces functions but not rules (clause 11)", async () => {
    const source = `
      SCHEMA A;
      ENTITY e;
      END_ENTITY;
      FUNCTION f : INTEGER;
        RETURN (1);
      END_FUNCTION;
      RULE r FOR (e);
      WHERE
        wr1 : TRUE;
      END_RULE;
      END_SCHEMA;

      SCHEMA B;
      REFERENCE FROM A;
      FUNCTION f : INTEGER; -- in B
        RETURN (2);
      END_FUNCTION;
      RULE r FOR (e); -- in B
      WHERE
        wr1 : TRUE;
      END_RULE;
      END_SCHEMA;
    `;
    const { errors } = await check(source);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => String(e.message).includes("FUNCTION 'f'"))).toBe(true);
    expect(errors.map((e) => e.range.start.line).sort()).toEqual([lineOf(source, "REFERENCE FROM A"), lineOf(source, "FUNCTION f : INTEGER; -- in B")].sort());
  });

  test("local duplicates of PROCEDURE and SUBTYPE_CONSTRAINT kinds", async () => {
    const procedures = await check(`
      SCHEMA P;
      PROCEDURE p;
      END_PROCEDURE;
      PROCEDURE p;
      END_PROCEDURE;
      END_SCHEMA;
    `);
    expect(procedures.errors).toHaveLength(2);
    expect(String(procedures.errors[0].message)).toContain("PROCEDURE 'p'");

    const constraints = await check(`
      SCHEMA S;
      ENTITY e;
      END_ENTITY;
      ENTITY a SUBTYPE OF (e);
      END_ENTITY;
      ENTITY b SUBTYPE OF (e);
      END_ENTITY;
      SUBTYPE_CONSTRAINT sc FOR e;
        ONEOF (a, b);
      END_SUBTYPE_CONSTRAINT;
      SUBTYPE_CONSTRAINT sc FOR e;
        ONEOF (a, b);
      END_SUBTYPE_CONSTRAINT;
      END_SCHEMA;
    `);
    expect(constraints.errors).toHaveLength(2);
    expect(String(constraints.errors[0].message)).toContain("SUBTYPE_CONSTRAINT 'sc'");
  });

  test("a chained rename is the original rename (11.3 EXAMPLE 2)", async () => {
    const clashing = `
      SCHEMA S1;
      ENTITY e1;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA S2;
      USE FROM S1 (e1 AS e2);
      END_SCHEMA;

      SCHEMA S3;
      USE FROM S2 (e2);
      ENTITY e2;
      END_ENTITY;
      END_SCHEMA;
    `;
    const { errors } = await check(clashing);
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.range.start.line).sort()).toEqual([lineOf(clashing, "USE FROM S2 (e2)"), lineOf(clashing, "ENTITY e2")].sort());

    const free = await check(`
      SCHEMA S1;
      ENTITY e1;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA S2;
      USE FROM S1 (e1 AS e2);
      END_SCHEMA;

      SCHEMA S3;
      USE FROM S2 (e2);
      ENTITY e1;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(free.errors).toHaveLength(0);
  });

  test("three declarations of one name: one diagnostic per declaration, each naming all three", async () => {
    const source = `
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA D;
      USE FROM A;
      USE FROM B;
      USE FROM C;
      END_SCHEMA;
    `;
    const { errors } = await check(source);
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.range.start.line).sort()).toEqual([lineOf(source, "USE FROM A"), lineOf(source, "USE FROM B"), lineOf(source, "USE FROM C")].sort());
    expect(errors.every((e) => e.relatedInformation?.length === 3)).toBe(true);
    expect(String(errors[0].message)).toContain("all are visible in D");
  });

  test("one declaration reached by USE and by REFERENCE counts once (11.3)", async () => {
    const { errors } = await check(`
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      USE FROM A;
      REFERENCE FROM A;
      END_SCHEMA;
    `);
    expect(errors).toHaveLength(0);
  });

  test("a clash propagates to every schema whose scope holds both declarations", async () => {
    const source = `
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A;
      USE FROM B;
      END_SCHEMA;

      SCHEMA D;
      USE FROM C;
      END_SCHEMA;

      SCHEMA R;
      REFERENCE FROM C;
      END_SCHEMA;

      SCHEMA L;
      USE FROM C (x);
      END_SCHEMA;
    `;
    const { errors } = await check(source);
    // C: one diagnostic per interface line. D, R and L: both declarations
    // arrive through one specification (or one listed item), so one diagnostic
    // there, with both declarations in its related information.
    const at = (text: string) => errors.filter((e) => e.range.start.line === lineOf(source, text));
    expect(at("USE FROM A")).toHaveLength(1);
    expect(at("USE FROM B")).toHaveLength(1);
    expect(at("USE FROM C;")).toHaveLength(1);
    expect(at("REFERENCE FROM C")).toHaveLength(1);
    expect(at("USE FROM C (x)")).toHaveLength(1);
    expect(errors).toHaveLength(5);
    expect(errors.every((e) => e.relatedInformation?.length === 2)).toBe(true);
    expect(String(at("REFERENCE FROM C")[0].message)).toContain("both are visible in R");
  });

  test("a rename onto a listed name clashes on the item line", async () => {
    const source = `
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      ENTITY y;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      USE FROM A (x AS y, y);
      END_SCHEMA;

      SCHEMA R;
      REFERENCE FROM A (x AS y);
      ENTITY y; -- in R
      END_ENTITY;
      END_SCHEMA;
    `;
    const { errors } = await check(source);
    const at = (text: string) => errors.filter((e) => e.range.start.line === lineOf(source, text));
    expect(at("x AS y, y")).toHaveLength(2);
    expect(at("REFERENCE FROM A (x AS y)")).toHaveLength(1);
    expect(at("ENTITY y; -- in R")).toHaveLength(1);
    expect(errors).toHaveLength(4);
  });

  test("an interface specification names the schema of its own document first", async () => {
    const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
    const validate = validationHelper(services);
    const duplicates = (result: Awaited<ReturnType<typeof validate>>) =>
      result.diagnostics.filter((d) => d.code === ExpressP11Issues.DuplicateInterfacedDeclaration);
    const first = await validate(`
      SCHEMA A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA B;
      USE FROM A;
      ENTITY x;
      END_ENTITY;
      END_SCHEMA;
    `);
    expect(duplicates(first)).toHaveLength(2);

    // A second document with its own schema A: its USE FROM A must bind here, not to the first A.
    const second = await validate(`
      SCHEMA A;
      ENTITY y;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA C;
      USE FROM A;
      ENTITY y;
      END_ENTITY;
      END_SCHEMA;
    `);
    const clashes = duplicates(second);
    expect(clashes).toHaveLength(2);
    expect(clashes.every((d) => String(d.message).includes("'y'"))).toBe(true);
  });
});
