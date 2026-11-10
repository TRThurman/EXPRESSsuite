import { AstNode, EmptyFileSystem, LangiumDocument } from "langium";
import { parseDocument } from "langium/test";
import { beforeAll, describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { LinkResolver } from "../language/annotation/link-resolver.js";
import { isExpressFile, SchemaDefinition } from "../language/generated/ast.js";

const source = `
SCHEMA support_schema;
ENTITY shape_aspect;
END_ENTITY;
ENTITY item;
END_ENTITY;
END_SCHEMA;

SCHEMA demo_schema;
USE FROM support_schema;
ENTITY widget;
  size : REAL;
END_ENTITY;
END_SCHEMA;

SCHEMA far_schema;
ENTITY gadget;
END_ENTITY;
END_SCHEMA;

SCHEMA twin_a;
ENTITY twin;
END_ENTITY;
END_SCHEMA;

SCHEMA twin_b;
ENTITY twin;
END_ENTITY;
END_SCHEMA;

SCHEMA demo_lf;
ENTITY gadget;
END_ENTITY;
END_SCHEMA;
`;

describe("annotation link resolver", () => {
  let resolver: LinkResolver;
  let demo: SchemaDefinition;

  beforeAll(async () => {
    const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
    const document: LangiumDocument<AstNode> = await parseDocument(services, source);
    await services.shared.workspace.DocumentBuilder.build([document]);
    const root = document.parseResult.value;
    if (!isExpressFile(root)) throw new Error("not an express file");
    demo = root.schemas.find((schema) => schema.name === "demo_schema")!;
    resolver = new LinkResolver(services.validation.TypeContainer.getScopeIndex(), services.references.NameProvider);
  });

  test("resolve: reachable through USE FROM", () => {
    expect(resolver.resolve(demo, "shape_aspect")).toEqual({ kind: "reachable", schema: "support_schema" });
  });
  test("resolve: unique elsewhere, long form not counted", () => {
    expect(resolver.resolve(demo, "gadget")).toEqual({ kind: "unique-elsewhere", schema: "far_schema" });
  });
  test("resolve: ambiguous", () => {
    expect(resolver.resolve(demo, "twin")).toEqual({ kind: "ambiguous", schemas: ["twin_a", "twin_b"] });
  });
  test("resolve: none", () => {
    expect(resolver.resolve(demo, "nothing")).toEqual({ kind: "none" });
  });
  test("resolve: compares without regard to case", () => {
    expect(resolver.resolve(demo, "Shape_Aspect")).toEqual({ kind: "reachable", schema: "support_schema" });
  });

  test("check: declared, undeclared, unknown schema", () => {
    expect(resolver.check("support_schema.item")).toBe("declared");
    expect(resolver.check("Support_Schema.ITEM")).toBe("declared");
    expect(resolver.check("support_schema.nope")).toBe("undeclared");
    expect(resolver.check("missing_schema.x")).toBe("unknown-schema");
    expect(resolver.check("demo_lf.gadget")).toBe("unknown-schema");
  });
  test("check: member targets", () => {
    expect(resolver.check("demo_schema.widget.size")).toBe("declared");
    expect(resolver.isAttributeTarget("demo_schema.widget.size")).toBe(true);
    expect(resolver.check("demo_schema.widget.nope")).toBe("undeclared");
    expect(resolver.check("demo_schema.nope.size")).toBe("undeclared");
    expect(resolver.isAttributeTarget("demo_schema.widget.nope")).toBe(false);
    expect(resolver.isAttributeTarget("support_schema.item")).toBe(false);
  });
  test("check: a one-part target names a schema of the workspace (R11)", () => {
    expect(resolver.check("demo_schema")).toBe("declared");
    expect(resolver.check("Demo_Schema")).toBe("declared");
    expect(resolver.check("missing_schema")).toBe("unknown-schema");
    expect(resolver.check("demo_lf")).toBe("unknown-schema");
  });
  test("check: other shapes are unsupported", () => {
    expect(resolver.check("demo_schema.widget.wr:WR1")).toBe("unsupported");
    expect(resolver.check("a.b.c.d")).toBe("unsupported");
    expect(resolver.check("demo schema")).toBe("unsupported");
  });
});
