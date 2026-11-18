import type { LangiumDocument } from "langium";
import { DefaultReferencesProvider } from "langium/lsp";
import type { CancellationToken, ReferenceParams } from "vscode-languageserver";
import { Location } from "vscode-languageserver";
import type { ExpressP11Services } from "./express-module.js";
import { DescriptionReferences } from "./express-p11-description-references.js";

/**
 * Find All References. To Langium's references in EXPRESS it adds the description blocks after
 * `END_SCHEMA;`: the keys of the blocks that describe the declaration, the `<<express:...>>`
 * cross-references to it and its name written in the text of a block. It also starts from any of
 * those places.
 */
export class ExpressP11ReferencesProvider extends DefaultReferencesProvider {
  private readonly described: DescriptionReferences;

  constructor(services: ExpressP11Services) {
    super(services);
    this.described = new DescriptionReferences(services);
  }

  override findReferences(document: LangiumDocument, params: ReferenceParams, cancelToken?: CancellationToken): Location[] {
    const subject = this.described.subjectAt(document, document.textDocument.offsetAt(params.position));
    if (!subject) return super.findReferences(document, params, cancelToken) as Location[];
    if (subject.nodes.length === 0) return [];
    return [
      ...this.described.inExpress(subject.nodes, params.context.includeDeclaration),
      // The display text of a cross-reference is not listed beside its target.
      ...this.described.inDescriptions(subject.nodes, subject.name).filter((location) => location.kind !== "display"),
    ].map((location) => Location.create(location.uri, location.range));
  }
}
