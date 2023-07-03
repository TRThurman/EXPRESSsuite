import { DocumentSymbol } from "vscode-languageserver";
import {
  Attribute_decl,
  Derived_attr,
  Entity_decl,
  Explicit_attr,
  Parameter_id,
  Parameter_type,
  Redeclared_attribute,
  Schema_decl,
  Supertype_expression,
  Supertype_term,
  isDerived_attr,
  isEntity_decl,
  isEntity_head,
  isExplicit_attr,
  isFormal_parameter,
  isNamed_types,
  isParameter_id,
  isType_decl,
} from "../language-server/generated/ast";
import { ExpressKind, getDocumentSymbol } from "./general";
import { schemaHasBody } from "./schema-helpers";
import { extractTypes } from "../language-server/type-system/semantic-type";
import { CustomExpressDescription } from "../language-server/scope-provider";
import { ExpressP11References } from "../language-server/references";

export const getEntitiesDocumentSymbol = (schema: Schema_decl): DocumentSymbol[] => {
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
export const getEntityDeclarations = (schema: Schema_decl): Entity_decl[] | undefined => {
  if (!schemaHasBody(schema)) return;
  var entityDeclarations = schema.body.declarations.filter((d) => isEntity_decl(d)) as Entity_decl[];
  return entityDeclarations.filter((e) => e.head && e.head.name);
};

export const getEntityDocumentSymbol = (entity: Entity_decl): DocumentSymbol | undefined => {
  if (entity && entity.$cstNode && entity.head.$cstNode) {
    const entitySymbol = getDocumentSymbol(
      ExpressKind.Entity,
      entity.head.name,
      entity.$cstNode.range,
      entity.head.$cstNode.range
    );
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

export const getExplicitAttributeDeclarations = (entity: Entity_decl): Explicit_attr[] => {
  if (!entity) return [];
  const attributeDeclarations = entity.body?.attributes;
  if (attributeDeclarations) return attributeDeclarations;
  return [];
};

export const getDerivedAttributes = (entity: Entity_decl): Derived_attr[] => {
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
      symbols.push(
        getDocumentSymbol(ExpressKind.Property, name, explicitAttribute.$cstNode!.range, attr.$cstNode!.range)
      );
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
    return redeclared.qualifiedAttribute.attribute.target.$refText;
  }
  return;
};

export const getSuperTypes = (entity: Entity_decl | undefined): CustomExpressDescription<Entity_decl>[] => {
  let superTypes: CustomExpressDescription<Entity_decl>[] = [];
  if (!entity || !isEntity_decl(entity)) return superTypes;

  const hasSuperTypes = entity.head?.types?.supertypes?.entities;
  if (!hasSuperTypes) return superTypes;
  hasSuperTypes.forEach((supertype) => {
    if (supertype.entity?.ref && supertype.entity.$nodeDescription)
      if (isEntity_decl(supertype.entity.ref.$container)) {
        superTypes.push({ node: supertype.entity.ref.$container, nameInScope: supertype.entity.$refText });
        superTypes.push(...getSuperTypes(supertype.entity.ref.$container));
      }
  });
  return superTypes;
};

export const getSubTypes = (
  entity: Entity_decl | undefined,
  references: ExpressP11References | undefined
): CustomExpressDescription<Entity_decl>[] => {
  let subTypes: CustomExpressDescription<Entity_decl>[] = [];
  if (!entity || !isEntity_decl(entity) || !references) return subTypes;
  references.getUsedInSubtypeOf(entity).forEach((type) => subTypes.push({ node: type, nameInScope: type.head.name }));
  return subTypes;
};

export const getTypesFromSupertypeExpression = (
  expression: Supertype_expression
): CustomExpressDescription<Entity_decl>[] => {
  let superTypes: CustomExpressDescription<Entity_decl>[] = [];
  expression.factors.forEach((factor) => {
    if (!factor.terms) return;
    factor.terms.forEach((term) => {
      getTypesFromSupertypeTerm(term).forEach((type) => superTypes.push(type));
    });
  });
  return superTypes;
};

export const getTypesFromSupertypeTerm = (term: Supertype_term): CustomExpressDescription<Entity_decl>[] => {
  let superTypes: CustomExpressDescription<Entity_decl>[] = [];

  switch (term.$type) {
    case "One_of":
      term.types.forEach((expression) => {
        getTypesFromSupertypeExpression(expression).forEach((type) => superTypes.push(type));
      });
      break;
    case "EntityRef":
      if (isEntity_decl(term.entity?.ref?.$container))
        superTypes.push({ nameInScope: term.entity.$refText, node: term.entity.ref?.$container as Entity_decl });
  }

  return superTypes;
};

export const getDataTypesFromAttribute = (
  attribute: Explicit_attr | Derived_attr
): CustomExpressDescription<Entity_decl>[] => {
  if (isExplicit_attr(attribute)) return getTypesFromParameterType(attribute.type);
  if (isDerived_attr(attribute)) return getTypesFromParameterType(attribute.type);
  return [];
};
export const getTypesFromParameterType = (parameterType: Parameter_type): CustomExpressDescription<Entity_decl>[] => {
  if (!parameterType) return [];
  const dataTypes: CustomExpressDescription<Entity_decl>[] = [];
  if (isNamed_types(parameterType)) {
    const entityDataType = parameterType.of;

    if (!entityDataType) return [];

    if (isEntity_head(entityDataType.ref)) {
      const entity = entityDataType.ref.$container as Entity_decl;
      dataTypes.push({ nameInScope: entity.head.name, node: entity });
      getSuperTypes(entity).forEach((entityDescription) => {
        if (entityDescription) dataTypes.push(entityDescription);
      });
    }

    if (isType_decl(entityDataType.ref))
      extractTypes(entityDataType.ref.underlyingType).forEach((entity) =>
        dataTypes.push({ node: entity, nameInScope: entity.head.name })
      );
  }
  return dataTypes;
};

export const getDataTypesFromParameterId = (param: Parameter_id): CustomExpressDescription<Entity_decl>[] => {
  if (!isParameter_id(param)) return [];
  if (!isFormal_parameter(param.$container)) return [];

  const parameterType = param.$container.type as Parameter_type;
  if (!parameterType) return [];

  return getTypesFromParameterType(parameterType);
};

export const getFullSubSuperGraph = (
  entityInScope: Entity_decl | undefined,
  references: ExpressP11References
): CustomExpressDescription<Entity_decl>[] => {
  const graph: CustomExpressDescription<Entity_decl>[] = [];

  if (!entityInScope || !isEntity_decl(entityInScope) || !references) return [];
  getSuperTypes(entityInScope).forEach((supertype) => {
    graph.push(supertype);
  });
  getSubTypes(entityInScope, references).forEach((subtype) => {
    graph.push(subtype);
  });
  const subGraphs: CustomExpressDescription<Entity_decl>[] = [];
  graph.forEach((type) => {
    subGraphs.push(...getSubTypes(type.node, references));
  });
  graph.push(...subGraphs);
  return graph;
};
