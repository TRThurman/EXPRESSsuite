import { DocumentState } from "langium";
import { describe, expect, test } from "vitest";
import { EXPRESS_SERVICE_REQUIREMENTS } from "../language/service-requirements.js";

describe("language service readiness", () => {
  test("allows code actions for initially indexed workspace documents", () => {
    expect(EXPRESS_SERVICE_REQUIREMENTS.CodeActionProvider)
      .toBe(DocumentState.IndexedReferences);
  });
});
