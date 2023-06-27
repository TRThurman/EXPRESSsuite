import { DocumentSymbol } from "vscode-languageserver";
import {
  Constant_body,
  Function_decl,
  Parameter_id,
  Query_expression,
  Repeat_stmt,
  Schema_decl,
  Variable_id,
  isFunction_decl,
  isQuery_expression,
  isRepeat_stmt,
} from "../language-server/generated/ast";
import { ExpressKind, getDocumentSymbol } from "./general";
import { AstNode } from "langium";

export const getFunctionDocumentSymbols = (schema: Schema_decl): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];
  var funcDeclarations = getFunctionDeclarations(schema);
  if (funcDeclarations) {
    funcDeclarations.forEach((t) => {
      const symbol = getFunctionDocumentSymbol(t);
      if (symbol) {
        symbols.push(symbol);
      }
    });
  }
  return symbols;
};

export const getFunctionDeclarations = (schema: Schema_decl): Function_decl[] | undefined => {
  if (!schema) return;

  var typeDeclarations = schema.body.declarations.filter((d) => isFunction_decl(d)) as Function_decl[];
  return typeDeclarations.filter((f) => f.head && f.head.name);
};

export const getFunctionDocumentSymbol = (func: Function_decl): DocumentSymbol | undefined => {
  if (func && func.$cstNode && func.head.$cstNode) {
    const typeSymbol = getDocumentSymbol(
      ExpressKind.Function,
      func.head.name,
      func.$cstNode.range,
      func.head.$cstNode.range
    );
    return typeSymbol;
  }
  return;
};

export const getFunctionParameters = (func: Function_decl): Parameter_id[] => {
  return func.head.parameters.map((p) => p.ids).flat(1);
};

export const getFunctionLocalVariables = (func: Function_decl): Variable_id[] => {
  if (!func.algoHead?.local) return [];
  return func.algoHead.local?.variables.map((v) => v.ids).flat(1);
};

export const getFunctionLocalConstants = (func: Function_decl): Constant_body[] => {
  if (!func.algoHead.constant) return [];

  return func.algoHead.constant.items;
};

export function getStatementVariables<T extends AstNode>(
  node: AstNode | undefined,
  topCondition: (n: AstNode) => n is T
): Variable_id[] {
  if (!node) return [];
  if (topCondition(node)) return [];
  if (nodeIsStmtWithVariable(node)) {
    const variable = extractVariableFromStmt(node);
    return variable
      ? [variable, ...getStatementVariables(node.$container, topCondition)]
      : [...getStatementVariables(node.$container, topCondition)];
  }
  return [...getStatementVariables(node.$container, topCondition)];
}

export const nodeIsStmtWithVariable = (stmt: AstNode): boolean => {
  if (isRepeat_stmt(stmt) || isQuery_expression(stmt)) return true;
  return false;
};

export const extractVariableFromStmt = (stmt: AstNode): Variable_id | undefined => {
  switch (stmt.$type) {
    case Repeat_stmt:
      const repeatStmt = stmt as Repeat_stmt;
      return repeatStmt.control.increment?.var;
    case Query_expression:
      const query = stmt as Query_expression;
      return query.variable;
  }
  return;
};
