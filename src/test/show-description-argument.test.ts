import { URI } from "langium";
import { describe, expect, test } from "vitest";
import { descriptionRequest } from "../extension/show-description-argument.js";

/**
 * Show Description is called three ways: from the command palette with no
 * argument, from a hover or description-panel cross-reference with
 * `{ path, sourceUri? }`, and from the editor's right-click menu, where VS Code
 * passes the editor's file URI. A URI has a `path` too, the file's, which
 * names no declaration: the word at the cursor decides.
 */
describe("the argument Show Description acts on", () => {
  test("the command palette passes nothing", () => {
    expect(descriptionRequest(undefined)).toEqual({});
  });

  test("the right-click menu passes the file URI, which names no declaration", () => {
    const uri = URI.file("/work/demo/demo_widgets.exp");
    expect(uri.path).toBe("/work/demo/demo_widgets.exp");
    expect(descriptionRequest(uri)).toEqual({});
    expect(descriptionRequest(uri.toJSON())).toEqual({});
  });

  test("a hover cross-reference names a tag path", () => {
    expect(descriptionRequest({ path: "demo_widgets.mount" })).toEqual({ path: "demo_widgets.mount" });
  });

  test("a description-panel link also names the panel's file", () => {
    expect(descriptionRequest({ path: "demo_widgets.mount", sourceUri: "file:///work/demo/demo_widgets.exp" })).toEqual({
      path: "demo_widgets.mount",
      sourceUri: "file:///work/demo/demo_widgets.exp",
    });
  });

  test("fields that are not strings, and arguments that are not objects, are ignored", () => {
    expect(descriptionRequest({ path: 42, sourceUri: null })).toEqual({});
    expect(descriptionRequest("demo_widgets.mount")).toEqual({});
    expect(descriptionRequest(null)).toEqual({});
  });
});
