import { AstNode, AstNodeDescription } from "langium";
import { SymbolKind, CompletionItemKind } from "vscode-languageserver";
import {
  isAttribute_id,
  isEntityDefinition,
  isFunctionDefinition,
  isSchemaDefinition,
  isTypeDefinition,
} from "./generated/ast";
import { ExpressKind } from "../utils/general";

export class ExpressP11NodeKindProvider {
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
