import { describe, expect, test } from "vitest";
import { expressTagFromHref } from "../shared/express-xref.js";
import { validateMessage } from "../extension/webview-message.js";

/**
 * Asciidoctor renders `<<express:tag,label>>` in a description as
 * `<a href="#express:tag">label</a>`; the description webview turns a click
 * on such an anchor into a `navigate` message carrying the tag, which the
 * host validates and hands to Show Description.
 */
describe("express cross-reference anchors in the description webview", () => {
  test("the tag path behind an express anchor", () => {
    expect(expressTagFromHref("#express:annotated_3d_model_equivalence_criteria_schema.a3m_equivalence_criterion"))
      .toBe("annotated_3d_model_equivalence_criteria_schema.a3m_equivalence_criterion");
    expect(expressTagFromHref("#express:geometry_schema.point")).toBe("geometry_schema.point");
    expect(expressTagFromHref("#express:%67eometry_schema.point")).toBe("geometry_schema.point");
  });

  test("every other href is left to the browser", () => {
    expect(expressTagFromHref("#top")).toBeUndefined();
    expect(expressTagFromHref("https://www.iso.org/standard/38047.html")).toBeUndefined();
    expect(expressTagFromHref("express:geometry_schema.point")).toBeUndefined();
    expect(expressTagFromHref("#express:")).toBeUndefined();
    expect(expressTagFromHref("#express:%E0%A4%A")).toBeUndefined();
    expect(expressTagFromHref(null)).toBeUndefined();
  });

  test("the resulting navigate message passes the host validator, and a crafted one does not", () => {
    const tag = expressTagFromHref("#express:geometry_schema.point");
    expect(validateMessage({ kind: "navigate", targetName: tag })).toEqual({ kind: "navigate", targetName: "geometry_schema.point" });
    expect(validateMessage({ kind: "navigate", targetName: expressTagFromHref("#express:../../etc/passwd") })).toBeNull();
    expect(validateMessage({ kind: "navigate", targetName: expressTagFromHref("#express:a%20b") })).toBeNull();
  });
});
