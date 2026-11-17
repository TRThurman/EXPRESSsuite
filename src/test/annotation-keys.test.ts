import { AstUtils, EmptyFileSystem } from "langium";
import { parseDocument } from "langium/test";
import { describe, expect, test } from "vitest";
import { annotationKeyOf, declaredKeys, describeTargets, memberNamesOf } from "../language/annotation/keys.js";
import { createExpressP11Services } from "../language/express-module.js";
import { Enumeration_type, ExpressFile, TypeDefinition, isRule_decl } from "../language/generated/ast.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const nameProvider = services.references.NameProvider;

const SOURCE = `
SCHEMA demo_schema;
CONSTANT k : INTEGER := 1; END_CONSTANT;
ENTITY base_item; label : STRING; code : STRING; parts : SET [0:?] OF widget; END_ENTITY;
ENTITY widget SUBTYPE OF (base_item);
  size : OPTIONAL INTEGER;
  SELF\\base_item.label : STRING;
  SELF\\base_item.code RENAMED tag : STRING;
DERIVE area : REAL := 1.0;
INVERSE owner : base_item FOR parts;
UNIQUE UR1 : size;
WHERE WR1 : size > 0; size < 9;
END_ENTITY;
TYPE colour = ENUMERATION OF (red, green); END_TYPE;
TYPE count = INTEGER; WHERE WR1 : SELF > 0; END_TYPE;
FUNCTION f (a, b : INTEGER) : INTEGER; RETURN (a); END_FUNCTION;
PROCEDURE p (VAR x : INTEGER); END_PROCEDURE;
SUBTYPE_CONSTRAINT sc FOR base_item; ABSTRACT SUPERTYPE; END_SUBTYPE_CONSTRAINT;
RULE r FOR (widget); WHERE WR1 : TRUE; END_RULE;
END_SCHEMA;
SCHEMA demo_lf; ENTITY e; END_ENTITY; END_SCHEMA;
`;

async function parse(): Promise<ExpressFile> {
  const document = await parseDocument<ExpressFile>(services, SOURCE);
  return document.parseResult.value;
}

describe("annotation keys", () => {
  test("describeTargets lists every key in document order", async () => {
    const keys = describeTargets(await parse(), nameProvider).map((target) => target.key);
    expect(keys).toEqual([
      "demo_schema", "demo_schema.k", "demo_schema.base_item", "demo_schema.base_item.label",
      "demo_schema.base_item.code", "demo_schema.base_item.parts", "demo_schema.widget",
      "demo_schema.widget.size", "demo_schema.widget.label", "demo_schema.widget.tag",
      "demo_schema.widget.area", "demo_schema.widget.owner", "demo_schema.widget.ur:UR1",
      "demo_schema.widget.wr:WR1", "demo_schema.colour", "demo_schema.colour.red",
      "demo_schema.colour.green", "demo_schema.count", "demo_schema.count.wr:WR1", "demo_schema.f",
      "demo_schema.f.a", "demo_schema.f.b", "demo_schema.p", "demo_schema.p.x", "demo_schema.sc",
    ]);
  });

  test("kinds and flags", async () => {
    const targets = describeTargets(await parse(), nameProvider);
    const byKey = new Map(targets.map((target) => [target.key, target]));
    expect(byKey.get("demo_schema.widget.size")).toMatchObject({ kind: "explicit-attribute", optional: true });
    expect(byKey.get("demo_schema.base_item.label")?.optional).toBe(false);
    expect(byKey.get("demo_schema.widget")?.supertypes).toEqual(["base_item"]);
    expect(byKey.get("demo_schema.colour")).toMatchObject({
      kind: "enumeration-type",
      members: ["demo_schema.colour.red", "demo_schema.colour.green"],
    });
    expect(byKey.get("demo_schema.f")?.members).toEqual(["demo_schema.f.a", "demo_schema.f.b"]);
    expect(byKey.get("demo_schema.widget.label")?.kind).toBe("redeclared-attribute");
    expect(byKey.get("demo_schema.widget.tag")?.kind).toBe("redeclared-attribute");
    expect(byKey.get("demo_schema.widget.area")?.kind).toBe("derived-attribute");
    expect(byKey.get("demo_schema.widget.owner")?.kind).toBe("inverse-attribute");
    expect(byKey.get("demo_schema.widget.ur:UR1")?.kind).toBe("unique-rule");
    expect(byKey.get("demo_schema.count.wr:WR1")?.kind).toBe("where-rule");
    expect(byKey.get("demo_schema.k")?.kind).toBe("constant");
  });

  test("annotationKeyOf gives a global rule its key", async () => {
    const root = await parse();
    const rule = root.schemas[0].body.declarations.find(isRule_decl)!;
    expect(annotationKeyOf(rule, nameProvider)).toBe("demo_schema.r");
    expect(annotationKeyOf(rule.where.rules[0], nameProvider)).toBe("demo_schema.r.wr:WR1");
  });

  test("memberNamesOf maps lower-case member names to kinds", async () => {
    const root = await parse();
    const widget = root.schemas[0].body.declarations.find((d) => "name" in d && d.name === "widget")!;
    expect([...memberNamesOf(widget, nameProvider)]).toEqual([
      ["size", "explicit-attribute"], ["label", "redeclared-attribute"], ["tag", "redeclared-attribute"],
      ["area", "derived-attribute"], ["owner", "inverse-attribute"],
    ]);
  });

  test("enumeration items of a BASED_ON extension are members of the extending type", async () => {
    const document = await parseDocument<ExpressFile>(
      services,
      `SCHEMA ext_schema;
TYPE b = EXTENSIBLE ENUMERATION OF (p, q); END_TYPE;
TYPE t = ENUMERATION BASED_ON b WITH (x, y); END_TYPE;
END_SCHEMA;`,
    );
    const root = document.parseResult.value;
    const targets = describeTargets(root, nameProvider);
    expect(targets.map((target) => target.key)).toEqual([
      "ext_schema", "ext_schema.b", "ext_schema.b.p", "ext_schema.b.q",
      "ext_schema.t", "ext_schema.t.x", "ext_schema.t.y",
    ]);
    const t = targets.find((target) => target.key === "ext_schema.t");
    expect(t).toMatchObject({ kind: "enumeration-type", members: ["ext_schema.t.x", "ext_schema.t.y"] });
    const declaration = root.schemas[0].body.declarations.find((d) => "name" in d && d.name === "t")!;
    expect([...memberNamesOf(declaration, nameProvider)]).toEqual([["x", "enumeration-item"], ["y", "enumeration-item"]]);
    const item = (declaration as TypeDefinition).underlyingType as Enumeration_type;
    expect(annotationKeyOf(item.extension!.items!.items[0], nameProvider)).toBe("ext_schema.t.x");
  });

  describe("declaredKeys", () => {
    /** Declarations nested in a function and a rule, local constants, unnamed rules, and a long form. */
    const NESTED = `
SCHEMA demo_schema;
CONSTANT max_size : INTEGER := 10; END_CONSTANT;
TYPE colour = EXTENSIBLE ENUMERATION OF (red, green); WHERE WR1 : TRUE; END_TYPE;
TYPE more_colour = EXTENSIBLE ENUMERATION BASED_ON colour WITH (blue); END_TYPE;
ENTITY widget;
  size, weight : OPTIONAL INTEGER;
DERIVE area : INTEGER := 1;
INVERSE parts : SET [0:?] OF part FOR whole;
UNIQUE UR1 : size; weight;
WHERE WR1 : TRUE; size < 100;
END_ENTITY;
ENTITY part; whole : widget; END_ENTITY;
ENTITY big_widget SUBTYPE OF (widget);
  SELF\\widget.size : INTEGER;
  SELF\\widget.weight RENAMED heavy : INTEGER;
END_ENTITY;
SUBTYPE_CONSTRAINT sc FOR widget; ABSTRACT SUPERTYPE; END_SUBTYPE_CONSTRAINT;
FUNCTION f (a, b : INTEGER; c : REAL) : INTEGER;
  TYPE local_type = ENUMERATION OF (on, off); WHERE LT1 : TRUE; END_TYPE;
  ENTITY local_entity; x : INTEGER; WHERE LW1 : x > 0; END_ENTITY;
  FUNCTION g (q : INTEGER) : INTEGER; RETURN (q); END_FUNCTION;
  CONSTANT local_c : INTEGER := 1; END_CONSTANT;
  LOCAL v : INTEGER; END_LOCAL;
  RETURN (a);
END_FUNCTION;
PROCEDURE pr (VAR z : INTEGER);
  PROCEDURE inner (w : INTEGER); END_PROCEDURE;
END_PROCEDURE;
RULE r FOR (widget);
  ENTITY rule_entity; y : INTEGER; END_ENTITY;
  LOCAL n : INTEGER; END_LOCAL;
WHERE RW1 : TRUE; TRUE;
END_RULE;
END_SCHEMA;
SCHEMA demo_lf; ENTITY gadget; y : INTEGER; END_ENTITY; END_SCHEMA;
`;

    test("collects from the declarations down exactly the keys annotationKeyOf gives over every node", async () => {
      const document = await parseDocument<ExpressFile>(services, NESTED);
      expect(document.parseResult.parserErrors).toEqual([]);
      const root = document.parseResult.value;
      const everyNode = new Set<string>();
      for (const node of AstUtils.streamAst(root)) {
        const key = annotationKeyOf(node, nameProvider);
        if (key) everyNode.add(key.toLowerCase());
      }
      const declared = declaredKeys(root, nameProvider);
      expect([...declared].sort()).toEqual([...everyNode].sort());
      for (const key of [
        "demo_schema.max_size", "demo_schema.more_colour.blue", "demo_schema.widget.ur:ur1", "demo_schema.big_widget.heavy",
        "demo_schema.local_entity.wr:lw1", "demo_schema.local_type.wr:lt1", "demo_schema.g.q", "demo_schema.local_c",
        "demo_schema.inner.w", "demo_schema.rule_entity.y", "demo_schema.r.wr:rw1", "demo_lf.gadget.y",
      ]) {
        expect(declared.has(key), key).toBe(true);
      }
      expect(declared.has("demo_schema.f.v")).toBe(false);
      expect(declared.has("demo_schema.r.n")).toBe(false);
    });

    test("the fixture of describeTargets gives the same keys both ways", async () => {
      const root = await parse();
      const everyNode = new Set<string>();
      for (const node of AstUtils.streamAst(root)) {
        const key = annotationKeyOf(node, nameProvider);
        if (key) everyNode.add(key.toLowerCase());
      }
      expect([...declaredKeys(root, nameProvider)].sort()).toEqual([...everyNode].sort());
    });
  });
});
