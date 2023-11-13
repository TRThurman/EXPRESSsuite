import {
  AstNodeDescription,
  CompletionAcceptor,
  CompletionContext,
  CompletionValueItem,
  DefaultCompletionProvider,
  MaybePromise,
  NextFeature,
} from "langium";
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
    nodeDescription: AstNodeDescription
  ): CompletionValueItem {
    let kind: CompletionItemKind;
    let detail: string = "";
    let documentation: string = "";
    let processedNode = {
      type: nodeDescription.type,
      node: nodeDescription.node,
    };
    if (processedNode.type === Resource_or_rename) {
      if (nodeDescription.node)
        processedNode.type =
          (nodeDescription.node as Resource_or_rename).resource.ref?.$type ??
          "";
    }
    switch (processedNode.type) {
      case SchemaDefinition:
        kind = CompletionItemKind.Module;
        detail = "Schema";
        break;
      case EntityDefinition:
        kind = CompletionItemKind.Class;
        detail = "Entity";
        documentation = nodeDescription.node?.$container?.$cstNode?.text ?? "";
        break;
      case TypeDefinition:
        kind = CompletionItemKind.Variable;
        detail = "Type";
        break;
      case Parameter_id:
      case Variable_id:
        kind = CompletionItemKind.Variable;
        detail = "Variable";
        break;
      case FunctionDefinition:
        kind = CompletionItemKind.Function;
        //const returnType = (nodeDescription.node as Function_head).returnType.$cstNode?.text;
        detail = "Function";
        break;
      case Attribute_decl:
      case Attribute_id:
        kind = CompletionItemKind.Property;
        detail = "Attribute";
        break;
      case Constant_body:
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
