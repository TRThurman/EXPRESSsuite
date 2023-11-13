import { AstNode, AstNodeDescription, NodeKindProvider } from "langium";
import { SymbolKind, CompletionItemKind } from "vscode-languageserver";
import { isAttribute_id, isEntityDefinition, isFunctionDefinition, isSchemaDefinition, isTypeDefinition } from "./generated/ast.js";
import { ExpressKind } from "../utils/general.js";

export class ExpressP11NodeKindProvider implements NodeKindProvider {
  getSymbolKind(node: AstNode | AstNodeDescription): SymbolKind {
    if (isSchemaDefinition(node)) {
      return ExpressKind.Namespace;
    }

    if (isFunctionDefinition(node)) {
      return ExpressKind.Function;
    }

    if (isEntityDefinition(node)) {
      return ExpressKind.Entity;
    }

    if (isTypeDefinition(node)) {
      return ExpressKind.Type;
    }

    if (isAttribute_id(node)) {
      return ExpressKind.Property;
    }
    return ExpressKind.Field;
  }
  getCompletionItemKind(): CompletionItemKind {
    return CompletionItemKind.Reference;
  }
}
