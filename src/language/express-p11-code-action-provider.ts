import { CodeActionProvider, LangiumDocument, MaybePromise } from "langium";
import {
  CancellationToken,
  CodeActionKind,
  Diagnostic,
  Position,
} from "vscode-languageserver";
import { CodeActionParams } from "vscode-languageserver-protocol";
import { CodeAction, Command } from "vscode-languageserver-types";
import {
  ExpressP11Issues,
  ReferenceStatementData,
  WrongReferenceLabelData,
} from "./express-p11-validator.js";
import { ExpressFile } from "./generated/ast.js";
import { getReferenceSpecifications } from "../utils/interface-helpers.js";
import { getSchemaDeclarations } from "../utils/schema-helpers.js";

export class ExpressP11CodeActionProvider implements CodeActionProvider {
  getCodeActions(
    document: LangiumDocument<ExpressFile>,
    params: CodeActionParams,
    cancelToken?: CancellationToken | undefined
  ): MaybePromise<(Command | CodeAction)[] | undefined> {
    const result: CodeAction[] = [];
    for (const diagnostic of params.context.diagnostics) {
      const codeAction = this.createCodeAction(diagnostic, document);
      if (codeAction) {
        result.push(codeAction);
      }
    }
    return result;
  }

  private createCodeAction(
    diagnostic: Diagnostic,
    document: LangiumDocument<ExpressFile>
  ): CodeAction | undefined {
    switch (diagnostic.code) {
      case ExpressP11Issues.WrongReferenceLabel:
        return this.fixWrongReferenceLabel(diagnostic, document);
      case ExpressP11Issues.ReferenceStatementIncomplete:
        return this.fixReferenceStatementIncomplete(diagnostic, document);
      case ExpressP11Issues.ReferenceStatementMissing:
        return this.fixReferenceStatementMissing(diagnostic, document);
    }
    return undefined;
  }

  private fixWrongReferenceLabel(
    diagnostic: Diagnostic,
    document: LangiumDocument<ExpressFile>
  ): CodeAction | undefined {
    const data = diagnostic.data as WrongReferenceLabelData;
    if (data) {
      return {
        title: `Replace with ${data.expectedReference}`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [document.textDocument.uri]: [
              {
                range: diagnostic.range,
                newText: data.expectedReference,
              },
            ],
          },
        },
      };
    }
    return undefined;
  }

  //@ts-ignore
  private fixReferenceStatementMissing(
    diagnostic: Diagnostic,
    document: LangiumDocument<ExpressFile>
  ): CodeAction | undefined {
    const data = diagnostic.data as ReferenceStatementData;
    if (data) {
      const schema = getSchemaDeclarations(document).find(
        (s) => s.name === data.sourceSchema
      );
      if (!schema) return;
      const referenceClauses = getReferenceSpecifications(schema);

      let position: Position;
      if (referenceClauses.length > 0) {
        position = referenceClauses[0].$cstNode!.range.start;
      } else {
        position = schema.body.$cstNode!.range.start;
      }

      return {
        title: `Add a reference from ${data.schema} for ${data.resource}`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [document.textDocument.uri]: [
              {
                range: {
                  start: position,
                  end: position,
                },
                newText: `REFERENCE FROM ${data.schema} (${data.resource});\n`,
              },
            ],
          },
        },
      };
    }
    return;
  }
  private fixReferenceStatementIncomplete(
    diagnostic: Diagnostic,
    document: LangiumDocument<ExpressFile>
  ): CodeAction | undefined {
    const data = diagnostic.data as ReferenceStatementData;
    if (data) {
      const schema = getSchemaDeclarations(document).find(
        (s) => s.name === data.sourceSchema
      );
      if (!schema) return;
      const referenceClauses = getReferenceSpecifications(schema);

      const referenceClauseToUpdate = referenceClauses.find(
        (reference) => reference.schema.$refText === data.schema
      );
      if (!referenceClauseToUpdate) return;
      let position: Position;
      if (referenceClauseToUpdate.resources.length < 1) return;
      position = referenceClauseToUpdate.resources[0].$cstNode!.range.start;
      return {
        title: `Add ${data.resource} to the list of resources imported.`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [document.textDocument.uri]: [
              {
                range: {
                  start: position,
                  end: position,
                },
                newText: `${data.resource}, `,
              },
            ],
          },
        },
      };
    }
    return;
  }
}
