import { EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

const SUPPORT = `
SCHEMA support_schema;
ENTITY shape_aspect;
END_ENTITY;
END_SCHEMA;
`;

/** A demo schema with an entity, an optional and a mandatory attribute, and the given annotation text after END_SCHEMA. */
function demo(annotations: string, extra = ""): string {
  return `${SUPPORT}
SCHEMA demo_schema;
REFERENCE FROM support_schema;
ENTITY widget;
  size : INTEGER;
  note : OPTIONAL STRING;
END_ENTITY;
ENTITY gadget SUBTYPE OF (shape_aspect);
END_ENTITY;
${extra}
END_SCHEMA;
${annotations}
`;
}

async function codes(text: string): Promise<{ code: string; severity?: number; message: unknown }[]> {
  const result = await validate(text);
  return result.diagnostics
    .filter((d) => String(d.code).startsWith("annotation-"))
    .map((d) => ({ code: String(d.code), severity: d.severity, message: String(d.message) }));
}

async function codeList(text: string): Promise<string[]> {
  return (await codes(text)).map((d) => d.code);
}

const CLEAN = `
(*"demo_schema"
A demo schema.
*)
(*"demo_schema.widget"
A **widget** is a thing described with <<express:support_schema.shape_aspect,shape_aspect>>.
*)
(*"demo_schema.widget.size"
The size of the widget.
*)
(*"demo_schema.widget.note"
A remark. The value of this attribute need not be specified.
*)
`;

describe("annotation check", () => {
  test("clean fixture draws nothing", async () => {
    expect(await codeList(demo(CLEAN))).toEqual([]);
  });

  test("undeclared link", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget"\nSee <<express:support_schema.nope,x>>.\n*)`))).toEqual(["annotation-link-undeclared"]);
  });

  test("link to an unknown schema is information", async () => {
    const found = await codes(demo(`(*"demo_schema.widget"\nSee <<express:missing_schema.x,x>>.\n*)`));
    expect(found.map((d) => d.code)).toEqual(["annotation-link-unverified"]);
    expect(found[0].severity).toBe(3);
  });

  test("link of an unsupported shape is information (R1)", async () => {
    const found = await codes(demo(`(*"demo_schema.widget"\nSee <<express:demo_schema.widget.wr:WR1,x>>.\n*)`));
    expect(found.map((d) => d.code)).toEqual(["annotation-link-unverified"]);
    expect(found[0].severity).toBe(3);
  });

  test("link with a space", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget"\nSee <<express:support_schema.shape aspect,x>>.\n*)`))).toEqual(["annotation-link-space"]);
  });

  test("self link", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget"\nThe <<express:demo_schema.widget,widget>> is itself.\n*)`))).toEqual(["annotation-self-link"]);
  });

  test("a member block linking a declaration named like the member is no self link", async () => {
    const found = await codeList(
      demo(`(*"demo_schema.widget.size"\nThe size, see <<express:demo_schema.size,size>>.\n*)`, "TYPE size = INTEGER;\nEND_TYPE;")
    );
    expect(found).toEqual([]);
  });

  test("a member block linking its own key is a self link", async () => {
    const found = await codeList(
      demo(`(*"demo_schema.widget.size"\nThe <<express:demo_schema.widget.size,size>> itself.\n*)`, "TYPE size = INTEGER;\nEND_TYPE;")
    );
    expect(found).toEqual(["annotation-self-link"]);
  });

  test("orphan key", async () => {
    expect(await codeList(demo(`(*"demo_schema.ghost"\nNothing.\n*)`))).toEqual(["annotation-orphan-key"]);
  });

  test("a key in another case than the declaration is no orphan", async () => {
    expect(await codeList(demo(`(*"Demo_Schema.Widget"\nA widget.\n*)`))).toEqual([]);
  });

  test("a key with a .__ suffix ending is checked without it", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget.__x"\nA widget.\n*)`))).toEqual([]);
  });

  test("duplicate key on the second block", async () => {
    const found = await codes(demo(`(*"demo_schema.widget"\nOne.\n*)\n(*"demo_schema.widget"\nTwo.\n*)`));
    expect(found.map((d) => d.code)).toEqual(["annotation-duplicate-key"]);
  });

  test("repeated role blocks (.__ suffix) draw no duplicate key (R10)", async () => {
    const roles = [
      `(*"demo_schema.__expressg"\nFigure 1.\n*)`,
      `(*"demo_schema.__expressg"\nFigure 2.\n*)`,
      `(*"demo_schema.widget.__note"\nOne note.\n*)`,
      `(*"demo_schema.widget.__note"\nAnother note.\n*)`,
    ].join("\n");
    expect(await codeList(demo(roles))).toEqual([]);
  });

  test("unkeyed remark after END_SCHEMA", async () => {
    expect(await codeList(demo(`(* a working note *)`))).toEqual(["annotation-unkeyed-remark"]);
  });

  test("non-ASCII character", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget"\nThe widget’s role.\n*)`))).toEqual(["annotation-non-ascii"]);
  });

  test("attribute link in the first sentence", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget"\nThe <<express:demo_schema.widget.size,size>> is the point. Second.\n*)`))).toEqual([
      "annotation-first-sentence-attribute-link",
    ]);
  });

  test("attribute link after the first sentence is fine", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget"\nFirst. The <<express:demo_schema.widget.size,size>> follows.\n*)`))).toEqual([]);
  });

  test("optional attribute without the sentence", async () => {
    expect(await codeList(demo(`(*"demo_schema.widget.note"\nA remark.\n*)`))).toEqual(["annotation-optional-sentence"]);
  });

  test("bare subtype description", async () => {
    expect(
      await codeList(demo(`(*"demo_schema.gadget"\nA **gadget** is a type of <<express:support_schema.shape_aspect,shape_aspect>>.\n*)`))
    ).toEqual(["annotation-bare-subtype"]);
  });

  test("global RULE block gets no first-sentence finding", async () => {
    const rule = `RULE demo_rule FOR (widget);\nWHERE\n  wr1: TRUE;\nEND_RULE;`;
    expect(
      await codeList(demo(`(*"demo_schema.demo_rule"\nThe <<express:demo_schema.widget.size,size>> is checked.\n*)`, rule))
    ).toEqual([]);
  });

  test("long-form schema with an unkeyed remark draws nothing", async () => {
    const text = `SCHEMA demo_mim_lf;\nENTITY widget;\nEND_ENTITY;\nEND_SCHEMA;\n(* a note *)\n`;
    expect(await codeList(text)).toEqual([]);
  });

  describe("blocks inside a schema", () => {
    const inside = (body: string, after = ""): string => `${SUPPORT}
SCHEMA demo_schema;
${body}
END_SCHEMA;
${after}
`;
    const ENTITY = `ENTITY widget;\n  size : INTEGER;\nEND_ENTITY;`;

    test("between two declarations", async () => {
      expect(await codeList(inside(`${ENTITY}\n(*"demo_schema.widget"\nA widget.\n*)\nTYPE other = INTEGER;\nEND_TYPE;`))).toEqual(["annotation-inside-schema"]);
    });

    test("inside an entity body", async () => {
      expect(await codeList(inside(`ENTITY widget;\n  size : INTEGER;\n(*"demo_schema.widget.size"\nThe size.\n*)\nEND_ENTITY;`))).toEqual(["annotation-inside-schema"]);
    });

    test("inside a function body", async () => {
      const fn = `FUNCTION f(x : INTEGER) : INTEGER;\n(*"demo_schema.f"\nA function.\n*)\nRETURN (x);\nEND_FUNCTION;`;
      expect(await codeList(inside(`${ENTITY}\n${fn}`))).toEqual(["annotation-inside-schema"]);
    });

    test("an informal-proposition block inside is flagged too", async () => {
      const found = await codeList(inside(`ENTITY widget;\nWHERE\n  wr1: TRUE;\n--IP1:\nEND_ENTITY;\n(*"demo_schema.widget.wr:IP1"\nText.\n*)`));
      expect(found).toEqual(["annotation-inside-schema"]);
    });

    test("an unkeyed remark and a line remark inside draw nothing", async () => {
      expect(await codeList(inside(`${ENTITY}\n(* a note *)\n--"demo_schema.widget" a line remark`))).toEqual([]);
    });

    test("the same block after END_SCHEMA draws nothing", async () => {
      expect(await codeList(inside(ENTITY, `(*"demo_schema.widget"\nA widget.\n*)`))).toEqual([]);
    });

    test("a long-form schema with a keyed remark inside draws nothing", async () => {
      const text = `SCHEMA demo_mim_lf;\nENTITY widget;\n(*"demo_mim_lf.widget"\nx\n*)\nEND_ENTITY;\nEND_SCHEMA;\n`;
      expect(await codeList(text)).toEqual([]);
    });
  });
});
