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
import { CompletionItemKind } from "vscode-languageserver";
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
