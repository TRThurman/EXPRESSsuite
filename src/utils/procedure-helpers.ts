import { DocumentSymbol } from "vscode-languageserver";
import { ProcedureDefinition, SchemaDefinition, isProcedureDefinition } from "../language-server/generated/ast";
import { schemaHasDeclarations } from "./schema-helpers";
import { ExpressKind, getDocumentSymbol } from "./general";

export const getProcedureDocumentSymbols = (schema: SchemaDefinition): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];
  var procedureDeclarations = getProcedureDeclarations(schema);
  if (procedureDeclarations) {
    procedureDeclarations.forEach((t) => {
      const symbol = getProcedureDocumentSymbol(t);
      if (symbol) {
        symbols.push(symbol);
      }
    });
  }
  return symbols;
};

export const getProcedureDeclarations = (schema: SchemaDefinition): ProcedureDefinition[] | undefined => {
  if (!schemaHasDeclarations(schema)) return;

  var procedureDeclarations = schema.body.declarations.filter((d) => isProcedureDefinition(d)) as ProcedureDefinition[];
  return procedureDeclarations.filter((p) => p.head && p.name);
};

export const getProcedureDocumentSymbol = (proc: ProcedureDefinition): DocumentSymbol | undefined => {
  if (proc && proc.$cstNode && proc.head.$cstNode) {
    const typeSymbol = getDocumentSymbol(
      ExpressKind.Function,
      proc.name,
      proc.$cstNode.range,
      proc.head.$cstNode.range
    );
    return typeSymbol;
  }
  return;
};
