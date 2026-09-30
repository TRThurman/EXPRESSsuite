import { AstUtils, EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { Attribute_id, isAttribute_qualifier, isEntityDefinition, isGroup_qualifier } from "../language/generated/ast.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

// shape_aspect / datum_reference_element mirror ISO 10303-47
// shape_aspect_definition_schema, where TYPE common_datum_list applies a group
// qualifier to a QUERY variable iterating SELF.
const PREAMBLE = `
ENTITY product_definition_shape;
  shape_id : STRING;
END_ENTITY;
ENTITY shape_aspect;
  of_shape : product_definition_shape;
END_ENTITY;
ENTITY datum_reference_element
  SUBTYPE OF (shape_aspect);
END_ENTITY;
`;

/**
 * Resolves a schema body and reports, for every qualifier, the declaration each
 * reference actually points at. Asserting the target — not merely the absence of
 * a diagnostic — is what distinguishes "resolved correctly" from "silenced".
 */
const resolve = async (body: string) => {
  const result = await validate(`SCHEMA probe;${PREAMBLE}${body}END_SCHEMA;`);
  const targets: string[] = [];
  for (const node of AstUtils.streamAllContents(result.document.parseResult.value)) {
    if (isGroup_qualifier(node)) {
      targets.push(`\\${node.entity.$refText} => ${node.entity.ref ? node.entity.ref.name : "UNRESOLVED"}`);
    }
    if (isAttribute_qualifier(node)) {
      const ref = node.target.ref;
      if (!ref) {
        targets.push(`.${node.target.$refText} => UNRESOLVED`);
        continue;
      }
      const owner = AstUtils.getContainerOfType(ref, isEntityDefinition);
      targets.push(`.${node.target.$refText} => ${owner?.name ?? "?"}.${(ref as Attribute_id).name ?? node.target.$refText}`);
    }
  }
  return { diagnostics: (result.diagnostics ?? []).map((d) => d.message), targets };
};

describe("SELF inside a TYPE declaration", () => {
  test("a group qualifier on a QUERY variable iterating SELF resolves to the supertype", async () => {
    // Verbatim from shape_aspect_definition_schema.exp (ISO 10303-47).
    expect(
      await resolve(`
TYPE common_datum_list = LIST[2:?] OF datum_reference_element;
WHERE
  WR1: SIZEOF( QUERY(dre <* SELF | dre\\shape_aspect.of_shape <> SELF[1]\\shape_aspect.of_shape)) = 0;
END_TYPE;
`)
    ).toEqual({
      diagnostics: [],
      targets: [
        "\\shape_aspect => shape_aspect",
        ".of_shape => shape_aspect.of_shape",
        "\\shape_aspect => shape_aspect",
        ".of_shape => shape_aspect.of_shape",
      ],
    });
  });

  test("a plain attribute on a QUERY variable iterating SELF resolves to the inherited attribute", async () => {
    expect(
      await resolve(`
TYPE cdl_d = LIST[2:?] OF datum_reference_element;
WHERE
  WRD: SIZEOF( QUERY(dre <* SELF | EXISTS(dre.of_shape))) = 0;
END_TYPE;
`)
    ).toEqual({ diagnostics: [], targets: [".of_shape => shape_aspect.of_shape"] });
  });

  test("a group qualifier on an indexed SELF resolves", async () => {
    expect(
      await resolve(`
TYPE cdl_e = LIST[2:?] OF datum_reference_element;
WHERE
  WRE: EXISTS(SELF[1]\\shape_aspect.of_shape);
END_TYPE;
`)
    ).toEqual({
      diagnostics: [],
      targets: ["\\shape_aspect => shape_aspect", ".of_shape => shape_aspect.of_shape"],
    });
  });

  test("a named (non-aggregate) underlying type resolves", async () => {
    expect(
      await resolve(`
TYPE plain_datum = datum_reference_element;
WHERE
  WRP: EXISTS(SELF\\shape_aspect.of_shape);
END_TYPE;
`)
    ).toEqual({
      diagnostics: [],
      targets: ["\\shape_aspect => shape_aspect", ".of_shape => shape_aspect.of_shape"],
    });
  });

  test("an unrelated entity is still rejected as a group qualifier", async () => {
    // product_definition_shape is not a supertype of datum_reference_element, so
    // the scope must stay restrictive. This guards against the fix resolving
    // group qualifiers to arbitrary entities merely to silence diagnostics.
    const result = await resolve(`
TYPE cdl_neg = LIST[2:?] OF datum_reference_element;
WHERE
  WRN: EXISTS(SELF[1]\\product_definition_shape.shape_id);
END_TYPE;
`);
    expect(result.targets).toContain("\\product_definition_shape => UNRESOLVED");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("SELF resolution outside a TYPE declaration is unchanged", () => {
  test("SELF in an ENTITY WHERE clause still resolves to the enclosing entity's supertype", async () => {
    expect(
      await resolve(`
ENTITY drel
  SUBTYPE OF (datum_reference_element);
WHERE
  WRB: EXISTS(SELF\\shape_aspect.of_shape);
END_ENTITY;
`)
    ).toEqual({
      diagnostics: [],
      targets: ["\\shape_aspect => shape_aspect", ".of_shape => shape_aspect.of_shape"],
    });
  });

  test("a QUERY over an ENTITY attribute still resolves", async () => {
    expect(
      await resolve(`
ENTITY collection;
  elements : LIST[2:?] OF datum_reference_element;
WHERE
  WRC: SIZEOF( QUERY(dre <* elements | EXISTS(dre\\shape_aspect.of_shape))) = 0;
END_ENTITY;
`)
    ).toEqual({
      diagnostics: [],
      targets: ["\\shape_aspect => shape_aspect", ".of_shape => shape_aspect.of_shape"],
    });
  });

  test("a SELECT type attribute still resolves", async () => {
    expect(
      await resolve(`
TYPE dre_select = SELECT(datum_reference_element);
END_TYPE;
ENTITY holder_g;
  item : dre_select;
WHERE
  WRG: EXISTS(item\\shape_aspect.of_shape);
END_ENTITY;
`)
    ).toEqual({
      diagnostics: [],
      targets: ["\\shape_aspect => shape_aspect", ".of_shape => shape_aspect.of_shape"],
    });
  });
});
