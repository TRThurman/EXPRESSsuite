import { LangiumDocument, MaybePromise } from "langium";
import type { CodeActionProvider } from "langium/lsp";
import {
  CancellationToken,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Command,
  Position,
} from "vscode-languageserver";
import {
  DeclarationNameCaseData,
  ExpressP11Issues,
  ExtensionMissingGenericEntityData,
  GenericEntityWithoutExtensibleData,
  ReferenceStatementData,
  ReferenceNameCaseData,
  WrongReferenceLabelData,
} from "./express-p11-validator.js";
import { ExpressFile } from "./generated/ast.js";
import { getReferenceSpecifications } from "../utils/interface-helpers.js";
import { getSchemaDeclarations } from "../utils/schema-helpers.js";

type Diagnostic = NonNullable<LangiumDocument["diagnostics"]>[number];

export class ExpressP11CodeActionProvider implements CodeActionProvider {
  getCodeActions(
    document: LangiumDocument<ExpressFile>,
    params: CodeActionParams,
    _cancelToken?: CancellationToken | undefined
  ): MaybePromise<(Command | CodeAction)[] | undefined> {
    const result: CodeAction[] = [];
    for (const diagnostic of params.context.diagnostics) {
      if (diagnostic.code === ExpressP11Issues.GenericEntityWithoutExtensible) {
        result.push(...this.fixGenericEntityWithoutExtensible(diagnostic, document));
        continue;
      }
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
      case ExpressP11Issues.DeclarationNameCase:
        return this.fixDeclarationNameCase(diagnostic, document);
      case ExpressP11Issues.ReferenceNameCase:
        return this.fixReferenceNameCase(diagnostic, document);
      case ExpressP11Issues.ExtensionMissingGenericEntity:
        return this.fixExtensionMissingGenericEntity(diagnostic, document);
    }
    return this.fixAnnotation(diagnostic, document);
  }

  /** The correction that an annotation diagnostic carries in its data (`annotation-continuation-without-list`, `annotation-glued-continuation`). */
  private fixAnnotation(diagnostic: Diagnostic, document: LangiumDocument<ExpressFile>): CodeAction | undefined {
    const fix = (diagnostic.data as { fix?: { title: string; newText: string; range: Diagnostic["range"] } } | undefined)?.fix;
    if (typeof diagnostic.code !== "string" || !diagnostic.code.startsWith("annotation-") || !fix) return undefined;
    const eol = document.textDocument.getText().includes("\r\n") ? "\r\n" : "\n";
    return {
      title: fix.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { changes: { [document.textDocument.uri]: [{ range: fix.range, newText: fix.newText.replace(/\n/g, eol) }] } },
    };
  }

  /** GENERIC_ENTITY without EXTENSIBLE (8.4.2): add EXTENSIBLE, or, on an extension of a select that is not GENERIC_ENTITY, drop GENERIC_ENTITY. */
  private fixGenericEntityWithoutExtensible(diagnostic: Diagnostic, document: LangiumDocument<ExpressFile>): CodeAction[] {
    const fixes = (diagnostic.data as GenericEntityWithoutExtensibleData | undefined)?.fixes ?? [];
    return fixes.map((fix) => ({
      title: fix.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { changes: { [document.textDocument.uri]: [{ range: fix.range, newText: fix.newText }] } },
    }));
  }

  /** Make an extension of a GENERIC_ENTITY select EXTENSIBLE GENERIC_ENTITY (8.4.2, ruling 2026-11-26). */
  private fixExtensionMissingGenericEntity(diagnostic: Diagnostic, document: LangiumDocument<ExpressFile>): CodeAction | undefined {
    const fix = (diagnostic.data as ExtensionMissingGenericEntityData | undefined)?.fix;
    if (!fix) return undefined;
    return {
      title: fix.title,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { changes: { [document.textDocument.uri]: [{ range: fix.range, newText: fix.newText }] } },
    };
  }

  /** XS-PUB-004: respell a reference as the declaration it binds to, or a schema name by the WG 12 convention. */
  private fixReferenceNameCase(diagnostic: Diagnostic, document: LangiumDocument<ExpressFile>): CodeAction | undefined {
    const data = diagnostic.data as ReferenceNameCaseData;
    if (!data?.expectedName) return undefined;
    return {
      title: `Respell as ${data.expectedName}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { changes: { [document.textDocument.uri]: [{ range: diagnostic.range, newText: data.expectedName }] } },
    };
  }

  private fixDeclarationNameCase(
    diagnostic: Diagnostic,
    document: LangiumDocument<ExpressFile>
  ): CodeAction | undefined {
    const data = diagnostic.data as DeclarationNameCaseData;
    if (!data?.expectedName) return undefined;
    return {
      title: `Rename to ${data.expectedName}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: {
        changes: {
          [document.textDocument.uri]: [{
            range: diagnostic.range,
            newText: data.expectedName,
          }],
        },
      },
    };
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

      const position: Position = referenceClauses.length > 0
        ? referenceClauses[0].$cstNode!.range.start
        : schema.body.$cstNode!.range.start;

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
      if (referenceClauseToUpdate.resources.length < 1) return;
      const position: Position = referenceClauseToUpdate.resources[0].$cstNode!.range.start;
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
