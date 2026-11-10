/* The argument Show Description acts on.
 * No vscode imports — pure logic, unit-testable.
 */

/** What a cross-reference asks Show Description for: a tag path, and the file of the description panel it was clicked in. */
export interface DescriptionRequest {
  path?: string;
  sourceUri?: string;
}

/**
 * A hover or description-panel cross-reference passes `{ path, sourceUri? }`.
 * The command palette passes nothing, and the editor's right-click menu passes
 * the editor's file URI, whose `path` is the file's and names no declaration;
 * for both, the word at the cursor decides, so they yield no request.
 */
export function descriptionRequest(arg: unknown): DescriptionRequest {
  if (!arg || typeof arg !== "object") return {};
  const a = arg as Record<string, unknown>;
  if (typeof a.scheme === "string") return {};
  const request: DescriptionRequest = {};
  if (typeof a.path === "string") request.path = a.path;
  if (typeof a.sourceUri === "string") request.sourceUri = a.sourceUri;
  return request;
}
