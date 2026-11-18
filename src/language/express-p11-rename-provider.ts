import type { LangiumDocument } from "langium";
import { DefaultRenameProvider } from "langium/lsp";
import type { CancellationToken, Range, RenameParams, TextDocumentPositionParams, WorkspaceEdit } from "vscode-languageserver";
import { ResponseError, TextEdit } from "vscode-languageserver";
import { ErrorCodes } from "vscode-languageserver";
import type { ExpressP11Services } from "./express-module.js";
import { DescriptionReferences } from "./express-p11-description-references.js";

/** An EXPRESS simple identifier (ISO 10303-11:2004, 7.4): a letter, then letters, digits and underscores. */
const SIMPLE_ID = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Rename. To Langium's edits in EXPRESS it adds the description blocks after `END_SCHEMA;`: the
 * part of each key and of each `<<express:...>>` target that names the declaration, in every
 * loaded file, and the display text of a cross-reference when it is exactly the old name. The
 * name written in the text of a block is left to the author. Rename also starts from a key or
 * from the target of a cross-reference.
 */
export class ExpressP11RenameProvider extends DefaultRenameProvider {
  private readonly described: DescriptionReferences;

  constructor(services: ExpressP11Services) {
    super(services);
    this.described = new DescriptionReferences(services);
  }

  override async rename(document: LangiumDocument, params: RenameParams, cancelToken?: CancellationToken): Promise<WorkspaceEdit | undefined> {
    if (!SIMPLE_ID.test(params.newName)) {
      throw new ResponseError(ErrorCodes.InvalidParams, `"${params.newName}" is not an EXPRESS identifier: a letter, then letters, digits and underscores.`);
    }
    const subject = this.described.subjectAt(document, document.textDocument.offsetAt(params.position));
    if (!subject) return super.rename(document, params, cancelToken);
    if (!subject.range) return undefined;

    const changes: Record<string, TextEdit[]> = {};
    const replace = (uri: string, range: Range): void => {
      (changes[uri] ??= []).push(TextEdit.replace(range, params.newName));
    };
    for (const location of this.described.inExpress(subject.nodes, true)) replace(location.uri, location.range);
    for (const location of this.described.inDescriptions(subject.nodes, subject.name)) {
      if (location.kind === "key" || location.kind === "link") replace(location.uri, location.range);
      else if (location.kind === "display" && location.text === subject.name) replace(location.uri, location.range);
    }
    return { changes };
  }

  override prepareRename(document: LangiumDocument, params: TextDocumentPositionParams, cancelToken?: CancellationToken): Range | undefined {
    const subject = this.described.subjectAt(document, document.textDocument.offsetAt(params.position));
    if (!subject) return super.prepareRename(document, params, cancelToken) as Range | undefined;
    return subject.range;
  }
}
