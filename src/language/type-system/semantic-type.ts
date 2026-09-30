import { AstNode } from "langium";
import {
  Aggregation_types,
  Array_type,
  Bag_type,
  EntityDefinition,
  List_type,
  Named_types,
  Select_list,
  Select_type,
  Set_type,
  TypeDefinition,
  Underlying_type,
  isEnumeration_extension,
  isSelect_extension,
} from "../generated/ast.js";

export const extractTypes = (type: Underlying_type): EntityDefinition[] => {
  switch (type.$type) {
    case Select_type.$type:
      return extractFromSelectType(type as Select_type);
  }
  return [];
};

// Entities reachable through an underlying type when SELF denotes an instance of
// it: an aggregate contributes its element type, a named type its target. Kept
// apart from extractTypes, whose SELECT-only result other callers depend on.
export const extractInstanceTypes = (type: Underlying_type): EntityDefinition[] => {
  switch (type.$type) {
    case Select_type.$type:
      return extractTypes(type);
    case Array_type.$type:
    case Bag_type.$type:
    case List_type.$type:
    case Set_type.$type:
      return extractFromAggregation(type as Aggregation_types);
    case Named_types.$type:
      return extractFromNamedType(type as Named_types);
  }
  return [];
};

const extractFromAggregation = (aggregate: Aggregation_types): EntityDefinition[] => {
  if (!aggregate.type) return [];
  return extractInstanceTypes(aggregate.type);
};

const extractFromNamedType = (named: Named_types): EntityDefinition[] => {
  const target = named.of?.ref;
  if (!target) return [];
  if (target.$type === EntityDefinition.$type) return [target as EntityDefinition];
  if (target.$type === TypeDefinition.$type) return extractInstanceTypes((target as TypeDefinition).underlyingType);
  return [];
};

const extractFromSelectType = (selectType: AstNode): EntityDefinition[] => {
  const select = selectType as Select_type;
  const results: EntityDefinition[] = [];
  if (!select.select) return [];
  if (select.select.$type === Select_list.$type) {
    (select.select as Select_list).types.forEach((type) => {
      // console.log(`${type.ref?.$type}`);
      if (type.ref?.$type === EntityDefinition.$type) results.push(type.ref as EntityDefinition);
      if (type.ref?.$type === TypeDefinition.$type) results.push(...extractTypes((type.ref as TypeDefinition).underlyingType));
    });
  }
  return results;
};

export const isTypeExtension = (type: AstNode): boolean => {
  return isSelect_extension(type) || isEnumeration_extension(type);
};
