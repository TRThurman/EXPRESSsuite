import { AstUtils, EmptyFileSystem, type AstNode, type Reference } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import type { ExpressFile } from "../language/generated/ast.js";

/**
 * An attribute that an entity inherits, named without `SELF` in the entity (issue 132). A subtype
 * inherits the attributes of its supertypes (ISO 10303-11:2004 9.2.3.3), so the plain name is the
 * inherited attribute, as `SELF.name` and `SELF\supertype.name` are.
 */
async function check(text: string) {
  const services = createExpressP11Services(EmptyFileSystem);
  const { document, diagnostics } = await validationHelper<ExpressFile>(services.ExpressP11)(text);
  const source = document.textDocument.getText();
  /** Where the reference written `name` on the 1-based `line` is bound: `owner.name` of the declaration, or the error. */
  const boundAt = (line: number, name: string): string => {
    for (const node of AstUtils.streamAllContents(document.parseResult.value)) {
      for (const info of AstUtils.streamReferences(node)) {
        const cst = info.reference.$refNode;
        if (!cst || info.reference.$refText !== name || cst.range.start.line + 1 !== line) continue;
        const target = (info.reference as Reference).ref as (AstNode & { name?: string }) | undefined;
        if (!target) return "unresolved";
        const owner = AstUtils.getContainerOfType(target.$container, (n): n is AstNode & { name: string } => n.$type === "EntityDefinition" || n.$type === "FunctionDefinition");
        return `${owner?.name ?? "schema"}.${source.slice(target.$cstNode!.offset, target.$cstNode!.end).split(/\W/)[0] || target.$type}`;
      }
    }
    return "no reference";
  };
  return { errors: diagnostics.filter((d) => d.severity === 1).map((d) => `${d.range.start.line + 1}: ${d.message}`), boundAt, services, document };
}

const ISSUE = `SCHEMA s;
ENTITY base;
  size : INTEGER;
END_ENTITY;
ENTITY special SUBTYPE OF (base);
  extra : INTEGER;
DERIVE
  twice : INTEGER := 2 * size;
UNIQUE
  ur1 : size;
WHERE
  wr1 : size > 0;
  wr2 : SELF.size > 0;
  wr3 : SELF\\base.size > 0;
  wr4 : extra > 0;
END_ENTITY;
END_SCHEMA;
`;

describe("an inherited attribute named without SELF", () => {
  test("in DERIVE, UNIQUE and WHERE it is the supertype's attribute; nothing is reported", async () => {
    const { errors, boundAt } = await check(ISSUE);
    expect(errors).toEqual([]);
    expect(boundAt(8, "size")).toBe("base.size");
    expect(boundAt(10, "size")).toBe("base.size");
    expect(boundAt(12, "size")).toBe("base.size");
    expect(boundAt(15, "extra")).toBe("special.extra");
  });

  test("Find All References from the declaration lists the plain uses", async () => {
    const { services, document } = await check(ISSUE);
    const declaration = [...AstUtils.streamAllContents(document.parseResult.value)].find((n) => n.$type === "Attribute_id" && (n as AstNode & { name: string }).name === "size")!;
    const lines = services.ExpressP11.references.References.findReferences(declaration, {})
      .map((reference) => reference.segment.range.start.line + 1)
      .toArray()
      .sort((a, b) => a - b);
    expect(lines).toEqual([8, 10, 12, 13, 14]);
  });

  test("through two levels; the nearest supertype that declares the name wins", async () => {
    const { errors, boundAt } = await check(`SCHEMA s;
ENTITY top;
  size : NUMBER;
  weight : REAL;
END_ENTITY;
ENTITY middle SUBTYPE OF (top);
  SELF\\top.size : INTEGER;
END_ENTITY;
ENTITY leaf SUBTYPE OF (middle);
WHERE
  wr1 : size > 0;
  wr2 : weight > 0.0;
END_ENTITY;
END_SCHEMA;
`);
    expect(errors).toEqual([]);
    expect(boundAt(11, "size")).toBe("middle.SELF");
    expect(boundAt(12, "weight")).toBe("top.weight");
  });

  test("a name of the entity's own scope hides it: a QUERY variable", async () => {
    const { errors, boundAt } = await check(`SCHEMA s;
ENTITY base;
  item : INTEGER;
  items : SET OF INTEGER;
END_ENTITY;
ENTITY special SUBTYPE OF (base);
WHERE
  wr1 : SIZEOF(QUERY(item <* items | item > 0)) = 0;
END_ENTITY;
END_SCHEMA;
`);
    expect(errors).toEqual([]);
    expect(boundAt(8, "items")).toBe("base.items");
    expect(boundAt(8, "item")).not.toBe("base.item");
  });

  test("it hides a declaration of the schema with the same name, as an attribute of the entity itself does", async () => {
    const text = (subtype: string): string => `SCHEMA s;
CONSTANT
  limit : INTEGER := 3;
END_CONSTANT;
ENTITY base;
  limit : INTEGER;
END_ENTITY;
ENTITY special ${subtype};
  extra : INTEGER;
WHERE
  wr1 : extra < limit;
END_ENTITY;
END_SCHEMA;
`;
    expect((await check(text("SUBTYPE OF (base)"))).boundAt(11, "limit")).toBe("base.limit");
    expect((await check(text(""))).boundAt(11, "limit")).toBe("schema.limit");
  });

  test("an attribute of a subtype or of an unrelated entity is not visible", async () => {
    const { errors } = await check(`SCHEMA s;
ENTITY base;
WHERE
  wr1 : extra > 0;
  wr2 : other > 0;
END_ENTITY;
ENTITY special SUBTYPE OF (base);
  extra : INTEGER;
END_ENTITY;
ENTITY unrelated;
  other : INTEGER;
END_ENTITY;
END_SCHEMA;
`);
    expect(errors).toEqual(["4: A reference could not be resolved.", "5: A reference could not be resolved."]);
  });
});
