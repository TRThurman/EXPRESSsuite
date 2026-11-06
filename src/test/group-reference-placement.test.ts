import { EmptyFileSystem } from "langium";
import { expectNoIssues, validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver-types";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";

/**
 * Where a group reference may stand (ISO 10303-11:2004 12.7.4, Rules and
 * restrictions): "A group reference which is not further qualified with an
 * attribute reference shall appear as an operand of either the entity value
 * comparison operator (=) or the complex entity instance constructor (||)."
 * A group reference followed by another group reference or by an index is
 * reported too: the left operand of `\` shall evaluate to a complex entity
 * instance (12.7.4) and an index needs an aggregate (12.6.1), neither of which
 * a partial complex entity value is. The decision procedure and its proofs
 * are lean/ExpressSuite/GroupReference.lean (`qualsOk`, `violatesAt`,
 * `qualsOk_eq_kind`, `check_eq_wellKinded`).
 */
const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);
const code = ExpressP11Issues.UnqualifiedGroupReference;

type Result = Awaited<ReturnType<typeof validate>>;
const found = (result: Result) => result.diagnostics.filter((d) => d.code === code);
const texts = (result: Result) => found(result).map((d) => result.document.textDocument.getText(d.range));

/** The issue 102 shapes, with the shape_aspect_definition_schema entities reduced to what they need. */
const datumSchema = (derive: string, where = "") => `
  SCHEMA repro_102;
  ENTITY shape_aspect; of_shape : STRING; product_definitional : LOGICAL; END_ENTITY;
  ENTITY datum SUBTYPE OF (shape_aspect); identification : STRING; END_ENTITY;
  ENTITY shape_aspect_relationship; relating_shape_aspect : shape_aspect; related_shape_aspect : shape_aspect; END_ENTITY;
  ENTITY datum_target
    SUBTYPE OF (shape_aspect);
    target_id : STRING;
  DERIVE
    ${derive}
  INVERSE
    target_basis_relationship : SET [1:?] OF shape_aspect_relationship FOR relating_shape_aspect;
  UNIQUE
    UR1: target_id, SELF\\shape_aspect.of_shape;
  WHERE
    WR2: SELF\\shape_aspect.product_definitional = TRUE;
    ${where}
  END_ENTITY;
  END_SCHEMA;
`;

/** ISO 10303-11:2004 12.7.4 EXAMPLE 1 and EXAMPLE 2 declarations, inside a function body. */
const exampleSchema = (locals: string, body: string) => `
  SCHEMA this;
  ENTITY E1 ABSTRACT SUPERTYPE; attrib1 : REAL; attrib2 : REAL; attrib3 : REAL; END_ENTITY;
  ENTITY E2 SUBTYPE OF (E1); attribA : INTEGER; attribB : INTEGER; attribC : INTEGER; END_ENTITY;
  ENTITY E3 SUBTYPE OF (E1); attribX : INTEGER; END_ENTITY;
  ENTITY foo1; attr : REAL; END_ENTITY;
  ENTITY foo2 SUBTYPE OF (foo1); attr2 : BOOLEAN; END_ENTITY;
  ENTITY t; attr : BINARY; END_ENTITY;
  TYPE crazy = SELECT (foo2, t); END_TYPE;
  FUNCTION same_e1 (x : E1) : BOOLEAN; RETURN (TRUE); END_FUNCTION;
  FUNCTION probe (p : E1; q : E1) : GENERIC;
    LOCAL
      a : E1;
      b : E2;
      v : crazy;
      s : SET OF E1;
      ${locals}
    END_LOCAL;
    ${body}
    RETURN (?);
  END_FUNCTION;
  END_SCHEMA;
`;

describe("issue 102: a group reference ending an expression", () => {
  test("the_datum : datum := ...\\datum is reported once, at the \\datum", async () => {
    const result = await validate(
      datumSchema(`
        datum_basis_relationship : SET OF shape_aspect_relationship :=
          QUERY(sar <* SELF\\datum_target.target_basis_relationship |
                'REPRO_102.DATUM' IN TYPEOF(sar\\shape_aspect_relationship.related_shape_aspect));
        the_datum : datum :=
          datum_basis_relationship[1]\\shape_aspect_relationship.related_shape_aspect\\datum;
        combined_datum_target_string : STRING := the_datum\\datum.identification + target_id;
      `)
    );
    const diagnostics = found(result);
    expect(diagnostics).toHaveLength(1);
    expect(texts(result)).toEqual(["\\datum"]);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diagnostics[0].data).toEqual({ entity: "datum", followedBy: "nothing" });
    expect(diagnostics[0].message).toContain("12.7.4");
    expect(diagnostics[0].message).toContain("partial complex entity value");
    const line = result.document.textDocument.getText().split("\n")[diagnostics[0].range.start.line];
    expect(line).toContain("related_shape_aspect\\datum;");
    // nothing else in the issue's entity is reported by any check
    expect(result.diagnostics).toHaveLength(1);
  });

  test("the same entity with the group reference qualified by an attribute is clean", async () => {
    const result = await validate(
      datumSchema(`
        datum_basis_relationship : SET OF shape_aspect_relationship :=
          QUERY(sar <* SELF\\datum_target.target_basis_relationship |
                'REPRO_102.DATUM' IN TYPEOF(sar\\shape_aspect_relationship.related_shape_aspect));
        the_datum_identification : STRING :=
          datum_basis_relationship[1]\\shape_aspect_relationship.related_shape_aspect\\datum.identification;
      `)
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  test("an unqualified group reference as an operand of = in a domain rule is clean", async () => {
    const result = await validate(
      datumSchema(
        `the_datum : datum := ?;`,
        `WR3: SELF\\shape_aspect = the_datum\\shape_aspect;`
      )
    );
    expectNoIssues(result, { code });
  });
});

describe("positions 12.7.4 allows", () => {
  test("12.7.4 EXAMPLE 1: a\\E1 = b\\E1", async () => {
    const result = await validate(exampleSchema("ok : BOOLEAN;", `ok := a\\E1 = b\\E1;`));
    expectNoIssues(result, { code });
  });

  test("12.7.4 EXAMPLE 2: v\\foo1.attr := 1.5 (a group-qualified assignment target, 13.3)", async () => {
    const result = await validate(exampleSchema("", `IF 'THIS.FOO2' IN TYPEOF(v) THEN v\\foo1.attr := 1.5; END_IF;`));
    expectNoIssues(result, { code });
  });

  test("an assignment target ending in a group reference is not an expression (13.3)", async () => {
    const result = await validate(exampleSchema("", `a\\E1 := E1(0.0, 1.0, 2.0);`));
    expectNoIssues(result, { code });
  });

  test("operands of the complex entity instance constructor ||, nested and parenthesised (12.10)", async () => {
    const result = await validate(
      exampleSchema(
        "c : E1;",
        `c := a\\E1 || E2(1, 2, 3);
         c := (a\\E1 || b\\E2) || E3(4);
         c := (a\\E1) || (b\\E2);`
      )
    );
    expectNoIssues(result, { code });
  });

  test("parentheses pass the operand position through: (a\\E1) = ((b\\E1))", async () => {
    const result = await validate(exampleSchema("ok : BOOLEAN;", `ok := (a\\E1) = ((b\\E1));`));
    expectNoIssues(result, { code });
  });

  test("= comparisons inside a larger expression", async () => {
    const result = await validate(
      exampleSchema("ok : BOOLEAN;", `ok := (a\\E1 = b\\E1) AND NOT (p\\E1 = q\\E1) AND same_e1(a) AND (a\\E1 = b);`)
    );
    expectNoIssues(result, { code });
  });

  test("attribute-qualified group references are never reported, in any position", async () => {
    const result = await validate(
      exampleSchema(
        "r : REAL; xs : LIST OF REAL; ok : BOOLEAN;",
        `r := a\\E1.attrib1;
         r := ABS(b\\E2.attribA) + b\\E1.attrib2;
         xs := [a\\E1.attrib1, b\\E1.attrib2];
         ok := b\\E2.attribA IN [1, 2];
         ok := v\\foo2.attr2;
         RETURN (b\\E2.attribA);`
      )
    );
    expectNoIssues(result, { code });
  });

  test("qualified attributes (SELF\\E.a) in UNIQUE rules and redeclarations are not qualifier lists", async () => {
    const result = await validate(`
      SCHEMA redeclared;
      ENTITY base; size : NUMBER; label : STRING; END_ENTITY;
      ENTITY narrow SUBTYPE OF (base);
        SELF\\base.size : INTEGER;
      UNIQUE
        UR1: SELF\\base.label;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });
});

describe("positions 12.7.4 does not allow", () => {
  test("an actual parameter: same_e1(p\\E1), TYPEOF(p\\E1), EXISTS(p\\E1)", async () => {
    const result = await validate(
      exampleSchema("ok : BOOLEAN; n : SET OF STRING;", `ok := same_e1(p\\E1); n := TYPEOF(p\\E1); ok := EXISTS(p\\E1);`)
    );
    expect(texts(result)).toEqual(["\\E1", "\\E1", "\\E1"]);
  });

  test("an actual parameter stays reported when the call is an operand of =", async () => {
    const result = await validate(exampleSchema("ok : BOOLEAN;", `ok := same_e1(p\\E1) = TRUE;`));
    expect(texts(result)).toEqual(["\\E1"]);
  });

  test("RETURN, an assignment source and a local initializer", async () => {
    const result = await validate(
      exampleSchema("c : E1 := p\\E1;", `a := q\\E1; RETURN (b\\E2);`)
    );
    expect(texts(result)).toEqual(["\\E1", "\\E1", "\\E2"]);
  });

  test("an aggregate element, an IN operand and an instance comparison inside QUERY", async () => {
    const result = await validate(
      exampleSchema(
        "ok : BOOLEAN; t : SET OF E1;",
        `s := [p\\E1]; ok := p\\E1 IN s; t := QUERY(e <* s | e\\E1 = p\\E1); ok := SIZEOF(QUERY(e <* s | e\\E1 :=: p)) = 0;`
      )
    );
    // the QUERY with `e\\E1 = p\\E1` is clean; `:=:` is instance comparison, not entity value comparison
    expect(texts(result)).toEqual(["\\E1", "\\E1", "\\E1"]);
  });

  test("<> and :=: are not the operators 12.7.4 names", async () => {
    const result = await validate(exampleSchema("ok : BOOLEAN;", `ok := a\\E1 <> b\\E1; ok := a\\E1 :=: b\\E1;`));
    expect(texts(result)).toEqual(["\\E1", "\\E1", "\\E1", "\\E1"]);
  });

  test("under a unary operator: NOT (p\\E1) = q", async () => {
    const result = await validate(exampleSchema("ok : BOOLEAN;", `ok := NOT (p\\E1) = q;`));
    expect(texts(result)).toEqual(["\\E1"]);
  });

  test("a group reference followed by another group reference: the first is reported", async () => {
    const result = await validate(
      exampleSchema("i : INTEGER; ok : BOOLEAN;", `i := p\\E1\\E2.attribA; ok := p\\E1\\E2 = q\\E2;`)
    );
    const diagnostics = found(result);
    expect(texts(result)).toEqual(["\\E1", "\\E1"]);
    expect(diagnostics.map((d) => d.data)).toEqual([
      { entity: "E1", followedBy: "group" },
      { entity: "E1", followedBy: "group" },
    ]);
    expect(diagnostics[0].message).toContain("complex entity instance");
  });

  test("a group reference followed by an index", async () => {
    const result = await validate(exampleSchema("r : GENERIC;", `r := p\\E1[1] = q;`));
    const diagnostics = found(result);
    expect(texts(result)).toEqual(["\\E1"]);
    expect(diagnostics[0].data).toEqual({ entity: "E1", followedBy: "index" });
  });

  test("one diagnostic per offending group reference, in source order", async () => {
    const result = await validate(
      exampleSchema("ok : BOOLEAN;", `ok := same_e1(p\\E1) AND same_e1(q\\E2) AND (a\\E1 = b\\E1);`)
    );
    expect(texts(result)).toEqual(["\\E1", "\\E2"]);
    const starts = found(result).map((d) => d.range.start.character);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
  });
});
