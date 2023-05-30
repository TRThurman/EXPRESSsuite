import { AstNode } from "langium";
import { isAssignment_stmt_core } from "../language-server/generated/ast";

export const isAssignment_stmt = (node: AstNode): boolean => {
  return isAssignment_stmt_core(node);
};
