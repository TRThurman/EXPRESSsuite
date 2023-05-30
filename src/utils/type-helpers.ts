import { DocumentSymbol } from "vscode-languageserver";
import { Schema_decl, Type_decl, isType_decl } from "../language-server/generated/ast";
import { ExpressKind, getDocumentSymbol } from "./general";

export const getTypesDocumentSymbol = (schema: Schema_decl): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];
  var typeDeclarations = getTypeDeclarations(schema);
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

export const getTypeDeclarations = (schema: Schema_decl): Type_decl[] | undefined => {
  if (!schema) return;

  var typeDeclarations = schema.body.declarations.filter((d) => isType_decl(d)) as Type_decl[];
  return typeDeclarations.filter((t) => t.name);
};

export const getTypeDocumentSymbol = (type: Type_decl): DocumentSymbol | undefined => {
  if (type && type.$cstNode && type.name) {
    const typeSymbol = getDocumentSymbol(ExpressKind.Type, type.name, type.$cstNode.range, type.$cstNode.range);
    return typeSymbol;
  }
  return;
};
