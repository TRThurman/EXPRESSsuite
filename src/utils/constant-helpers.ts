/**
 * @file constant-helpers.ts
 * @description This module provides utility functions for working with constant declarations within a schema definition.
 * It includes functions to retrieve document symbols for constants, get all constant declarations,
 * and get a specific document symbol for a given constant. These helpers are typically used in language
 * server features like providing outline views or go-to-definition for constants.
 */
import { DocumentSymbol } from "vscode-languageserver";
import { Constant_body, SchemaDefinition } from "../language/generated/ast.js";
import { schemaHasConstants } from "./schema-helpers.js";
import { ExpressKind, getDocumentSymbol } from "./general.js";

/**
 * Retrieves all document symbols for constant declarations within a given schema definition.
 * @param {SchemaDefinition} schema - The schema definition to parse.
 * @returns {DocumentSymbol[]} An array of document symbols representing the constants, or an empty array if none are found.
 */
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

/**
 * Extracts all constant declarations (Constant_body) from a schema definition.
 * @param {SchemaDefinition} schema - The schema definition to parse.
 * @returns {Constant_body[] | undefined} An array of constant declarations, or undefined if the schema has no constants or no named constants.
 */
export const getConstantDeclarations = (schema: SchemaDefinition): Constant_body[] | undefined => {
  if (!schemaHasConstants(schema)) return;

  var constantDeclarations = schema.body.constant?.items;
  return constantDeclarations?.filter((c) => c.name);
};

/**
 * Creates a document symbol for a single constant declaration.
 * @param {Constant_body} constant - The constant declaration body.
 * @returns {DocumentSymbol | undefined} A document symbol for the constant, or undefined if the constant is invalid or lacks necessary information (e.g., name or CST node).
 */
export const getConstantDocumentSymbol = (constant: Constant_body): DocumentSymbol | undefined => {
  if (constant && constant.$cstNode && constant.name) {
    const typeSymbol = getDocumentSymbol(ExpressKind.Constant, constant.name, constant.$cstNode.range, constant.$cstNode.range);
    return typeSymbol;
  }
  return;
};
