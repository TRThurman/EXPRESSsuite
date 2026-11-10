import { describe, expect, test } from "vitest";
import { splitMembers } from "../shared/describe-members.js";

describe("members step of Describe Declaration (R13)", () => {
  test("members with a block are not asked for, in member order, compared without regard to case", () => {
    const existing = ["demo_schema.f", "Demo_Schema.F.B", "demo_schema.f.__note"];
    expect(splitMembers(["demo_schema.f.a", "demo_schema.f.b", "demo_schema.f.c"], existing)).toEqual({
      ask: ["demo_schema.f.a", "demo_schema.f.c"],
      described: ["demo_schema.f.b"],
    });
  });

  test("a role block of a member does not count as its description", () => {
    expect(splitMembers(["demo_schema.f.a"], ["demo_schema.f.a.__note"])).toEqual({ ask: ["demo_schema.f.a"], described: [] });
  });

  test("no members, nothing to ask", () => {
    expect(splitMembers([], ["demo_schema.f"])).toEqual({ ask: [], described: [] });
  });
});
