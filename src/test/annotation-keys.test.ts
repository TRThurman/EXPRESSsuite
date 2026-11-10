import { EmptyFileSystem } from "langium";
import { parseDocument } from "langium/test";
import { describe, expect, test } from "vitest";
import { annotationKeyOf, describeTargets, memberNamesOf } from "../language/annotation/keys.js";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressFile, isRule_decl } from "../language/generated/ast.js";

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
});
