import type { AstNode, CstNode, LangiumDocument, LangiumDocuments, MaybePromise } from "langium";
import { AstUtils, GrammarUtils } from "langium";
import { DefaultDefinitionProvider } from "langium/lsp";
import type { CancellationToken, DefinitionParams, Range } from "vscode-languageserver";
import { LocationLink } from "vscode-languageserver";
import { annotationContexts } from "./annotation/blocks.js";
import { DescriptionTargets, descriptionReferenceAt } from "./annotation/definition.js";
import type { DescriptionReference, DescriptionTarget } from "./annotation/definition.js";
import { LinkResolver } from "./annotation/link-resolver.js";
import type { ExpressP11Services } from "./express-module.js";
import type { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { isDomain_rule, isExpressFile, isRule_decl, isSchemaDefinition, isUnique_rule } from "./generated/ast.js";
import type { ExpressFile } from "./generated/ast.js";

/**
 * Go to Definition. In the EXPRESS of a schema it is Langium's: the declaration a reference is
 * bound to. In a description block after `END_SCHEMA;`, which the grammar reads as a remark, it
 * goes from the block's key, from an `<<express:...>>` cross-reference and from a name in the
 * text to the declaration named (`annotation/definition.ts`).
 */
export class ExpressP11DefinitionProvider extends DefaultDefinitionProvider {
  private readonly typeContainer: ExpressP11TypeContainer;
  private readonly documents: LangiumDocuments;

  constructor(services: ExpressP11Services) {
    super(services);
    this.typeContainer = services.validation.TypeContainer;
    this.documents = services.shared.workspace.LangiumDocuments;
  }

  override getDefinition(document: LangiumDocument, params: DefinitionParams, cancelToken?: CancellationToken): MaybePromise<LocationLink[] | undefined> {
    return this.fromDescription(document, params) ?? super.getDefinition(document, params, cancelToken);
  }

  /** The definitions for a position in a description block; `undefined` when the position is in none. */
  private fromDescription(document: LangiumDocument, params: DefinitionParams): LocationLink[] | undefined {
    const found = this.descriptionTargets(document, document.textDocument.offsetAt(params.position));
    if (!found) return undefined;
    const origin: Range = {
      start: document.textDocument.positionAt(found.reference.start),
      end: document.textDocument.positionAt(found.reference.end),
    };
    const links: LocationLink[] = [];
    for (const target of found.targets) {
      const link = this.linkTo(target, origin);
      if (link && !links.some((known) => known.targetUri === link.targetUri && sameRange(known.targetSelectionRange, link.targetSelectionRange))) {
        links.push(link);
      }
    }
    return links;
  }

  /** What the text at `offset` names and the declarations found for it; `undefined` outside a description block. */
  descriptionTargets(document: LangiumDocument, offset: number): { reference: DescriptionReference; targets: DescriptionTarget[] } | undefined {
    const root = document.parseResult.value;
    if (!isExpressFile(root) || !root.schemas?.length) return undefined;
    // Before the end of the first schema there is no description context.
    const firstEnd = root.schemas[0].$cstNode?.end;
    if (firstEnd === undefined || offset < firstEnd) return undefined;
    const text = document.textDocument.getText();
    const reference = descriptionReferenceAt(annotationContexts(root, text), text, offset);
    if (!reference) return undefined;
    const schema = root.schemas.find((candidate) => candidate.name === reference.block.schema);
    const targets = new DescriptionTargets(
      { rootsOf: (name) => this.rootsOf(name, document) },
      new LinkResolver(this.typeContainer.getScopeIndex(), this.nameProvider),
      this.nameProvider,
    ).find(reference, schema);
    return { reference, targets };
  }

  /**
   * The declarations that the key of a description block names, for a caller that holds a key and
   * no position: the Show Description panel. `from` is the file that holds the block, read first.
   */
  declarationsOfKey(key: string, from?: LangiumDocument): LocationLink[] {
    const targets = new DescriptionTargets(
      { rootsOf: (name) => this.rootsOf(name, from) },
      new LinkResolver(this.typeContainer.getScopeIndex(), this.nameProvider),
      this.nameProvider,
    ).ofPath(key);
    const origin: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    const links: LocationLink[] = [];
    for (const target of targets) {
      const link = this.linkTo(target, origin);
      if (link && !links.some((known) => known.targetUri === link.targetUri && sameRange(known.targetSelectionRange, link.targetSelectionRange))) {
        links.push(link);
      }
    }
    return links;
  }

  /** The files that declare a schema of this name; the file of the request first. */
  private rootsOf(name: string, current?: LangiumDocument): Array<{ root: ExpressFile; text: string }> {
    const lower = name.toLowerCase();
    const found: Array<{ root: ExpressFile; text: string }> = [];
    const consider = (candidate: LangiumDocument): void => {
      const root = candidate.parseResult?.value;
      if (!isExpressFile(root)) return;
      if ((root.schemas ?? []).some((schema) => schema.name?.toLowerCase() === lower)) {
        found.push({ root, text: candidate.textDocument.getText() });
      }
    };
    if (current) consider(current);
    for (const candidate of this.documents.all) {
      if (candidate !== current) consider(candidate);
    }
    return found;
  }

  private linkTo(target: DescriptionTarget, origin: Range): LocationLink | undefined {
    const node = target.kind === "node" ? target.node : target.owner;
    const cst = node.$cstNode;
    if (!cst) return undefined;
    const document = AstUtils.getDocument(node);
    const uri = document.textDocument.uri;
    if (target.kind === "text") {
      const line: Range = {
        start: document.textDocument.positionAt(target.start),
        end: document.textDocument.positionAt(target.end),
      };
      return LocationLink.create(uri, line, line, origin);
    }
    const name = this.nameNodeOf(node) ?? cst;
    return LocationLink.create(uri, cst.range, name.range, origin);
  }

  /** The node of the name of a keyed declaration, where Go to Definition puts the cursor. */
  private nameNodeOf(node: AstNode): CstNode | undefined {
    if (isSchemaDefinition(node)) return GrammarUtils.findNodeForProperty(node.$cstNode, "name");
    if (isRule_decl(node)) return GrammarUtils.findNodeForProperty(node.ruleHead?.$cstNode, "name");
    if (isDomain_rule(node)) return GrammarUtils.findNodeForProperty(node.$cstNode, "id");
    if (isUnique_rule(node)) return GrammarUtils.findNodeForProperty(node.$cstNode, "name");
    return this.nameProvider.getNameNode(node);
  }
}

function sameRange(left: Range, right: Range): boolean {
  return left.start.line === right.start.line && left.start.character === right.start.character && left.end.line === right.end.line && left.end.character === right.end.character;
}
