import { AstNode, EmptyFileSystem } from "langium";
import { parseDocument } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { isExpressFile, isRule_decl } from "../language/generated/ast.js";

/**
 * The declarations of a schema's specification (ISO 10303-11:2004 clause 11):
 * those visible in it and those implicitly interfaced (11.4), drawn from the
 * schemas it reaches through its interface specifications. Lean model: `step`,
 * `specIter` and `closed_of_stable` in lean/ExpressSuite/SelectExtension.lean.
 */
async function specificationNames(source: string, schemaName: string): Promise<string[]> {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const document = await parseDocument(services, source);
  await services.shared.workspace.DocumentBuilder.build([document]);
  const root = document.parseResult.value;
  if (!isExpressFile(root)) throw new Error("not an express file");
  const schema = root.schemas.find((s) => s.name === schemaName)!;
  const nameOf = (node: AstNode) => (isRule_decl(node) ? node.ruleHead?.name : (node as unknown as { name?: string }).name) ?? "?";
  return [...services.validation.TypeContainer.getScopeIndex().specificationOf(schema)].map(nameOf).sort();
}

describe("the specification of a schema (ISO 10303-11:2004 11.4)", () => {
  test("11.4 EXAMPLE: e2 is referenced; e1 and t1, which e2 and e1 need, are implicitly interfaced", async () => {
    const names = await specificationNames(
      `
      SCHEMA s1;
        TYPE t1 = REAL; END_TYPE;
        ENTITY e1; a : t1; END_ENTITY;
        ENTITY e2; a1 : e1; END_ENTITY;
        ENTITY unrelated; END_ENTITY;
      END_SCHEMA;
      SCHEMA s2;
        REFERENCE FROM s1 (e2);
        ENTITY e3; a3 : e2; END_ENTITY;
      END_SCHEMA;
      `,
      "s2"
    );
    expect(names).toEqual(["e1", "e2", "e3", "t1"]);
  });

  test("11.4.2 EXAMPLE: t1 is referenced, and sel1, whose selection list contains t1, is implicitly interfaced; e1 is not", async () => {
    const names = await specificationNames(
      `
      SCHEMA s1;
        TYPE sel1 = SELECT (e1, t1); END_TYPE;
        TYPE t1 = INTEGER; END_TYPE;
        ENTITY e1; END_ENTITY;
      END_SCHEMA;
      SCHEMA s2;
        REFERENCE FROM s1 (t1);
      END_SCHEMA;
      `,
      "s2"
    );
    expect(names).toEqual(["sel1", "t1"]);
  });

  test("an interfaced extension interfaces its base, not its own selectable items nor its base's (11.4.2)", async () => {
    const names = await specificationNames(
      `
      SCHEMA s1;
        ENTITY a; END_ENTITY;
        ENTITY b; END_ENTITY;
        TYPE base_select = EXTENSIBLE GENERIC_ENTITY SELECT (a); END_TYPE;
        TYPE wider_select = SELECT BASED_ON base_select WITH (b); END_TYPE;
      END_SCHEMA;
      SCHEMA s2;
        REFERENCE FROM s1 (wider_select);
      END_SCHEMA;
      `,
      "s2"
    );
    expect(names).toEqual(["base_select", "wider_select"]);
  });

  test("an interfaced entity interfaces its supertypes, not its subtypes, and every select that lists it (11.4.3)", async () => {
    const names = await specificationNames(
      `
      SCHEMA s1;
        ENTITY top SUPERTYPE OF (ONEOF (middle, other)); END_ENTITY;
        ENTITY middle SUBTYPE OF (top); END_ENTITY;
        ENTITY other SUBTYPE OF (top); END_ENTITY;
        ENTITY bottom SUBTYPE OF (middle); END_ENTITY;
        TYPE base_select = EXTENSIBLE GENERIC_ENTITY SELECT; END_TYPE;
        TYPE middle_select = SELECT BASED_ON base_select WITH (middle); END_TYPE;
      END_SCHEMA;
      SCHEMA s2;
        USE FROM s1 (middle);
      END_SCHEMA;
      `,
      "s2"
    );
    expect(names).toEqual(["base_select", "middle", "middle_select", "top"]);
  });

  test("a schema the checked schema does not reach is not drawn on, even when it interfaces that schema", async () => {
    const names = await specificationNames(
      `
      SCHEMA s1;
        ENTITY a; END_ENTITY;
        TYPE base_select = EXTENSIBLE GENERIC_ENTITY SELECT; END_TYPE;
      END_SCHEMA;
      SCHEMA s3;
        USE FROM s1;
        TYPE outside_select = SELECT BASED_ON base_select WITH (a); END_TYPE;
      END_SCHEMA;
      SCHEMA s2;
        USE FROM s1 (a);
      END_SCHEMA;
      `,
      "s2"
    );
    expect(names).toEqual(["a"]);
  });

  test("a rule is interfaced once every entity of its FOR list is (11.4.3)", async () => {
    const source = `
      SCHEMA s1;
        ENTITY a; END_ENTITY;
        ENTITY b; END_ENTITY;
        RULE ab FOR (a, b); WHERE WR1 : TRUE; END_RULE;
      END_SCHEMA;
      SCHEMA only_a; USE FROM s1 (a); END_SCHEMA;
      SCHEMA both; USE FROM s1 (a, b); END_SCHEMA;
      `;
    expect(await specificationNames(source, "only_a")).toEqual(["a"]);
    expect(await specificationNames(source, "both")).toEqual(["a", "ab", "b"]);
  });
});
