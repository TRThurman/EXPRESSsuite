import { AstNode } from "langium";
import { Entity_decl, Entity_head, Select_list, Select_type, Type_decl, Underlying_type } from "../generated/ast";

export const extractTypes = (type: Underlying_type): Entity_decl[] => {
  switch (type.$type) {
    case Select_type:
      return extractFromSelectType(type as Select_type);
  }
  return [];
};

const extractFromSelectType = (selectType: AstNode): Entity_decl[] => {
  const select = selectType as Select_type;
  const results: Entity_decl[] = [];
  if (!select.select) return [];
  if (select.select.$type === Select_list) {
    (select.select as Select_list).types.forEach((type) => {
      // console.log(`${type.ref?.$type}`);
      if (type.ref?.$type === Entity_head) results.push((type.ref as Entity_head).$container as Entity_decl);
      if (type.ref?.$type === Type_decl) results.push(...extractTypes((type.ref as Type_decl).underlyingType));
    });
  }
  return results;
};
