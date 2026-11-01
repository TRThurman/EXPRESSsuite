import { AstUtils, EmptyFileSystem } from "langium";
import { expectCompletion, validationHelper } from "langium/test";
import { CompletionList } from "vscode-languageserver";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { Attribute_id, isAttribute_qualifier, isEntityDefinition, isGroup_qualifier, isInverse_attr } from "../language/generated/ast.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);
const completion = expectCompletion(services);

/**
 * Two branches under one root, each declaring `shared_name`, plus an entity in
 * another component. ISO 10303-11:2004 gives the two reference kinds different
 * scopes over this graph:
 *
 *  - 12.7.4, group reference `x\E`: E may be any entity "in the same
 *    subtype/supertype graph", the sibling branch included;
 *  - 12.7.3, attribute reference `x.a`: a must be declared in the declared type
 *    of x, a supertype or a subtype of it; after a group reference, in E itself.
 *
 * The two halves of this file guard each other: narrowing the group scope
 * breaks the G cases, widening the attribute scope breaks the P cases.
 */
const PREAMBLE = `
ENTITY root; id : STRING; END_ENTITY;
ENTITY left_branch SUBTYPE OF (root); shared_name : STRING; left_only : STRING; END_ENTITY;
ENTITY right_branch SUBTYPE OF (root); shared_name : LIST [1:?] OF STRING; right_only : STRING; END_ENTITY;
ENTITY right_leaf SUBTYPE OF (right_branch); leaf_only : STRING; END_ENTITY;
ENTITY stranger; shared_name : STRING; END_ENTITY;
TYPE either = SELECT (left_branch, right_leaf); END_TYPE;
`;

/** Where every qualifier and INVERSE FOR in `text` actually binds, as `owner.attribute`. */
const resolveText = async (text: string) => {
  const result = await validate(text);
  const targets: string[] = [];
  const ownerOf = (ref: unknown, fallback: string): string => {
    const owner = AstUtils.getContainerOfType(ref as Parameters<typeof AstUtils.getContainerOfType>[0], isEntityDefinition);
    return `${owner?.name ?? "?"}.${(ref as Attribute_id).name ?? fallback}`;
  };
  for (const node of AstUtils.streamAllContents(result.document.parseResult.value)) {
    if (isGroup_qualifier(node)) {
      targets.push(`\\${node.entity.$refText} => ${node.entity.ref ? node.entity.ref.name : "UNRESOLVED"}`);
    }
    if (isAttribute_qualifier(node)) {
      const ref = node.target.ref;
      targets.push(`.${node.target.$refText} => ${ref ? ownerOf(ref, node.target.$refText) : "UNRESOLVED"}`);
    }
    if (isInverse_attr(node)) {
      const ref = node.forAttribute.ref;
      const name = `${node.forEntity ? `${node.forEntity.$refText}.` : ""}${node.forAttribute.$refText}`;
      targets.push(`FOR ${name} => ${ref ? ownerOf(ref, node.forAttribute.$refText) : "UNRESOLVED"}`);
    }
  }
  const diagnostics = result.diagnostics ?? [];
  return {
    messages: diagnostics.map((d) => (typeof d.message === "string" ? d.message : d.message.value)),
    codes: diagnostics.map((d) => d.code ?? (d.data as { code?: string } | undefined)?.code),
    targets,
  };
};
const resolve = (body: string) => resolveText(`SCHEMA probe;${PREAMBLE}${body}END_SCHEMA;`);

const expectExactly = (completions: CompletionList, labels: string[]): void => {
  expect(completions.items.map((i) => i.label).sort()).toEqual([...labels].sort());
};

describe("group references reach the whole subtype/supertype graph (12.7.4)", () => {
  test("G1: SELF\\sibling.attr inside an entity resolves, attribute in the sibling's own declaration", async () => {
    const r = await resolve(`
ENTITY probe_g1 SUBTYPE OF (right_leaf);
WHERE
  w : EXISTS(SELF\\left_branch.left_only);
END_ENTITY;
`);
    expect(r.targets).toEqual(["\\left_branch => left_branch", ".left_only => left_branch.left_only"]);
    expect(r.messages).toEqual([]);
  });

  test("G2: x\\sibling.attr on a parameter resolves", async () => {
    const r = await resolve(`
FUNCTION g2(x : right_branch) : STRING;
  RETURN (x\\left_branch.left_only);
END_FUNCTION;
`);
    expect(r.targets).toEqual(["\\left_branch => left_branch", ".left_only => left_branch.left_only"]);
    expect(r.messages).toEqual([]);
  });

  test("G3: after a group reference only the named entity's own declarations count, inherited ones do not", async () => {
    const r = await resolve(`
FUNCTION g3(x : right_leaf) : STRING;
  RETURN (x\\left_branch.id + x\\root.id);
END_FUNCTION;
`);
    expect(r.targets).toEqual(["\\left_branch => left_branch", ".id => UNRESOLVED", "\\root => root", ".id => root.id"]);
    expect(r.messages).toContain("The attribute 'id' could not be found.");
  });

  test("G4: an entity in another component is rejected as a group reference", async () => {
    const r = await resolve(`
FUNCTION g4(x : right_leaf) : STRING;
  RETURN (x\\stranger.shared_name);
END_FUNCTION;
`);
    expect(r.targets[0]).toBe("\\stranger => UNRESOLVED");
    expect(r.messages.length).toBeGreaterThan(0);
  });

  test("G5: a select-typed operand reaches the graph of every member", async () => {
    const r = await resolve(`
FUNCTION g5(x : either) : STRING;
  RETURN (x\\right_branch.right_only + x\\root.id);
END_FUNCTION;
`);
    expect(r.targets).toEqual(["\\right_branch => right_branch", ".right_only => right_branch.right_only", "\\root => root", ".id => root.id"]);
    expect(r.messages).toEqual([]);
  });

  test("G6: a redeclaration names the original through SELF\\E.a", async () => {
    const r = await resolve(`
ENTITY narrow SUBTYPE OF (right_branch);
  SELF\\right_branch.shared_name : LIST [1:1] OF STRING;
END_ENTITY;
`);
    expect(r.targets).toEqual(["\\right_branch => right_branch", ".shared_name => right_branch.shared_name"]);
    expect(r.messages).toEqual([]);
  });

  test("G7: a UNIQUE rule names an inherited attribute through SELF\\E.a", async () => {
    const r = await resolve(`
ENTITY probe_g7 SUBTYPE OF (right_leaf);
UNIQUE
  u : SELF\\right_branch.right_only;
END_ENTITY;
`);
    expect(r.targets).toEqual(["\\right_branch => right_branch", ".right_only => right_branch.right_only"]);
    expect(r.messages).toEqual([]);
  });

  test("G8: completion after SELF\\ offers the whole graph, sibling branch included, other components excluded", async () => {
    await completion({
      text: `SCHEMA probe;${PREAMBLE}
ENTITY probe_g8 SUBTYPE OF (right_leaf);
WHERE
  w : SELF\\<|>;
END_ENTITY;
END_SCHEMA;`,
      index: 0,
      assert: (completions) => expectExactly(completions, ["probe_g8", "right_leaf", "right_branch", "root", "left_branch"]),
    });
  });
});

describe("attribute references reach the entity, its supertypes and its subtypes only (12.7.3)", () => {
  test("P1: an inherited attribute resolves to the supertype's declaration", async () => {
    const r = await resolve(`
FUNCTION p1(x : right_leaf) : STRING;
  RETURN (x.id);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".id => root.id"]);
    expect(r.messages).toEqual([]);
  });

  test("P2: an attribute declared only in a subtype resolves", async () => {
    const r = await resolve(`
FUNCTION p2(x : right_branch) : STRING;
  RETURN (x.leaf_only);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".leaf_only => right_leaf.leaf_only"]);
    expect(r.messages).toEqual([]);
  });

  test("P3: a same-named attribute of the sibling branch is never the target, and a sibling-only attribute is unresolved", async () => {
    const r = await resolve(`
FUNCTION p3(x : right_branch) : STRING;
  RETURN (x.shared_name[1] + x.left_only);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".shared_name => right_branch.shared_name", ".left_only => UNRESOLVED"]);
    expect(r.messages).toEqual(["The attribute 'left_only' could not be found."]);
  });

  test("P4: the binding does not depend on which function is linked first", async () => {
    const left = `FUNCTION p4a(y : left_branch) : STRING; RETURN (y.shared_name); END_FUNCTION;`;
    const right = `FUNCTION p4b(x : right_branch) : STRING; RETURN (x.shared_name[1]); END_FUNCTION;`;
    const leftFirst = await resolve(`${left}\n${right}\n`);
    const rightFirst = await resolve(`${right}\n${left}\n`);
    expect(leftFirst.targets).toEqual([".shared_name => left_branch.shared_name", ".shared_name => right_branch.shared_name"]);
    expect(rightFirst.targets).toEqual([".shared_name => right_branch.shared_name", ".shared_name => left_branch.shared_name"]);
  });

  test("P5: a redeclaration in the operand's own entity wins over the original", async () => {
    const r = await resolve(`
ENTITY narrow SUBTYPE OF (right_branch);
  SELF\\right_branch.shared_name : LIST [1:1] OF STRING;
END_ENTITY;
FUNCTION p5(x : narrow) : STRING;
  RETURN (x.shared_name[1]);
END_FUNCTION;
`);
    expect(r.targets).toEqual(["\\right_branch => right_branch", ".shared_name => right_branch.shared_name", ".shared_name => narrow.shared_name"]);
    expect(r.messages).toEqual([]);
  });

  test("P6: two declarations at the same depth bind the first and are reported as ambiguous; a diamond is not", async () => {
    const r = await resolve(`
ENTITY both SUBTYPE OF (left_branch, right_branch);
END_ENTITY;
FUNCTION p6(x : both) : STRING;
  RETURN (x.shared_name + x.id);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".shared_name => left_branch.shared_name", ".id => root.id"]);
    expect(r.codes.filter((c) => c === "ambiguous-attribute-reference")).toHaveLength(1);
    expect(r.messages.filter((m) => m.includes("could not be found"))).toEqual([]);
  });

  test("P7: a select-typed operand unions the members' 12.7.3 sets in member order", async () => {
    const r = await resolve(`
FUNCTION p7(x : either) : STRING;
  RETURN (x.right_only + x.left_only + x.id + x.shared_name);
END_FUNCTION;
`);
    expect(r.targets).toEqual([
      ".right_only => right_branch.right_only",
      ".left_only => left_branch.left_only",
      ".id => root.id",
      ".shared_name => left_branch.shared_name",
    ]);
    expect(r.codes).not.toContain("ambiguous-attribute-reference");
    expect(r.messages).toEqual([]);
  });

  test("P8: a QUERY variable over an entity-typed aggregate", async () => {
    const r = await resolve(`
ENTITY holder;
  items : SET [0:?] OF right_branch;
WHERE
  w : SIZEOF(QUERY(r <* items | SIZEOF(r.shared_name) = 0)) = 0;
END_ENTITY;
`);
    expect(r.targets).toEqual([".shared_name => right_branch.shared_name"]);
    expect(r.messages).toEqual([]);
  });

  test("P9: a LOCAL variable", async () => {
    const r = await resolve(`
FUNCTION p9 : STRING;
LOCAL
  v : right_branch;
END_LOCAL;
  RETURN (v.shared_name[1]);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".shared_name => right_branch.shared_name"]);
    expect(r.messages).toEqual([]);
  });

  test("P10: an entity interfaced from another schema, by USE FROM and by REFERENCE FROM", async () => {
    const base = `SCHEMA base_s;
ENTITY root; id : STRING; END_ENTITY;
ENTITY left_branch SUBTYPE OF (root); shared_name : STRING; left_only : STRING; END_ENTITY;
ENTITY right_branch SUBTYPE OF (root); shared_name : LIST [1:?] OF STRING; right_only : STRING; END_ENTITY;
END_SCHEMA;`;
    const user = (iface: string) => `SCHEMA user_s;
${iface}
ENTITY right_leaf SUBTYPE OF (right_branch); leaf_only : STRING; END_ENTITY;
FUNCTION p10(x : right_leaf) : STRING;
  RETURN (x.shared_name[1]);
END_FUNCTION;
END_SCHEMA;`;
    expect((await resolveText(`${base}\n${user("USE FROM base_s;")}`)).targets).toEqual([".shared_name => right_branch.shared_name"]);
    expect((await resolveText(`${base}\n${user("REFERENCE FROM base_s (right_branch);")}`)).targets).toEqual([".shared_name => right_branch.shared_name"]);
  });

  test("P11: a cyclic SUBTYPE OF chain terminates and resolves", async () => {
    const r = await resolve(`
ENTITY a SUBTYPE OF (b); END_ENTITY;
ENTITY b SUBTYPE OF (a); x : STRING; END_ENTITY;
FUNCTION p11(p : a) : STRING;
  RETURN (p.x);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".x => b.x"]);
  });

  test("P12: an unresolved supertype does not hide the resolved part of the graph", async () => {
    const r = await resolve(`
ENTITY c SUBTYPE OF (missing); END_ENTITY;
ENTITY d SUBTYPE OF (c); y : STRING; END_ENTITY;
FUNCTION p12(p : c) : STRING;
  RETURN (p.y);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".y => d.y"]);
  });

  test("P13: completion after x. offers the 12.7.3 set and nothing from the sibling branch", async () => {
    await completion({
      text: `SCHEMA probe;${PREAMBLE}
FUNCTION p13(x : right_leaf) : STRING;
  RETURN (x.<|>);
END_FUNCTION;
END_SCHEMA;`,
      index: 0,
      assert: (completions) => expectExactly(completions, ["leaf_only", "shared_name", "right_only", "id"]),
    });
  });

  test("P14: an attribute reference after two index qualifiers resolves against the element type", async () => {
    const r = await resolve(`
ENTITY patch; parent_surface : STRING; END_ENTITY;
ENTITY rcs; segments : LIST [1:?] OF LIST [1:?] OF patch; END_ENTITY;
FUNCTION p14(s : rcs) : STRING;
  RETURN (s.segments[1][1].parent_surface);
END_FUNCTION;
`);
    expect(r.targets).toEqual([".segments => rcs.segments", ".parent_surface => patch.parent_surface"]);
    expect(r.messages).toEqual([]);
  });
});

describe("INVERSE FOR names an explicit attribute of the referencing entity or its supertypes (9.2.1.3)", () => {
  const USERS = `
ENTITY user_of_right; target : right_branch; END_ENTITY;
ENTITY user_sub SUBTYPE OF (user_of_right); END_ENTITY;
ENTITY u_root; END_ENTITY;
ENTITY u_a SUBTYPE OF (u_root); t : right_branch; END_ENTITY;
ENTITY u_b SUBTYPE OF (u_root); END_ENTITY;
ENTITY u_c SUBTYPE OF (u_a); t2 : right_branch; END_ENTITY;
`;

  test("I1: the referencing entity's own explicit attribute", async () => {
    const r = await resolve(`${USERS}
ENTITY probe_i1 SUBTYPE OF (right_branch);
INVERSE
  users : SET [0:?] OF user_of_right FOR target;
END_ENTITY;
`);
    expect(r.targets).toEqual(["FOR target => user_of_right.target"]);
    expect(r.messages).toEqual([]);
  });

  test("I2: an explicit attribute inherited by the referencing entity", async () => {
    const r = await resolve(`${USERS}
ENTITY probe_i2 SUBTYPE OF (right_branch);
INVERSE
  subs : SET [0:?] OF user_sub FOR target;
END_ENTITY;
`);
    expect(r.targets).toEqual(["FOR target => user_of_right.target"]);
    expect(r.messages).toEqual([]);
  });

  test("I3: an attribute of a sibling of the referencing entity is not found", async () => {
    const r = await resolve(`${USERS}
ENTITY probe_i3 SUBTYPE OF (right_branch);
INVERSE
  bad : SET [0:?] OF u_b FOR t;
END_ENTITY;
`);
    expect(r.targets).toEqual(["FOR t => UNRESOLVED"]);
    expect(r.messages).toContain("The attribute 't' could not be found.");
  });

  test("I4: an attribute declared only in a subtype of the referencing entity is not found", async () => {
    const r = await resolve(`${USERS}
ENTITY probe_i4 SUBTYPE OF (right_branch);
INVERSE
  bad2 : SET [0:?] OF u_a FOR t2;
END_ENTITY;
`);
    expect(r.targets).toEqual(["FOR t2 => UNRESOLVED"]);
    expect(r.messages).toContain("The attribute 't2' could not be found.");
  });

  test("I5: FOR E.a names E's own explicit attribute", async () => {
    const r = await resolve(`${USERS}
ENTITY probe_i5 SUBTYPE OF (right_branch);
INVERSE
  named : SET [0:?] OF user_sub FOR user_of_right.target;
END_ENTITY;
`);
    expect(r.targets).toEqual(["FOR user_of_right.target => user_of_right.target"]);
    expect(r.messages).toEqual([]);
  });
});
