import { EmptyFileSystem } from "langium";
import { parseDocument } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import type { ExpressFile } from "../language/generated/ast.js";
import { annotationContexts, findExpressLinks, firstSentenceEnd } from "../language/annotation/blocks.js";

async function contextsOf(text: string) {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const document = await parseDocument<ExpressFile>(services, text);
  return annotationContexts(document.parseResult.value, text);
}

const TWO_SCHEMAS = `SCHEMA demo_schema;
ENTITY widget;
END_ENTITY;
END_SCHEMA;

(*"demo_schema"
The demo schema.
*)

(*"demo_schema.widget"
A widget.
*)

SCHEMA support_schema;
TYPE label = STRING;
END_TYPE;
END_SCHEMA;

(*"support_schema.label"
A label.
*)
`;

describe("annotationContexts", () => {
  test("blocks between END_SCHEMA and the next SCHEMA belong to the schema before them", async () => {
    const text = TWO_SCHEMAS;
    const contexts = await contextsOf(text);
    expect(contexts.map((c) => c.schema)).toEqual(["demo_schema", "support_schema"]);
    expect(contexts[0].blocks.map((b) => [b.key, b.schema, b.body])).toEqual([
      ["demo_schema", "demo_schema", "The demo schema."],
      ["demo_schema.widget", "demo_schema", "A widget."],
    ]);
    expect(contexts[1].blocks.map((b) => [b.key, b.schema, b.body])).toEqual([
      ["support_schema.label", "support_schema", "A label."],
    ]);
    const block = contexts[0].blocks[1];
    expect(text.slice(block.start, block.end)).toBe('(*"demo_schema.widget"\nA widget.\n*)');
    expect(text.slice(block.keyStart, block.keyEnd)).toBe("demo_schema.widget");
    expect(text.slice(block.bodyStart, block.bodyStart + block.body.length)).toBe("A widget.");
    expect(contexts[0].end).toBe(text.indexOf("SCHEMA support_schema"));
    expect(text.slice(contexts[0].start).startsWith("\n\n(*")).toBe(true);
    expect(contexts[1].end).toBe(text.length);
  });

  test("a nested remark in a body is one block", async () => {
    const text = `SCHEMA s;
END_SCHEMA;
(*"s"
Before (* inner remark *) after.
*)
`;
    const [context] = await contextsOf(text);
    expect(context.blocks).toHaveLength(1);
    expect(context.blocks[0].body).toBe("Before (* inner remark *) after.");
    expect(context.unkeyed).toEqual([]);
  });

  test("an unkeyed remark is reported and -- comments are ignored", async () => {
    const text = `SCHEMA s;
END_SCHEMA;
-- (* not a remark *)
(* working note *)
(*"s"
Body.
*)
`;
    const [context] = await contextsOf(text);
    expect(context.blocks).toHaveLength(1);
    expect(context.unkeyed).toHaveLength(1);
    const u = context.unkeyed[0];
    expect(text.slice(u.start, u.end)).toBe("(* working note *)");
    expect(u.schema).toBe("s");
  });
});

describe("findExpressLinks", () => {
  test("finds targets and display text", () => {
    const body = "see <<express:s.a,the a>> and <<express:s.b>>";
    const links = findExpressLinks(body);
    expect(links.map((l) => [l.target, l.display])).toEqual([
      ["s.a", "the a"],
      ["s.b", undefined],
    ]);
    expect(body.slice(links[0].start, links[0].end)).toBe("<<express:s.a,the a>>");
    expect(body.slice(links[1].start, links[1].end)).toBe("<<express:s.b>>");
  });
});

describe("firstSentenceEnd", () => {
  test("skips e.g.", () => {
    const body = "A **w** is used, e.g. here. Next.";
    expect(body.slice(0, firstSentenceEnd(body))).toBe("A **w** is used, e.g. here.");
  });
  test("skips a period inside a link", () => {
    const body = "Uses <<express:s.a,a.b>> now. More.";
    expect(body.slice(0, firstSentenceEnd(body))).toBe("Uses <<express:s.a,a.b>> now.");
  });
  test("no sentence end gives the length", () => {
    expect(firstSentenceEnd("no end here")).toBe(11);
    expect(firstSentenceEnd("ends at end.")).toBe(12);
  });
});
