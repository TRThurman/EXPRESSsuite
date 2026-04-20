import { DocumentSymbol } from "vscode-languageserver";
import { SchemaDefinition, TypeDefinition, isTypeDefinition } from "../language/generated/ast.js";
import { ExpressKind, getDocumentSymbol } from "./general.js";

export const getTypesDocumentSymbol = (schema: SchemaDefinition): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];
  const typeDeclarations = getTypeDeclarations(schema);
  if (typeDeclarations) {
    typeDeclarations.forEach((t) => {
      const symbol = getTypeDocumentSymbol(t);
      if (symbol) {
        symbols.push(symbol);
      }
    });
  }
  return symbols;
};

export const getTypeDeclarations = (schema: SchemaDefinition): TypeDefinition[] | undefined => {
  if (!schema) return;

  const typeDeclarations = schema.body.declarations.filter((d) => isTypeDefinition(d)) as TypeDefinition[];
  return typeDeclarations.filter((t) => t.name);
};

export const getTypeDocumentSymbol = (type: TypeDefinition): DocumentSymbol | undefined => {
  if (type && type.$cstNode && type.name) {
    const typeSymbol = getDocumentSymbol(ExpressKind.Type, type.name, type.$cstNode.range, type.$cstNode.range);
    return typeSymbol;
  }
  return;
};
