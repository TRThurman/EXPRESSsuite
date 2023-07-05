import {
  AstNode,
  DefaultDocumentValidator,
  DiagnosticInfo,
  DocumentValidator,
  LangiumDocument,
  LinkingErrorData,
  getContainerOfType,
  interruptAndCheck,
  isOperationCancelled,
  tokenToRange,
} from "langium";
import type { Diagnostic } from "vscode-languageserver";
import type { MismatchedTokenException } from "chevrotain";
import { CancellationToken, DiagnosticSeverity, Position, Range } from "vscode-languageserver";
import { isQuery_expression } from "./language-server/generated/ast";

export class ExpressDocumentValidator extends DefaultDocumentValidator {
  override async validateDocument(
    document: LangiumDocument,
    cancelToken = CancellationToken.None
  ): Promise<Diagnostic[]> {
    const parseResult = document.parseResult;
    const diagnostics: Diagnostic[] = [];

    await interruptAndCheck(cancelToken);

    // Process lexing errors
    for (const lexerError of parseResult.lexerErrors) {
      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Error,
        range: {
          start: {
            line: lexerError.line! - 1,
            character: lexerError.column! - 1,
          },
          end: {
            line: lexerError.line! - 1,
            character: lexerError.column! + lexerError.length - 1,
          },
        },
        message: lexerError.message,
        code: DocumentValidator.LexingError,
        source: this.getSource(),
      };
      diagnostics.push(diagnostic);
    }

    // Process parsing errors
    for (const parserError of parseResult.parserErrors) {
      let range: Range | undefined = undefined;
      // We can run into the chevrotain error recovery here
      // The token contained in the parser error might be automatically inserted
      // In this case every position value will be `NaN`
      if (isNaN(parserError.token.startOffset)) {
        // Some special parser error types contain a `previousToken`
        // We can simply append our diagnostic to that token
        if ("previousToken" in parserError) {
          const token = (parserError as MismatchedTokenException).previousToken;
          if (!isNaN(token.startOffset)) {
            const position = Position.create(token.endLine! - 1, token.endColumn!);
            range = Range.create(position, position);
          } else {
            // No valid prev token. Might be empty document or containing only hidden tokens.
            // Point to document start
            range = Range.create(0, 0, 0, 0);
          }
        }
      } else {
        range = tokenToRange(parserError.token);
      }
      if (range) {
        const diagnostic: Diagnostic = {
          severity: DiagnosticSeverity.Error,
          range,
          message: parserError.message,
          code: DocumentValidator.ParsingError,
          source: this.getSource(),
        };
        diagnostics.push(diagnostic);
      }
    }

    // Process unresolved references
    for (const reference of document.references) {
      const linkingError = reference.error;
      if (linkingError) {
        const data: LinkingErrorData = {
          containerType: linkingError.container.$type,
          property: linkingError.property,
          refText: linkingError.reference.$refText,
        };
        const info: DiagnosticInfo<AstNode, string> = {
          node: linkingError.container,
          property: linkingError.property,
          index: linkingError.index,
          code: DocumentValidator.LinkingError,
          data,
        };
        if (!this.isNestedQuery(linkingError.container))
          diagnostics.push(this.toDiagnostic("error", linkingError.message, info));
        else diagnostics.push(this.toDiagnostic("info", "Nested query context is currently not supported", info));
      }
    }

    // Process custom validations
    try {
      diagnostics.push(...(await this.validateAst(parseResult.value, document, cancelToken)));
    } catch (err) {
      if (isOperationCancelled(err)) {
        throw err;
      }
      console.error("An error occurred during validation:", err);
    }

    await interruptAndCheck(cancelToken);

    return diagnostics;
  }

  protected isNestedQuery(node: AstNode): boolean {
    const firstQuery = getContainerOfType(node, isQuery_expression);
    if (!firstQuery) return false;
    const secondQuery = getContainerOfType(firstQuery, isQuery_expression);
    if (!secondQuery) return false;
    return true;
  }
}
