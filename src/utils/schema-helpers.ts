import { DocumentSymbol } from "vscode-languageserver";
import { ExpressFile, SchemaDefinition } from "../language/generated/ast.js";
import { getEntitiesDocumentSymbol } from "./entity-helpers.js";
import { getTypesDocumentSymbol } from "./type-helpers.js";
import { getFunctionDocumentSymbols } from "./function-helpers.js";
import { ExpressKind } from "./general.js";
import { getProcedureDocumentSymbols } from "./procedure-helpers.js";
import { getConstantDocumentSymbols } from "./constant-helpers.js";
import { LangiumDocument } from "langium";

export const schemaHasBody = (schema: SchemaDefinition): boolean => {
  if (!schema) return false;
  if (!schema.body) return false;
  return true;
};

export const schemaHasDeclarations = (schema: SchemaDefinition): boolean => {
  if (!schemaHasBody(schema)) return false;
  if (!schema.body.declarations) return false;
  return true;
};

export const schemaHasConstants = (schema: SchemaDefinition): boolean => {
  if (!schemaHasBody(schema)) return false;
  if (!schema.body.constant) return false;
  return true;
};

export const schemaHasSpecifications = (schema: SchemaDefinition): boolean => {
  if (!schemaHasBody(schema)) return false;
  if (!schema.body.specifications) return false;
  return true;
};

export const getSchemaDeclarations = (document: LangiumDocument<ExpressFile>): SchemaDefinition[] => {
  if (document.parseResult.value.schemas) return document.parseResult.value.schemas;
  return [];
};
export const getSchemaDocumentSymbol = (schema: SchemaDefinition): DocumentSymbol | undefined => {
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
