import { AstNode, EmptyFileSystem, LangiumDocument } from "langium";
import { parseDocument } from "langium/test";
import { beforeAll, describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { LinkResolver } from "../language/annotation/link-resolver.js";
import { applyLinks, linkProposals } from "../language/annotation/proposals.js";
import type { DescribeTarget } from "../language/annotation/keys.js";
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

const TEXT = "A widget refines a shape_aspect and an item; see the gadget, the twin and the shape aspects.";

describe("annotation link proposals", () => {
  let resolver: LinkResolver;
  let demo: SchemaDefinition;
  let visible: string[];
  const widget: DescribeTarget = { key: "demo_schema.widget", kind: "entity", name: "widget", schema: "demo_schema", start: 0, end: 0 };

  beforeAll(async () => {
    const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
    const document: LangiumDocument<AstNode> = await parseDocument(services, source);
    await services.shared.workspace.DocumentBuilder.build([document]);
    const root = document.parseResult.value;
    if (!isExpressFile(root)) throw new Error("not an express file");
    demo = root.schemas.find((schema) => schema.name === "demo_schema")!;
    const index = services.validation.TypeContainer.getScopeIndex();
    resolver = new LinkResolver(index, services.references.NameProvider);
    visible = [...index.visibleIn(demo)].map((arrival) => arrival.effectiveName);
  });

  const propose = (text: string, target = widget) => linkProposals(text, target, demo, resolver, visible);

  test("classifies each name in the sentence", () => {
    const byText = new Map(propose(TEXT).map((p) => [p.text, p]));
    expect(byText.get("widget")).toMatchObject({ status: "subject" });
    expect(byText.get("shape_aspect")).toMatchObject({ status: "auto", schema: "support_schema", name: "shape_aspect" });
    expect(byText.get("item")).toMatchObject({ status: "proposed", schema: "support_schema" });
    expect(byText.get("gadget")).toMatchObject({ status: "proposed", schema: "far_schema" });
    expect(byText.get("twin")).toMatchObject({ status: "ambiguous", schemas: ["twin_a", "twin_b"] });
    expect(byText.get("shape aspects")).toMatchObject({ status: "proposed", name: "shape_aspect", schema: "support_schema" });
    expect(byText.has("shape")).toBe(false);
    expect(byText.has("A")).toBe(false);
    for (const p of propose(TEXT)) expect(TEXT.slice(p.start, p.end)).toBe(p.text);
  });

  test("applyLinks", () => {
    const all = propose(TEXT);
    const chosen = all.filter((p) => p.status === "auto" || p.status === "subject" || p.text === "item" || p.text === "shape aspects");
    expect(applyLinks(TEXT, chosen)).toBe(
      "A **widget** refines a <<express:support_schema.shape_aspect,shape_aspect>> and an <<express:support_schema.item,item>>; see the gadget, the twin and the <<express:support_schema.shape_aspect,shape aspects>>."
    );
  });

  test("applyLinks never links an ambiguous span", () => {
    expect(applyLinks(TEXT, propose(TEXT).filter((p) => p.text === "twin"))).toBe(TEXT);
  });

  test("case-insensitive, display keeps the author's words", () => {
    const [p] = propose("See Shape_Aspect.");
    expect(p).toMatchObject({ status: "auto", text: "Shape_Aspect", name: "shape_aspect" });
    const [q] = propose("Many SHAPE ASPECT values.");
    expect(q).toMatchObject({ status: "proposed", text: "SHAPE ASPECT" });
  });

  test("plural of a single word reduces to the declared name", () => {
    expect(propose("Two items.")[0]).toMatchObject({ status: "proposed", name: "item", text: "items" });
  });

  test("subject of a member target is its owner", () => {
    const attribute: DescribeTarget = { ...widget, key: "demo_schema.widget.size", kind: "explicit-attribute", name: "size", owner: "widget" };
    expect(propose("The size of the widget.", attribute).map((p) => [p.text, p.status])).toEqual([["widget", "subject"]]);
  });

  test("text already linked or marked is not proposed again", () => {
    const text = "<<express:support_schema.item,item>> and **gadget** and shape_aspect";
    expect(propose(text).map((p) => p.text)).toEqual(["shape_aspect"]);
  });

  test("a run is not carried across punctuation", () => {
    expect(propose("shape. aspects").map((p) => p.text)).toEqual([]);
  });
});
