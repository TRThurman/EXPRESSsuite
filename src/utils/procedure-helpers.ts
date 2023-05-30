import { DocumentSymbol } from "vscode-languageserver";
import { Procedure_decl, Schema_decl, isProcedure_decl } from "../language-server/generated/ast";
import { schemaHasDeclarations } from "./schema-helpers";
import { ExpressKind, getDocumentSymbol } from "./general";

export const getProcedureDocumentSymbols = (schema: Schema_decl): DocumentSymbol[] => {
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

export const getProcedureDeclarations = (schema: Schema_decl): Procedure_decl[] | undefined => {
  if (!schemaHasDeclarations(schema)) return;

  var procedureDeclarations = schema.body.declarations.filter((d) => isProcedure_decl(d)) as Procedure_decl[];
  return procedureDeclarations.filter((p) => p.head && p.head.name);
};

export const getProcedureDocumentSymbol = (proc: Procedure_decl): DocumentSymbol | undefined => {
  if (proc && proc.$cstNode && proc.head.$cstNode) {
    const typeSymbol = getDocumentSymbol(
      ExpressKind.Function,
      proc.head.name,
      proc.$cstNode.range,
      proc.head.$cstNode.range
    );
    return typeSymbol;
  }
  return;
};
