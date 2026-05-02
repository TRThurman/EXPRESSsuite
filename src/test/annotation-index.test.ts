import { describe, expect, test } from "vitest";
import { AnnotationIndex } from "../extension/annotation-index.js";
import { validateMessage } from "../extension/webview-message.js";

describe("AnnotationIndex", () => {
  test("extracts a single named remark with tag and body", () => {
    const text = `SCHEMA test;
END_SCHEMA;
(*"test.foo.__note"
A foo is a thing.
*)`;
    const idx = new AnnotationIndex(text);
    expect(idx.size()).toBe(1);
    const [a] = idx.byExactTag("test.foo.__note");
    expect(a.tag).toBe("test.foo.__note");
    expect(a.parts).toEqual(["test", "foo", "__note"]);
    expect(a.body).toBe("A foo is a thing.");
  });

  test("byPath returns the bare path and all subtype variants", () => {
    const text = `(*"S.E" base remark *)
(*"S.E.__note" a note *)
(*"S.E.__example" an example *)
(*"S.OTHER" unrelated *)`;
    const idx = new AnnotationIndex(text);
    const all = idx.byPath("S.E");
    expect(all.map((a) => a.tag).sort()).toEqual([
      "S.E",
      "S.E.__example",
      "S.E.__note",
    ]);
  });

  test("byEntityName matches across schemas", () => {
    const text = `(*"schema_a.point" a *)
(*"schema_b.point.__note" b *)
(*"schema_a.line" c *)`;
    const idx = new AnnotationIndex(text);
    const m = idx.byEntityName("point");
    expect(m).toHaveLength(2);
    expect(m.map((a) => a.parts[0]).sort()).toEqual(["schema_a", "schema_b"]);
  });

  test("handles attribute-level paths (3+ parts) without confusing with subtypes", () => {
    const text = `(*"s.e.attr.__note" attribute remark *)
(*"s.e" entity remark *)`;
    const idx = new AnnotationIndex(text);
    const e = idx.byPath("s.e");
    // s.e bare + s.e.attr.__note (starts with s.e.__? — no, attr is not __ prefixed)
    expect(e.map((a) => a.tag).sort()).toEqual(["s.e"]);
  });

  test("preserves source order in allAnnotations()", () => {
    const text = `(*"a" 1 *) something else (*"b" 2 *)`;
    const idx = new AnnotationIndex(text);
    expect(idx.allAnnotations().map((a) => a.tag)).toEqual(["a", "b"]);
  });

  test("trims leading/trailing whitespace from body", () => {
    const text = `(*"x"

    body line

  *)`;
    const idx = new AnnotationIndex(text);
    expect(idx.byExactTag("x")[0].body).toBe("body line");
  });

  test("multiple remarks with the same tag are all retained", () => {
    const text = `(*"t.__note" first *)
(*"t.__note" second *)`;
    const idx = new AnnotationIndex(text);
    expect(idx.byExactTag("t.__note")).toHaveLength(2);
  });
});

describe("validateMessage", () => {
  test("accepts navigate with valid identifier", () => {
    expect(validateMessage({ kind: "navigate", targetName: "schema.entity" })).toEqual({
      kind: "navigate",
      targetName: "schema.entity",
    });
  });

  test("rejects navigate with non-identifier targetName", () => {
    expect(validateMessage({ kind: "navigate", targetName: "../etc/passwd" })).toBeNull();
    expect(validateMessage({ kind: "navigate", targetName: "" })).toBeNull();
    expect(validateMessage({ kind: "navigate", targetName: "javascript:alert" })).toBeNull();
  });

  test("rejects insert exceeding 4096 chars", () => {
    expect(validateMessage({ kind: "insert", text: "x".repeat(4097) })).toBeNull();
    expect(validateMessage({ kind: "insert", text: "x".repeat(4096) })).not.toBeNull();
  });

  test("rejects unknown kinds", () => {
    expect(validateMessage({ kind: "exec", payload: "rm -rf /" })).toBeNull();
    expect(validateMessage({})).toBeNull();
    expect(validateMessage(null)).toBeNull();
    expect(validateMessage("string")).toBeNull();
  });

  test("normalises log level to 'info' if invalid", () => {
    const m = validateMessage({ kind: "log", level: "FATAL", message: "x" });
    expect(m).toEqual({ kind: "log", level: "info", message: "x" });
  });

  test("rejects log message exceeding 1024 chars", () => {
    expect(validateMessage({ kind: "log", level: "info", message: "x".repeat(1025) })).toBeNull();
  });

  test("accepts renderMath with valid id and expr", () => {
    expect(validateMessage({ kind: "renderMath", id: 1, expr: "x^2" })).toEqual({
      kind: "renderMath",
      id: 1,
      expr: "x^2",
    });
  });

  test("rejects renderMath with non-integer id", () => {
    expect(validateMessage({ kind: "renderMath", id: "1", expr: "x^2" })).toBeNull();
    expect(validateMessage({ kind: "renderMath", id: 1.5, expr: "x^2" })).toBeNull();
    expect(validateMessage({ kind: "renderMath", id: -1, expr: "x^2" })).toBeNull();
    expect(validateMessage({ kind: "renderMath", id: NaN, expr: "x^2" })).toBeNull();
  });

  test("rejects renderMath with empty or oversized expr", () => {
    expect(validateMessage({ kind: "renderMath", id: 1, expr: "" })).toBeNull();
    expect(validateMessage({ kind: "renderMath", id: 1, expr: "x".repeat(16385) })).toBeNull();
    expect(validateMessage({ kind: "renderMath", id: 1, expr: "x".repeat(16384) })).not.toBeNull();
  });
});
