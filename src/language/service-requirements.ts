import { DocumentState } from "langium";
import type { ServiceRequirements } from "langium/lsp";

export const EXPRESS_SERVICE_REQUIREMENTS: Partial<ServiceRequirements> = {
  // Quick fixes consume the AST and diagnostics supplied in CodeActionParams.
  // Initial workspace documents intentionally stop at IndexedReferences.
  CodeActionProvider: DocumentState.IndexedReferences,
};
