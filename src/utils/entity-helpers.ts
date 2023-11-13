import { DocumentSymbol } from "vscode-languageserver";
import {
  Attribute_decl,
  Derived_attr,
  EntityDefinition,
  Explicit_attr,
  Parameter_id,
  Parameter_type,
  Redeclared_attribute,
  SchemaDefinition,
  Supertype_expression,
  Supertype_term,
  isDerived_attr,
  isEntityDefinition,
  isExplicit_attr,
  isFormal_parameter,
  isGeneral_aggregation_types,
  isGeneral_array_type,
  isGeneral_bag_type,
  isGeneral_list_type,
  isGeneral_set_type,
  isNamed_types,
  isParameter_id,
  isSelect_list,
  isSelect_type,
  isTypeDefinition,
} from "../language/generated/ast.js";
import { ExpressKind, getDocumentSymbol } from "./general.js";
import { schemaHasBody } from "./schema-helpers.js";
import { extractTypes } from "../language/type-system/semantic-type.js";
import { CustomExpressDescription } from "../language/express-p11-scope-provider.js";
import { ExpressP11References } from "../language/express-p11-references.js";

export const getEntitiesDocumentSymbol = (schema: SchemaDefinition): DocumentSymbol[] => {
  const symbols: DocumentSymbol[] = [];
  var entityDeclarations = getEntityDeclarations(schema);
  if (entityDeclarations) {
    entityDeclarations.forEach((e) => {
      const symbol = getEntityDocumentSymbol(e);
      if (symbol) {
        symbols.push(symbol);
      }
    });
  }
  return symbols;
};
export const getEntityDeclarations = (schema: SchemaDefinition): EntityDefinition[] | undefined => {
  if (!schemaHasBody(schema)) return;
  var entityDeclarations = schema.body.declarations.filter((d) => isEntityDefinition(d)) as EntityDefinition[];
  return entityDeclarations.filter((e) => e.name);
};

export const getEntityDocumentSymbol = (entity: EntityDefinition): DocumentSymbol | undefined => {
  if (entity && entity.$cstNode && entity.name) {
    const entitySymbol = getDocumentSymbol(ExpressKind.Entity, entity.name, entity.$cstNode.range, entity.$cstNode.range);
    const children: DocumentSymbol[] = [];
    const attributes = getExplicitAttributeDeclarations(entity);

    attributes.forEach((attribute) => {
      const symbols = getAttributeDocumentSymbol(attribute);
      if (symbols) children.push(...symbols);
    });

    return {
      ...entitySymbol,
      children,
    };
  }
  return;
};

export const getExplicitAttributeDeclarations = (entity: EntityDefinition): Explicit_attr[] => {
  if (!entity) return [];
  const attributeDeclarations = entity.body?.attributes;
  if (attributeDeclarations) return attributeDeclarations;
  return [];
};

export const getDerivedAttributes = (entity: EntityDefinition): Derived_attr[] => {
  if (!entity) return [];
  const derivedAttr = entity.body.derived?.attributes;
  if (derivedAttr) return derivedAttr;
  return [];
};

export const getAttributeDocumentSymbol = (explicitAttribute: Explicit_attr): DocumentSymbol[] | undefined => {
  if (!explicitAttribute || !explicitAttribute.$cstNode) return;
  const symbols: DocumentSymbol[] = [];
  explicitAttribute?.attributes.forEach((attr) => {
    const name = getAttributeName(attr);
    if (name && attr.$cstNode)
      symbols.push(getDocumentSymbol(ExpressKind.Property, name, explicitAttribute.$cstNode!.range, attr.$cstNode!.range));
  });
  return symbols;
};

export const getAttributeDeclarations = (explicitAttribute: Explicit_attr): Attribute_decl[] => {
  if (!explicitAttribute) return [];
  return explicitAttribute.attributes;
};
export const getAttributeName = (attribute: Attribute_decl): string | undefined => {
  if (!attribute) return;
  if (attribute.$type !== "Redeclared_attribute") return attribute.name;
  if (attribute.$type === "Redeclared_attribute") {
    var redeclared = attribute as Redeclared_attribute;
    if (redeclared.isRenamed) return redeclared.name;
    return redeclared.qualifiedAttribute.attribute?.target.$refText;
  }
  return;
};

export const getSuperTypes = (entity: EntityDefinition | undefined): CustomExpressDescription<EntityDefinition>[] => {
  let superTypes: CustomExpressDescription<EntityDefinition>[] = [];
  if (!entity || !isEntityDefinition(entity)) return superTypes;

  const hasSuperTypes = entity.types?.supertypes?.entities;
  if (!hasSuperTypes) return superTypes;
  hasSuperTypes.forEach((supertype) => {
    if (supertype.entity?.ref && supertype.entity.$nodeDescription)
      if (isEntityDefinition(supertype.entity.ref)) {
        superTypes.push({ node: supertype.entity.ref, nameInScope: supertype.entity.$refText });
        superTypes.push(...getSuperTypes(supertype.entity.ref));
      }
  });
  return superTypes;
};

export const getSubTypes = (
  entity: EntityDefinition | undefined,
  references: ExpressP11References | undefined
): CustomExpressDescription<EntityDefinition>[] => {
  let subTypes: CustomExpressDescription<EntityDefinition>[] = [];
  if (!entity || !isEntityDefinition(entity) || !references) return subTypes;
  references.getUsedInSubtypeOf(entity).forEach((type) => subTypes.push({ node: type, nameInScope: type.name }));
  return subTypes;
};

export const getTypesFromSupertypeExpression = (expression: Supertype_expression): CustomExpressDescription<EntityDefinition>[] => {
  let superTypes: CustomExpressDescription<EntityDefinition>[] = [];
  expression.factors.forEach((factor) => {
    if (!factor.terms) return;
    factor.terms.forEach((term) => {
      getTypesFromSupertypeTerm(term).forEach((type) => superTypes.push(type));
    });
  });
  return superTypes;
};

export const getTypesFromSupertypeTerm = (term: Supertype_term): CustomExpressDescription<EntityDefinition>[] => {
  let superTypes: CustomExpressDescription<EntityDefinition>[] = [];

  switch (term.$type) {
    case "One_of":
      term.types.forEach((expression) => {
        getTypesFromSupertypeExpression(expression).forEach((type) => superTypes.push(type));
      });
      break;
    case "EntityRef":
      if (isEntityDefinition(term.entity?.ref))
        superTypes.push({ nameInScope: term.entity.$refText, node: term.entity.ref as EntityDefinition });
  }

  return superTypes;
};

export const getDataTypesFromAttribute = (
  attribute: Explicit_attr | Derived_attr,
  references: ExpressP11References
): CustomExpressDescription<EntityDefinition>[] => {
  if (isExplicit_attr(attribute)) return getTypesFromParameterType(attribute.type, references);
  if (isDerived_attr(attribute)) return getTypesFromParameterType(attribute.type, references);
  return [];
};

export const getDirectDataTypeFromAttribute = (
  attribute: Explicit_attr | Derived_attr,
  references: ExpressP11References
): CustomExpressDescription<EntityDefinition>[] => {
  if (isExplicit_attr(attribute) || isDerived_attr(attribute)) return getTypesFromParameterType(attribute.type, references);
  return [];
};
export const getTypesFromParameterType = (
  parameterType: Parameter_type,
  references: ExpressP11References
): CustomExpressDescription<EntityDefinition>[] => {
  if (!parameterType) return [];
  let dataTypes: CustomExpressDescription<EntityDefinition>[] = [];
  if (isNamed_types(parameterType)) {
    const entityDataType = parameterType.of;

    if (!entityDataType) return [];

    if (isTypeDefinition(entityDataType.ref)) {
      const type = entityDataType.ref;
      if (isSelect_type(type.underlyingType)) {
        if (isSelect_list(type.underlyingType.select)) {
          type.underlyingType.select.types.forEach((type) => {
            if (type.ref)
              getTypesFromParameterType(type.ref as unknown as Parameter_type, references).forEach((type) => dataTypes.push(type));
          });
        }
      }
    }

    if (isEntityDefinition(entityDataType.ref)) {
      const entity = entityDataType.ref;
      dataTypes.push({ nameInScope: entity.name, node: entity });
      getFullSubSuperGraph(entity, references).forEach((entityDescription) => {
        if (entityDescription) dataTypes.push(entityDescription);
      });
    }

    if (isTypeDefinition(entityDataType.ref))
      extractTypes(entityDataType.ref.underlyingType).forEach((entity) => dataTypes.push({ node: entity, nameInScope: entity.name }));
  }
  if (isGeneral_aggregation_types(parameterType)) {
    dataTypes = getTypesFromParameterType(parameterType.type, references);
  }
  return dataTypes;
};

// export const getDirectTypesFromParameterType = (
//   parameterType: Parameter_type
// ): CustomExpressDescription<EntityDefinition>[] => {
//   if (!parameterType) return [];
//   let dataType: CustomExpressDescription<EntityDefinition>[] = [];
//   if (isNamed_types(parameterType)) {
//     const entityDataType = parameterType.of;

//     if (!entityDataType) return [];

//     if (isEntityDefinition(entityDataType.ref)) {
//       dataType.push({ node: entityDataType.ref as EntityDefinition, nameInScope: entityDataType.ref.name });
//     }
//   }
//   if (isGeneral_aggregation_types(parameterType)) {
//     dataType = getDirectTypesFromParameterType(parameterType.type);
//   }
//   return dataType;
// };

export const getDataTypesFromParameterId = (
  param: Parameter_id,
  references: ExpressP11References
): CustomExpressDescription<EntityDefinition>[] => {
  if (!isParameter_id(param)) return [];
  if (!isFormal_parameter(param.$container)) return [];

  const parameterType = param.$container.type as Parameter_type;
  if (!parameterType) return [];

  return getTypesFromParameterType(parameterType, references);
};

export const getFullSubSuperGraph = (
  entity: EntityDefinition | undefined,
  references: ExpressP11References
): CustomExpressDescription<EntityDefinition>[] => {
  const graph: CustomExpressDescription<EntityDefinition>[] = [];

  if (!entity || !isEntityDefinition(entity) || !references) return [];
  getSuperTypes(entity).forEach((supertype) => {
    graph.push(supertype);
  });
  //   getSubTypes(entity, references).forEach((subtype) => {
  //     graph.push(subtype);
  //   });
  //   const subGraphs: CustomExpressDescription<EntityDefinition>[] = [];
  //   graph.forEach((type) => {
  //     subGraphs.push(...getSubTypes(type.node, references));
  //   });
  //   graph.push(...subGraphs);
  return graph;
};
