import {
  AstNode,
  AstUtils,
  DefaultDocumentValidator,
  DiagnosticInfo,
  DocumentValidator,
  LangiumDocument,
  LinkingErrorData,
  ValidationOptions,
  interruptAndCheck,
  isOperationCancelled,
} from "langium";
import type { Diagnostic } from "vscode-languageserver";
import { CancellationToken } from "vscode-languageserver";
import { isQuery_expression } from "./generated/ast.js";

export class ExpressDocumentValidator extends DefaultDocumentValidator {
  override async validateDocument(
    document: LangiumDocument,
    options: ValidationOptions = {},
    cancelToken = CancellationToken.None
  ): Promise<Diagnostic[]> {
    const parseResult = document.parseResult;
    const diagnostics: Diagnostic[] = [];

    await interruptAndCheck(cancelToken);

    if (!options.categories || options.categories.includes("built-in")) {
      this.processLexingErrors(parseResult, diagnostics, options);
      if (options.stopAfterLexingErrors && diagnostics.some((d) => d.data?.code === DocumentValidator.LexingError)) {
        return diagnostics;
      }

      this.processParsingErrors(parseResult, diagnostics, options);
      if (options.stopAfterParsingErrors && diagnostics.some((d) => d.data?.code === DocumentValidator.ParsingError)) {
        return diagnostics;
      }

      this.processLinkingErrors(document, diagnostics, options);
      if (options.stopAfterLinkingErrors && diagnostics.some((d) => d.data?.code === DocumentValidator.LinkingError)) {
        return diagnostics;
      }
    }

    // Process custom validations
    try {
      diagnostics.push(...(await this.validateAst(parseResult.value, options, cancelToken)));
    } catch (err) {
      if (isOperationCancelled(err)) {
        throw err;
      }
      console.error("An error occurred during validation:", err);
    }

    await interruptAndCheck(cancelToken);

    return diagnostics;
  }

  protected override processLinkingErrors(document: LangiumDocument, diagnostics: Diagnostic[], _options: ValidationOptions): void {
    for (const reference of document.references) {
      const linkingError = reference.error;
      if (linkingError) {
        const info: DiagnosticInfo<AstNode, string> = {
          node: linkingError.info.container,
          property: linkingError.info.property,
          index: linkingError.info.index,
          data: {
            code: DocumentValidator.LinkingError,
            containerType: linkingError.info.container.$type,
            property: linkingError.info.property,
            refText: linkingError.info.reference.$refText,
          } satisfies LinkingErrorData,
        };
        diagnostics.push(this.toDiagnostic("error", linkingError.message, info));
        // if (!this.isNestedQuery(linkingError.container)) {
        //   diagnostics.push(this.toDiagnostic("error", linkingError.message, info));
        // } else {
        //   diagnostics.push(this.toDiagnostic("info", "Nested query context is currently not supported", info));
        // }
      }
    }
  }
  protected isNestedQuery(node: AstNode): boolean {
    const firstQuery = AstUtils.getContainerOfType(node, isQuery_expression);
    if (!firstQuery) return false;
    const secondQuery = AstUtils.getContainerOfType(firstQuery, isQuery_expression);
    if (!secondQuery) return false;
    return true;
  }
}
