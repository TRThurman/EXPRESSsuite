import { DocumentSymbol } from "vscode-languageserver";
import {
  Constant_body,
  EntityDefinition,
  FunctionDefinition,
  Parameter_id,
  Query_expression,
  Repeat_stmt,
  SchemaDefinition,
  Variable_id,
  isFormal_parameter,
  isFunctionDefinition,
  isLocal_variable,
  isParameter_id,
  isQuery_expression,
  isRepeat_stmt,
  isVariable_id,
} from "../language/generated/ast.js";
import { ExpressKind, getDocumentSymbol } from "./general.js";
import { AstNode } from "langium";
import { getTypesFromParameterType } from "./entity-helpers.js";
import { CustomExpressDescription } from "../language/express-p11-scope-provider.js";
import { ExpressP11References } from "../language/express-p11-references.js";

export const getFunctionDocumentSymbols = (schema: SchemaDefinition): DocumentSymbol[] => {
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

export const getFunctionDeclarations = (schema: SchemaDefinition): FunctionDefinition[] | undefined => {
  if (!schema) return;

  var typeDeclarations = schema.body.declarations.filter((d) => isFunctionDefinition(d)) as FunctionDefinition[];
  return typeDeclarations.filter((f) => f.head && f.name);
};

export const getFunctionDocumentSymbol = (func: FunctionDefinition): DocumentSymbol | undefined => {
  if (func && func.$cstNode && func.head.$cstNode) {
    const typeSymbol = getDocumentSymbol(ExpressKind.Function, func.name, func.$cstNode.range, func.head.$cstNode.range);
    return typeSymbol;
  }
  return;
};

export const getFunctionParameters = (func: FunctionDefinition): Parameter_id[] => {
  return func.head.parameters.map((p) => p.ids).flat(1);
};

export const getFunctionLocalVariables = (func: FunctionDefinition): Variable_id[] => {
  if (!func.algoHead?.local) return [];
  return func.algoHead.local?.variables.map((v) => v.ids).flat(1);
};

export const getFunctionLocalConstants = (func: FunctionDefinition): Constant_body[] => {
  if (!func.algoHead?.constant) return [];

  return func.algoHead.constant.items;
};

export function getStatementVariables<T extends AstNode>(node: AstNode | undefined, topCondition: (n: AstNode) => n is T): Variable_id[] {
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

export const getFunctionParameterType = (
  parameter: Parameter_id,
  references: ExpressP11References
): CustomExpressDescription<EntityDefinition>[] => {
  if (isParameter_id(parameter) && isFormal_parameter(parameter.$container)) {
    const parameterType = parameter.$container.type;
    return getTypesFromParameterType(parameterType, references);
  }
  return [];
};

export const getVariableType = (variable: Variable_id, references: ExpressP11References): CustomExpressDescription<EntityDefinition>[] => {
  if (isVariable_id(variable) && isLocal_variable(variable.$container)) {
    const parameterType = variable.$container.type;
    return getTypesFromParameterType(parameterType, references);
  }
  return [];
};
