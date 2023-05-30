import { DocumentSymbol } from "vscode-languageserver";
import { Constant_body, Schema_decl } from "../language-server/generated/ast";
import { schemaHasConstants } from "./schema-helpers";
import { ExpressKind, getDocumentSymbol } from "./general";

export const getConstantDocumentSymbols = (schema: Schema_decl): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];
  var constantDeclarations = getConstantDeclarations(schema);
  if (constantDeclarations) {
    constantDeclarations.forEach((t) => {
      const symbol = getConstantDocumentSymbol(t);
      if (symbol) {
        symbols.push(symbol);
      }
    });
  }
  return symbols;
};

export const getConstantDeclarations = (schema: Schema_decl): Constant_body[] | undefined => {
  if (!schemaHasConstants(schema)) return;

  var constantDeclarations = schema.body.constant?.items;
  return constantDeclarations?.filter((c) => c.name);
};

export const getConstantDocumentSymbol = (constant: Constant_body): DocumentSymbol | undefined => {
  if (constant && constant.$cstNode && constant.name) {
    const typeSymbol = getDocumentSymbol(
      ExpressKind.Constant,
      constant.name,
      constant.$cstNode.range,
      constant.$cstNode.range
    );
    return typeSymbol;
  }
  return;
};
