import { DocumentSymbol } from "vscode-languageserver";
import { ExpressFile, Schema_decl } from "../language-server/generated/ast";
import { getEntitiesDocumentSymbol } from "./entity-helpers";
import { getTypesDocumentSymbol } from "./type-helpers";
import { getFunctionDocumentSymbols } from "./function-helpers";
import { ExpressKind } from "./general";
import { getProcedureDocumentSymbols } from "./procedure-helpers";
import { getConstantDocumentSymbols } from "./constant-helpers";
import { LangiumDocument } from "langium";

export const schemaHasBody = (schema: Schema_decl): boolean => {
  if (!schema) return false;
  if (!schema.body) return false;
  return true;
};

export const schemaHasDeclarations = (schema: Schema_decl): boolean => {
  if (!schemaHasBody(schema)) return false;
  if (!schema.body.declarations) return false;
  return true;
};

export const schemaHasConstants = (schema: Schema_decl): boolean => {
  if (!schemaHasBody(schema)) return false;
  if (!schema.body.constant) return false;
  return true;
};

export const schemaHasSpecifications = (schema: Schema_decl): boolean => {
  if (!schemaHasBody(schema)) return false;
  if (!schema.body.specifications) return false;
  return true;
};

export const getSchemaDeclarations = (document: LangiumDocument<ExpressFile>): Schema_decl[] => {
  if (document.parseResult.value.schemas) return document.parseResult.value.schemas;
  return [];
};
export const getSchemaDocumentSymbol = (schema: Schema_decl): DocumentSymbol | undefined => {
  if (!schemaHasBody(schema)) return;
  if (!schema || !schema.$cstNode) return;
  const children: DocumentSymbol[] = [];
  if (schemaHasDeclarations(schema)) {
    getEntitiesDocumentSymbol(schema).forEach((e) => {
      children.push(e);
    });
    getTypesDocumentSymbol(schema).forEach((t) => {
      children.push(t);
    });
    getFunctionDocumentSymbols(schema).forEach((f) => children.push(f));
    getProcedureDocumentSymbols(schema).forEach((proc) => children.push(proc));
  }
  if (schemaHasConstants(schema)) {
    getConstantDocumentSymbols(schema).forEach((constantSymbol) => children.push(constantSymbol));
  }

  return {
    name: schema.name,
    kind: ExpressKind.Namespace,
    range: schema.$cstNode?.range,
    selectionRange: schema.$cstNode.range,
    children,
  };
};
