import { AstNode } from "langium";
import {
  EntityDefinition,
  Select_type,
  Underlying_type,
  isEntityDefinition,
  isSelect_list,
  isTypeDefinition,
} from "../generated/ast";

export const extractTypes = (type: Underlying_type): EntityDefinition[] => {
  switch (type.$type) {
    case Select_type:
      return extractFromSelectType(type);
  }
  return [];
};

const extractFromSelectType = (select: Select_type): EntityDefinition[] => {
  const results: EntityDefinition[] = [];
  if (!select.select) return [];
  if (isSelect_list(select.select)) {
    select.select.types.forEach((type) => {
      if (isEntityDefinition(type.ref)) results.push(type.ref);
      if (isTypeDefinition(type.ref)) results.push(...extractTypes(type.ref.underlyingType));
    });
  }
  return results;
};
