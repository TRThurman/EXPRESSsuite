import { EmptyFileSystem } from "langium";
import { expectNoIssues, validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";

/**
 * Attribute redeclaration type compatibility (ISO 10303-11:2004 9.2.3.4 a,
 * 9.2.7). The verdicts below are those of the proved relation `spec` in
 * lean/ExpressSuite/Cases.lean, whose `#guard`s are build-checked; the schema
 * texts are Edition 1 forms of the wg12-step cases. A relation that never
 * resolves the original operand rejects every accepted case below; the
 * negative control is a genuine error.
 */
const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);
const code = ExpressP11Issues.RedeclarationNotSpecialization;

const compoundItem = `
  ENTITY representation_item;
    name : STRING;
  END_ENTITY;
  ENTITY geometric_representation_item
    SUBTYPE OF (representation_item);
  END_ENTITY;
  TYPE list_representation_item = LIST [1:?] OF representation_item;
  END_TYPE;
  TYPE set_representation_item = SET [1:?] OF representation_item;
  END_TYPE;
  TYPE compound_item_definition = SELECT
    (list_representation_item,
     set_representation_item);
  END_TYPE;
  ENTITY compound_representation_item
    SUBTYPE OF (representation_item);
    item_element : compound_item_definition;
  END_ENTITY;
`;

const issues = (result: Awaited<ReturnType<typeof validate>>) => result.diagnostics.filter((d) => d.code === code);

describe("redeclared attribute type specialization", () => {
  test("ply_orientation_specification: LIST [2:3] OF SELECT(point, direction) narrows the select of aggregates", async () => {
    const result = await validate(`
      SCHEMA repro_2205;
      ${compoundItem}
      ENTITY point SUBTYPE OF (geometric_representation_item); END_ENTITY;
      ENTITY direction SUBTYPE OF (geometric_representation_item); direction_ratios : LIST [2:3] OF REAL; END_ENTITY;
      TYPE point_and_vector_member = SELECT (point, direction); END_TYPE;
      TYPE point_and_vector_members = LIST [2:3] OF point_and_vector_member; END_TYPE;
      ENTITY point_and_vector
        SUBTYPE OF (compound_representation_item, geometric_representation_item);
        SELF\\compound_representation_item.item_element : point_and_vector_members;
      END_ENTITY;
      TYPE point_array_members = LIST [1:?] OF point_and_vector; END_TYPE;
      ENTITY point_array
        SUBTYPE OF (compound_representation_item, geometric_representation_item);
        SELF\\compound_representation_item.item_element : point_array_members;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("change_management: LIST OF a representation_item subtype", async () => {
    const result = await validate(`
      SCHEMA repro_2213;
      ${compoundItem}
      ENTITY int_literal; the_value : INTEGER; END_ENTITY;
      ENTITY integer_representation_item SUBTYPE OF (representation_item, int_literal); END_ENTITY;
      TYPE location_in_aggregate_item = LIST [1:?] OF integer_representation_item; END_TYPE;
      ENTITY location_in_aggregate_representation_item
        SUBTYPE OF (compound_representation_item);
        SELF\\compound_representation_item.item_element : location_in_aggregate_item;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("constructive_solid_geometry_2d: a one-member select over a SET of a select of subtypes, RENAMED", async () => {
    const result = await validate(`
      SCHEMA repro_2214;
      ${compoundItem}
      ENTITY primitive_2d SUBTYPE OF (geometric_representation_item); END_ENTITY;
      ENTITY circular_area SUBTYPE OF (primitive_2d); END_ENTITY;
      ENTITY polygonal_area SUBTYPE OF (primitive_2d); END_ENTITY;
      ENTITY complex_area ABSTRACT SUPERTYPE SUBTYPE OF (primitive_2d); END_ENTITY;
      TYPE bounded_primitive_2d = SELECT (circular_area, polygonal_area); END_TYPE;
      TYPE set_inner_area_boundary = SET [1:?] OF bounded_primitive_2d; END_TYPE;
      TYPE compound_inner_area_boundary = SELECT (set_inner_area_boundary); END_TYPE;
      ENTITY primitive_2d_with_inner_boundary
        SUBTYPE OF (complex_area, compound_representation_item);
        SELF\\compound_representation_item.item_element RENAMED inner_boundary : compound_inner_area_boundary;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("product_structure_schema: a select whose members are a member or a subtype of a member of the original (Edition 2 form)", async () => {
    const result = await validate(`
      SCHEMA repro_2207;
      ENTITY product_definition; id : STRING; END_ENTITY;
      ENTITY external_source; source_id : STRING; END_ENTITY;
      ENTITY generic_product_definition_reference ABSTRACT SUPERTYPE OF (ONEOF (product_definition_reference));
        source : external_source;
      END_ENTITY;
      ENTITY product_definition_reference SUBTYPE OF (generic_product_definition_reference); product_id : STRING; END_ENTITY;
      ENTITY product_definition_occurrence_reference SUBTYPE OF (product_definition_reference); product_occurrence_id : STRING; END_ENTITY;
      TYPE product_definition_or_reference = EXTENSIBLE GENERIC_ENTITY SELECT (product_definition, generic_product_definition_reference); END_TYPE;
      TYPE product_definition_or_reference_or_occurrence = SELECT BASED_ON product_definition_or_reference WITH (product_definition_occurrence); END_TYPE;
      TYPE product_definition_occurrence_or_reference = SELECT (product_definition_occurrence, product_definition_occurrence_reference); END_TYPE;
      ENTITY product_definition_occurrence SUPERTYPE OF (product_definition_specified_occurrence);
        id : STRING;
        definition : OPTIONAL product_definition_or_reference_or_occurrence;
      END_ENTITY;
      ENTITY product_definition_specified_occurrence SUBTYPE OF (product_definition_occurrence);
        SELF\\product_definition_occurrence.definition : product_definition_occurrence_or_reference;
        occurrence_usage : product_definition_occurrence_or_reference;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("an extension declared in another schema is folded into the original select", async () => {
    const result = await validate(`
      SCHEMA base_schema;
      ENTITY a; END_ENTITY;
      ENTITY b; END_ENTITY;
      TYPE base_select = EXTENSIBLE SELECT (a); END_TYPE;
      ENTITY holder; item : base_select; END_ENTITY;
      END_SCHEMA;

      SCHEMA extending_schema;
      USE FROM base_schema;
      TYPE wider_select = SELECT BASED_ON base_select WITH (b); END_TYPE;
      ENTITY narrow_holder SUBTYPE OF (holder);
        SELF\\holder.item : b;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });

  test("negative control: LIST OF REAL and a widened lower bound are not specializations", async () => {
    const result = await validate(`
      SCHEMA repro_negative;
      ${compoundItem}
      TYPE real_list = LIST [1:?] OF REAL; END_TYPE;
      ENTITY bad_compound SUBTYPE OF (compound_representation_item);
        SELF\\compound_representation_item.item_element : real_list;
      END_ENTITY;
      ENTITY bad_bounds SUBTYPE OF (compound_representation_item);
        SELF\\compound_representation_item.item_element : LIST [0:?] OF representation_item;
      END_ENTITY;
      END_SCHEMA;
    `);
    const found = issues(result);
    expect(found.map((d) => d.data)).toEqual([
      { attribute: "item_element", newType: "real_list", originalType: "compound_item_definition" },
      { attribute: "item_element", newType: "LIST [0:?] OF representation_item", originalType: "compound_item_definition" },
    ]);
    expect(found.every((d) => d.severity === DiagnosticSeverity.Error)).toBe(true);
    expect(found[0].message).toContain("9.2.3.4");
  });

  test("a failed check against an EXTENSIBLE original select is a warning, not an error", async () => {
    const result = await validate(`
      SCHEMA repro_extensible;
      ENTITY a; END_ENTITY;
      ENTITY unrelated; END_ENTITY;
      TYPE open_select = EXTENSIBLE SELECT (a); END_TYPE;
      ENTITY holder; item : open_select; END_ENTITY;
      ENTITY narrow_holder SUBTYPE OF (holder);
        SELF\\holder.item : unrelated;
      END_ENTITY;
      END_SCHEMA;
    `);
    const found = issues(result);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  test("textbook forms of 9.2.3.4 are accepted: NUMBER to INTEGER, GENERIC_ENTITY original, optional to mandatory, bounds within", async () => {
    const result = await validate(`
      SCHEMA textbook;
      ENTITY thing; END_ENTITY;
      ENTITY widget; END_ENTITY;
      ENTITY point; x : NUMBER; y : NUMBER; END_ENTITY;
      ENTITY integer_point SUBTYPE OF (point);
        SELF\\point.x RENAMED integer_x : INTEGER;
        SELF\\point.y RENAMED integer_y : INTEGER;
      END_ENTITY;
      ENTITY line ABSTRACT; start : GENERIC_ENTITY; END_ENTITY;
      ENTITY integer_point_line SUBTYPE OF (line);
        SELF\\line.start RENAMED integer_start : integer_point;
      END_ENTITY;
      ENTITY super;
        things : LIST [3:?] OF thing;
        items : BAG [0:?] OF widget;
        may_be : OPTIONAL STRING;
      END_ENTITY;
      ENTITY sub SUBTYPE OF (super);
        SELF\\super.things : LIST [3:?] OF UNIQUE thing;
        SELF\\super.items : SET [1:5] OF widget;
        SELF\\super.may_be : STRING;
      END_ENTITY;
      END_SCHEMA;
    `);
    expectNoIssues(result, { code });
  });
});
