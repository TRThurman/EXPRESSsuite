import { AstNodeDescription, CompletionValueItem, DefaultCompletionProvider } from "langium";
import { CompletionItemKind } from "vscode-languageserver";
import {
  Attribute_decl,
  Attribute_id,
  Constant_body,
  Entity_head,
  Parameter_id,
  Resource_or_rename,
  Schema_decl,
  Type_decl,
  Variable_id,
} from "./generated/ast";
import { Function_head } from "./generated/ast";

export class ExpressP11CompletionProvider extends DefaultCompletionProvider {
  protected override createReferenceCompletionItem(nodeDescription: AstNodeDescription): CompletionValueItem {
    let kind: CompletionItemKind;
    let detail: string = "";
    let documentation: string = "";
    let processedNode = { type: nodeDescription.type, node: nodeDescription.node };
    if (processedNode.type === Resource_or_rename) {
      if (nodeDescription.node)
        processedNode.type = (nodeDescription.node as Resource_or_rename).resource.ref?.$type ?? "";
    }
    switch (processedNode.type) {
      case Schema_decl:
        kind = CompletionItemKind.Module;
        detail = "Schema";
        break;
      case Entity_head:
        kind = CompletionItemKind.Class;
        detail = "Entity";
        documentation = nodeDescription.node?.$container?.$cstNode?.text ?? "";
        break;
      case Type_decl:
        kind = CompletionItemKind.Variable;
        detail = "Type";
        break;
      case Parameter_id:
      case Variable_id:
        kind = CompletionItemKind.Variable;
        detail = "Variable";
        break;
      case Function_head:
        kind = CompletionItemKind.Function;
        const returnType = (nodeDescription.node as Function_head).returnType.$cstNode?.text;
        detail = `(fct) -> ${returnType}`;
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
}
