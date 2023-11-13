import { DocumentSymbol } from "vscode-languageserver";
import { Constant_body, SchemaDefinition } from "../language/generated/ast.js";
import { schemaHasConstants } from "./schema-helpers.js";
import { ExpressKind, getDocumentSymbol } from "./general.js";

export const getConstantDocumentSymbols = (schema: SchemaDefinition): DocumentSymbol[] => {
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

export const getConstantDeclarations = (schema: SchemaDefinition): Constant_body[] | undefined => {
  if (!schemaHasConstants(schema)) return;

  var constantDeclarations = schema.body.constant?.items;
  return constantDeclarations?.filter((c) => c.name);
};

export const getConstantDocumentSymbol = (constant: Constant_body): DocumentSymbol | undefined => {
  if (constant && constant.$cstNode && constant.name) {
    const typeSymbol = getDocumentSymbol(ExpressKind.Constant, constant.name, constant.$cstNode.range, constant.$cstNode.range);
    return typeSymbol;
  }
  return;
};
