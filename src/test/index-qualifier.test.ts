import { EmptyFileSystem } from "langium";
import { expectNoIssues, validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";

/**
 * Index qualifier operands (ISO 10303-11:2004 12.6.1 aggregate, 12.5.1 string
 * and 12.3.1 binary indexing). The predicate is `notIndexable` of
 * lean/ExpressSuite/IndexOperand.lean, proved to admit no indexable value; the
 * shapes are those of a wg12-step datum_target intermediate form.
 */
const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);
const code = ExpressP11Issues.IndexOnNonAggregate;

const datumSchema = (derive: string) => `
  SCHEMA repro_3129;
  ENTITY shape_aspect; of_shape : STRING; product_definitional : LOGICAL; END_ENTITY;
  ENTITY datum SUBTYPE OF (shape_aspect); identification : STRING; END_ENTITY;
  ENTITY shape_aspect_relationship; relating_shape_aspect : shape_aspect; related_shape_aspect : shape_aspect; END_ENTITY;
  ENTITY datum_target SUBTYPE OF (shape_aspect);
    target_id : STRING;
  DERIVE
    ${derive}
  INVERSE
    target_basis_relationship : SET [1:?] OF shape_aspect_relationship FOR relating_shape_aspect;
  END_ENTITY;
  END_SCHEMA;
`;

describe("index qualifier on a non-aggregate operand", () => {
  test("datum_target intermediate form: the_datum : datum indexed with [1]", async () => {
    const result = await validate(
      datumSchema(`
        datum_basis_relationship : SET OF shape_aspect_relationship :=
          QUERY(sar <* target_basis_relationship | 'REPRO_3129.DATUM' IN TYPEOF(sar.related_shape_aspect));
        the_datum : datum := datum_basis_relationship[1]\\shape_aspect_relationship.related_shape_aspect\\datum;
        combined_datum_target_string : STRING := the_datum[1]\\datum.identification + target_id;
      `)
    );
    const found = result.diagnostics.filter((d) => d.code === code);
    expect(found).toHaveLength(1);
    expect(found[0].data).toEqual({ operandType: "datum" });
    expect(found[0].message).toContain("12.6.1");
    expect(found[0].message).toContain("12.5.1");
    expect(result.document.textDocument.getText(found[0].range)).toBe("[1]");
  });

  test("datum_target corrected form: no index on the_datum", async () => {
    const result = await validate(
      datumSchema(`
        datum_basis_relationship : SET OF shape_aspect_relationship :=
          QUERY(sar <* target_basis_relationship | 'REPRO_3129.DATUM' IN TYPEOF(sar.related_shape_aspect));
        the_datum : datum := datum_basis_relationship[1]\\shape_aspect_relationship.related_shape_aspect\\datum;
        combined_datum_target_string : STRING := the_datum\\datum.identification + target_id;
      `)
    );
    expectNoIssues(result, { code });
  });

  test("datum_target committed form: the_datum : SET OF datum may be indexed", async () => {
    const result = await validate(
      datumSchema(`
        the_datum : SET OF datum :=
          QUERY(sar <* target_basis_relationship | 'REPRO_3129.DATUM' IN TYPEOF(sar.related_shape_aspect));
        combined_datum_target_string : STRING := the_datum[1]\\datum.identification + target_id;
      `)
    );
    expectNoIssues(result, { code });
  });

  test("aggregates reached through SELF, group qualifiers, parameters, locals, inverse attributes and built-ins are indexable", async () => {
    const result = await validate(`
      SCHEMA indexable;
      ENTITY item; END_ENTITY;
      ENTITY owner; items : LIST [1:?] OF item; END_ENTITY;
      ENTITY holder SUBTYPE OF (owner);
        first : item;
      DERIVE
        head : item := SELF\\owner.items[1];
        second : item := items[2];
      INVERSE
        users : SET [0:?] OF owner FOR items;
      WHERE
        WR1 : SIZEOF(users) = 0 OR EXISTS(users[1]);
        WR2 : TYPEOF(SELF)[1] = 'INDEXABLE.HOLDER';
      END_ENTITY;
      FUNCTION pick(a : LIST OF item; n : INTEGER) : item;
      LOCAL
        copy : LIST OF item := a;
      END_LOCAL;
        REPEAT i := 1 TO SIZEOF(a);
          copy[i] := a[i];
        END_REPEAT;
        RETURN (copy[n]);
      END_FUNCTION;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("scalars from built-in functions, simple types and entities are not indexable", async () => {
    const result = await validate(`
      SCHEMA not_indexable;
      ENTITY item; label : STRING; count : INTEGER; END_ENTITY;
      ENTITY holder;
        it : item;
        things : LIST [1:?] OF item;
      WHERE
        WR1 : it[1].label = 'x';
        WR2 : SIZEOF(things)[1] = 1;
        WR3 : it.count[1] = 1;
      END_ENTITY;
      END_SCHEMA;
    `);
    const found = result.diagnostics.filter((d) => d.code === code);
    expect(found.map((d) => d.data)).toEqual([{ operandType: "item" }, { operandType: "INTEGER" }, { operandType: "INTEGER" }]);
  });

  test("strings and binaries are indexable (12.5.1, 12.3.1), also through defined types", async () => {
    const result = await validate(`
      SCHEMA strings;
      TYPE label = STRING; END_TYPE;
      TYPE uuid = STRING(36) FIXED; END_TYPE;
      ENTITY holder;
        name : label;
        id : uuid;
        raw : STRING;
        bits : BINARY(8) FIXED;
      WHERE
        WR1 : name[1] = 'a';
        WR2 : id[1:8] <> raw[2:3];
        WR3 : bits[1] = %1;
      END_ENTITY;
      FUNCTION dot_count(s : STRING) : INTEGER;
      LOCAL
        n : INTEGER := 0;
      END_LOCAL;
        REPEAT i := 1 TO LENGTH(s);
          IF s[i] = '.' THEN n := n + 1; END_IF;
        END_REPEAT;
        RETURN (n);
      END_FUNCTION;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("a qualified attribute is resolved from the operand's own entity, not from a sibling with the same attribute name", async () => {
    // Rational_b_spline_curve.weight_values : LIST OF REAL and
    // Rational_b_spline_surface.weight_values : LIST OF LIST OF REAL share a
    // root; the workspace linker may bind bss.weight_values to the curve's
    // attribute, which would make bss.weight_values[i][j] look like an index on REAL.
    const result = await validate(`
      SCHEMA siblings;
      ENTITY geometric_model_element; END_ENTITY;
      ENTITY curve SUBTYPE OF (geometric_model_element); END_ENTITY;
      ENTITY surface SUBTYPE OF (geometric_model_element); END_ENTITY;
      ENTITY Rational_b_spline_curve SUBTYPE OF (curve);
        weight_values : LIST [2:?] OF REAL;
      END_ENTITY;
      ENTITY Rational_b_spline_surface SUBTYPE OF (surface);
        weight_values : LIST [2:?] OF LIST [2:?] OF REAL;
      END_ENTITY;
      FUNCTION positive_surface_weights(bss : Rational_b_spline_surface) : BOOLEAN;
        REPEAT i := 1 TO SIZEOF(bss.weight_values);
          REPEAT j := 1 TO SIZEOF(bss.weight_values[1]);
            IF (bss.weight_values[i][j] <= 0.0) THEN
              RETURN (FALSE);
            END_IF;
          END_REPEAT;
        END_REPEAT;
        RETURN (TRUE);
      END_FUNCTION;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("a redeclared attribute narrows the type seen from the subtype", async () => {
    const result = await validate(`
      SCHEMA narrowing;
      ENTITY thing; END_ENTITY;
      ENTITY base; items : SET [0:?] OF thing; END_ENTITY;
      ENTITY single SUBTYPE OF (base);
        SELF\\base.items : SET [1:1] OF thing;
      WHERE
        WR1 : EXISTS(items[1]);
        WR2 : EXISTS(SELF\\base.items[1]);
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("unknown operand types are not reported", async () => {
    const result = await validate(`
      SCHEMA unknown_types;
      TYPE colour = ENUMERATION OF (red, green); END_TYPE;
      ENTITY holder;
        c : colour;
        g : GENERIC_ENTITY;
        anything : AGGREGATE OF INTEGER;
      WHERE
        WR1 : c[1] = red;
        WR2 : EXISTS(g[1]);
        WR3 : anything[1] = 1;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });
});
