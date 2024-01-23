import { AstNode } from "langium";
import {
  EntityDefinition,
  Select_list,
  Select_type,
  TypeDefinition,
  Underlying_type,
  isEnumeration_extension,
  isSelect_extension,
} from "../generated/ast.js";

export const extractTypes = (type: Underlying_type): EntityDefinition[] => {
  switch (type.$type) {
    case Select_type:
      return extractFromSelectType(type as Select_type);
  }
  return [];
};

const extractFromSelectType = (selectType: AstNode): EntityDefinition[] => {
  const select = selectType as Select_type;
  const results: EntityDefinition[] = [];
  if (!select.select) return [];
  if (select.select.$type === Select_list) {
    (select.select as Select_list).types.forEach((type) => {
      // console.log(`${type.ref?.$type}`);
      if (type.ref?.$type === EntityDefinition) results.push(type.ref);
      if (type.ref?.$type === TypeDefinition) results.push(...extractTypes((type.ref as TypeDefinition).underlyingType));
    });
  }
  return results;
};

export const isTypeExtension = (type: AstNode): boolean => {
  return isSelect_extension(type) || isEnumeration_extension(type);
};
