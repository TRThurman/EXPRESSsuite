import {
  AstNodeDescription,
  MaybePromise,
} from "langium";
import type { ReferenceInfo } from "langium";
import {
  CompletionAcceptor,
  CompletionContext,
  type CompletionValueItem,
  DefaultCompletionProvider,
  NextFeature,
} from "langium/lsp";
import type { CancellationToken, CompletionList, CompletionParams } from "vscode-languageserver";
import { CompletionItemKind, CompletionTriggerKind } from "vscode-languageserver";
import type { LangiumDocument } from "langium";
import type { CompletionProviderOptions } from "langium/lsp";
import type { ExpressP11Services } from "./express-module.js";
import { DescriptionCompletion } from "./express-p11-description-completion.js";
import {
  Attribute_decl,
  Attribute_id,
  Constant_body,
  EntityDefinition,
  FunctionDefinition,
  Parameter_id,
  Resource_or_rename,
  SchemaDefinition,
  TypeDefinition,
  Variable_id,
} from "./generated/ast.js";

export class ExpressP11CompletionProvider extends DefaultCompletionProvider {
  private readonly described: DescriptionCompletion;

  /** The characters after which a description block offers names: of a key, `"` and `.` and `:`; of a cross-reference, `:` and `.`; of a bold name, `*`. */
  override readonly completionOptions: CompletionProviderOptions = { triggerCharacters: ['"', ".", ":", "*"] };

  constructor(services: ExpressP11Services) {
    super(services);
    this.described = new DescriptionCompletion(services);
  }

  /**
   * In the description blocks after `END_SCHEMA;` the list is that of `DescriptionCompletion`.
   * In EXPRESS it is Langium's, as before: the trigger characters are registered for the
   * description blocks only, so a list they would open in EXPRESS is not given.
   */
  override async getCompletion(document: LangiumDocument, params: CompletionParams, cancelToken?: CancellationToken): Promise<CompletionList | undefined> {
    const typed = params.context?.triggerKind === CompletionTriggerKind.TriggerCharacter;
    const described = this.described.complete(document, document.textDocument.offsetAt(params.position), !typed);
    if (described) return described;
    if (typed) return undefined;
    return super.getCompletion(document, params, cancelToken);
  }

  protected override createReferenceCompletionItem(
    nodeDescription: AstNodeDescription,
    _refInfo: ReferenceInfo,
    _context: CompletionContext
  ): CompletionValueItem {
    let kind: CompletionItemKind;
    let detail: string = "";
    let documentation: string = "";
    const processedNode = {
      type: nodeDescription.type,
      node: nodeDescription.node,
    };
    if (processedNode.type === Resource_or_rename.$type) {
      if (nodeDescription.node)
        processedNode.type =
          (nodeDescription.node as Resource_or_rename).resource.ref?.$type ??
          "";
    }
    switch (processedNode.type) {
      case SchemaDefinition.$type:
        kind = CompletionItemKind.Module;
        detail = "Schema";
        break;
      case EntityDefinition.$type:
        kind = CompletionItemKind.Class;
        detail = "Entity";
        documentation = nodeDescription.node?.$container?.$cstNode?.text ?? "";
        break;
      case TypeDefinition.$type:
        kind = CompletionItemKind.Variable;
        detail = "Type";
        break;
      case Parameter_id.$type:
      case Variable_id.$type:
        kind = CompletionItemKind.Variable;
        detail = "Variable";
        break;
      case FunctionDefinition.$type:
        kind = CompletionItemKind.Function;
        //const returnType = (nodeDescription.node as Function_head).returnType.$cstNode?.text;
        detail = "Function";
        break;
      case Attribute_decl.$type:
      case Attribute_id.$type:
        kind = CompletionItemKind.Property;
        detail = "Attribute";
        break;
      case Constant_body.$type:
        kind = CompletionItemKind.Constant;
        detail = "Constant";
        break;
      default:
        kind = CompletionItemKind.Reference;
        detail = "";
        break;
    }
    return {
      nodeDescription,
      kind,
      detail,
      sortText: "0",
      documentation,
    };
  }

  protected override completionFor(
    context: CompletionContext,
    next: NextFeature,
    acceptor: CompletionAcceptor
  ): MaybePromise<void> {
    // console.log(context);
    return super.completionFor(context, next, acceptor);
  }
}
