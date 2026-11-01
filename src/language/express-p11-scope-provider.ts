import { AstNode, AstNodeDescriptionProvider, AstUtils, DefaultScopeProvider, EMPTY_SCOPE, ReferenceInfo, Scope } from "langium";
import {
  Attribute_decl,
  Attribute_id,
  Attribute_qualifier,
  BinaryExpression,
  EntityDefinition,
  FunctionDefinition,
  Group_qualifier,
  Literal,
  NamedType,
  Parameter_id,
  Primary,
  Redeclared_attribute,
  Simple_expression,
  Simple_factor,
  TypeDefinition,
  Variable_id,
  isAssignment_stmt_body,
  isAttribute_qualifier,
  isBinaryExpression,
  isBuilt_in_constant_or_function,
  isBuilt_in_function,
  isComplex_Primary,
  isComplex_Primary_body,
  isComplex_Primary_reference,
  isDerived_attr,
  isEntityDefinition,
  isEntityRef,
  isEnumeration_id,
  isEnumeration_type,
  isExplicit_attr,
  isFunctionDefinition,
  isGroup_qualifier,
  isIndex_qualifier,
  isInverse_attr,
  isLiteral,
  isLocal_variable,
  isQualified_attribute,
  isQualifier,
  isQuery_expression,
  isSchemaDefinition,
  isSelect_extension,
  isSimple_factor,
  isSubtype_declaration,
  isSupertype_factor,
  isTypeDefinition,
  isVariable_id,
} from "./generated/ast.js";
import { getFunctionParameterType } from "../utils/function-helpers.js";
import { isProcedure_call_Or_Assigment_stmt_reference } from "./generated/ast.js";
import { ExpressP11Services } from "./express-module.js";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { DefinitionType, ExpressP11ParameterTypeResolutionType, ExpressP11Schema } from "./express-p11-type-utilities.js";
import { getTypesFromParameterType } from "../utils/entity-helpers.js";
import { extractInstanceTypes, isTypeExtension } from "./type-system/semantic-type.js";

export type CustomExpressDescription<T> = {
  nameInScope: string;
  node: T;
};

export class ExpressP11ScopeProvider extends DefaultScopeProvider {
  protected readonly astNodeDescriptionProvider: AstNodeDescriptionProvider;
  private readonly typeContainer: ExpressP11TypeContainer;

  constructor(services: ExpressP11Services) {
    super(services);
    this.astNodeDescriptionProvider = services.workspace.AstNodeDescriptionProvider;
    this.typeContainer = services.validation.TypeContainer;
  }

  override getScope(context: ReferenceInfo): Scope {
    try {
      const schemaNode = AstUtils.getContainerOfType(context.container, isSchemaDefinition);
      if (!schemaNode || !schemaNode.name) return EMPTY_SCOPE;
      const schema = this.typeContainer.getSchemas().get(schemaNode.name);
      if (!schema) return EMPTY_SCOPE;

      if (this.reflection.getReferenceType(context) === NamedType.$type) {
        const visibleResources = this.typeContainer.getAllRessourcesFrom(schema, true);
        const visibleTypes = [
          ...visibleResources.resources.get(DefinitionType.Entity)?.values() ?? [],
          ...visibleResources.resources.get(DefinitionType.Type)?.values() ?? [],
          ...visibleResources.resources.get(DefinitionType.EnumType)?.values() ?? [],
          ...visibleResources.resources.get(DefinitionType.SelectType)?.values() ?? [],
        ].map((definition) => definition.resource.getNode());
        return this.createScopeForNodes(visibleTypes);
      }

      if (isReferenceToControlledEntity(context)) {
        const entities = this.typeContainer.getAllRessourcesFrom(schema, true);
        if (!entities.resources.get(DefinitionType.Entity)) return EMPTY_SCOPE;
        const entitiesInScope = [...entities.resources.get(DefinitionType.Entity)!.values()].map((e) => e.resource.getNode());
        return this.createScopeForNodes(entitiesInScope);
      }
      //type extension
      if (isReferenceToControlledType(context)) {
        const typeOfType = isSelect_extension(context.container) ? DefinitionType.SelectType : DefinitionType.EnumType;
        const resources = this.typeContainer.getAllRessourcesFrom(schema, true);
        if (!resources.resources.get(typeOfType)) return EMPTY_SCOPE;
        const types = [...resources.resources.get(typeOfType)!.values()].map((typeObject) => typeObject.resource.getNode());
        return this.createScopeForNodes(types);
      }

      // INVERSE ... FOR [entity.]attribute (ISO 10303-11:2004 9.2.1.3): an explicit
      // attribute of the referencing entity, which includes the ones it inherits;
      // with an entity prefix, that entity's own explicit attributes.
      if (context.property === "forAttribute" && isInverse_attr(context.container)) {
        const inverseAttribute = context.container;
        const ofType = inverseAttribute.forEntity ? inverseAttribute.forEntity : inverseAttribute.type;
        if (ofType.error || !ofType.ref) return EMPTY_SCOPE;
        const candidates = inverseAttribute.forEntity
          ? this.typeContainer.getAttributesV2(ofType.ref)
          : this.typeContainer.getVisibleAttributes(ofType.ref, context.reference.$refText, false);
        return this.createScopeForNodes(candidates.filter((attribute) => isExplicit_attr(attribute.$container)));
      }

      if (isGroup_qualifier(context.container) || isAttribute_qualifier(context.container)) {
        const searchingFor = isGroup_qualifier(context.container) ? QualifierKind.Group : QualifierKind.Attribute;
        const { nodes: nodesInScope, type: nodesInScopeType } = this.qualifierOperand(context.container, schema);

        if (searchingFor === QualifierKind.Attribute) {
          if (nodesInScope.length < 1) return EMPTY_SCOPE;

          switch (nodesInScopeType) {
            case ScopeType.Entities:
            case ScopeType.Entity:
              return this.resolveAttributeQualifierScope(nodesInScope, nodesInScopeType, context.reference.$refText);

            case ScopeType.Enums:
              return this.resolveEnumQualifierScope(nodesInScope);
            default:
              break;
          }
        }

        if (searchingFor === QualifierKind.Group) {
          return this.resolveGroupQualifierScope(nodesInScope, context.reference.$refText);
        }
      }

      const scope = super.getScope(context);
      return scope;
    } catch {
      return EMPTY_SCOPE;
    }
  }

  /**
   * The declarations the left operand of a qualifier evaluates to, and how the
   * qualifier is to be read against them: `Entities` for an entity- or
   * select-typed operand, `Entity` for the partial complex entity value after a
   * group reference, `Enums` for an enumeration type. Shared by linking (through
   * getScope) and by the link-target census, so both read the operand alike.
   * `undefined` when the qualifier is not inside a known schema.
   */
  getQualifierOperand(qualifier: Attribute_qualifier | Group_qualifier): { nodes: AstNode[]; type: ScopeType } | undefined {
    const schemaNode = AstUtils.getContainerOfType(qualifier, isSchemaDefinition);
    if (!schemaNode?.name) return undefined;
    const schema = this.typeContainer.getSchemas().get(schemaNode.name);
    if (!schema) return undefined;
    try {
      return this.qualifierOperand(qualifier, schema);
    } catch {
      return undefined;
    }
  }

  private qualifierOperand(qualifier: Attribute_qualifier | Group_qualifier, schema: ExpressP11Schema): { nodes: AstNode[]; type: ScopeType } {
    const empty = { nodes: [], type: ScopeType.Empty };
    const searchingFor = isGroup_qualifier(qualifier) ? QualifierKind.Group : QualifierKind.Attribute;

    const nodesInScope: AstNode[] = [];
    let nodesInScopeType: ScopeType = ScopeType.Empty;

    if (isQualified_attribute(qualifier.$container)) {
      if (searchingFor === QualifierKind.Group) {
        const entity = AstUtils.getContainerOfType(qualifier, isEntityDefinition);
        if (entity) {
          nodesInScopeType = ScopeType.Entities;
          nodesInScope.push(entity);
        }
      }

      if (searchingFor === QualifierKind.Attribute) {
        const entity = qualifier.$container.group?.entity?.ref;
        if (!entity || !isEntityDefinition(entity)) return empty;
        nodesInScope.push(entity);
        nodesInScopeType = ScopeType.Entity;
      }
    }

    if (isComplex_Primary_body(qualifier.$container) || isAssignment_stmt_body(qualifier.$container)) {
      const complexbody = qualifier.$container;
      const index = qualifier.$containerIndex ?? 0;
      // The operand is the nearest preceding qualifier that is not an index, or
      // the head. Index qualifiers are stepped over however many there are: the
      // element type of a nested aggregate is read from the declaration by
      // getTypesFromParameterType, which strips every aggregation level.
      let position = index - 1;
      while (position >= 0 && isIndex_qualifier(complexbody.qualifiers[position])) position -= 1;
      const leftMember: AstNode | string = position >= 0 ? complexbody.qualifiers[position] : complexbody.$container.head;

      if (isComplex_Primary_reference(leftMember) || isProcedure_call_Or_Assigment_stmt_reference(leftMember)) {
        if (!leftMember.to.ref) return empty;
        const leftNode = leftMember.to.ref;
        if (!leftNode) return empty;
        const { nodes, type } = this.getSimpleScopeOptions(leftNode, schema);
        nodesInScope.push(...nodes);
        nodesInScopeType = type;
      }
      if (isBuilt_in_constant_or_function(leftMember)) {
        switch (leftMember.toLowerCase()) {
          case "self": {
            const self = this.resolveSelfType(qualifier);
            if (self.nodes.length > 0) {
              nodesInScope.push(...self.nodes);
              nodesInScopeType = self.type;
            }
            break;
          }
        }
      }
      if (isQualifier(leftMember)) {
        switch (leftMember.$type) {
          case "Attribute_qualifier":
            const attribute = (leftMember as Attribute_qualifier).target?.ref;

            if (!attribute) break;
            switch (attribute.$type) {
              case "Redeclared_attribute":
              case "Attribute_id":
                if (!isExplicit_attr(attribute.$container) && !isDerived_attr(attribute.$container) && !isInverse_attr(attribute.$container))
                  return empty;
                const attr = attribute.$container;
                const attributeType = this.typeContainer.resolveAttribute(attr);
                if (attributeType.type === ExpressP11ParameterTypeResolutionType.EntityDefinition) {
                  nodesInScope.push(...attributeType.value);
                  nodesInScopeType = ScopeType.Entities;
                }

                break;
            }
            break;
          case "Group_qualifier":
            const entity = (leftMember as Group_qualifier).entity?.ref;

            if (!isEntityDefinition(entity)) break;
            if (entity) {
              nodesInScope.push(entity);
              nodesInScopeType = ScopeType.Entity;
            }
            break;
        }
      }
    }

    return { nodes: nodesInScope, type: nodesInScopeType };
  }

  private resolveGroupQualifierScope(options: AstNode[], filter: string = ""): Scope {
    const graphProcessed: string[] = [];
    const entities: EntityDefinition[] = [];
    for (const entity of options) {
      if (!graphProcessed.includes(this.typeContainer.getGraphKey(entity as EntityDefinition))) {
        for (const entityDef of this.typeContainer.getFullSubSuperGraph(entity as EntityDefinition, filter)) {
          entities.push(entityDef);
        }
        graphProcessed.push(this.typeContainer.getGraphKey(entity as EntityDefinition));
      }
    }
    const scopeToReturn = this.createScopeForNodes(entities);

    return scopeToReturn;
  }

  private resolveEnumQualifierScope(options: AstNode[]): Scope {
    return this.createScopeForNodes(options, undefined);
  }

  /**
   * ISO 10303-11:2004 12.7.3. For an entity-typed operand the attribute shall be
   * declared in that entity, a supertype or a subtype of it; for a select-typed
   * operand, in a member or a supertype or subtype of a member. The candidates
   * are listed nearest first (the entity, then each supertype depth, then each
   * subtype depth) so that the linker's first match is the nearest declaration.
   * After a group reference (`Entity`) only the named entity's own declarations
   * count: "shall occur within the entity declaration for that partial complex
   * entity data type".
   */
  private resolveAttributeQualifierScope(options: AstNode[], type: ScopeType, filter: string = ""): Scope {
    const attributes: Attribute_decl[] = [];
    if (type === ScopeType.Entities) {
      const seen = new Set<Attribute_decl>();
      for (const option of options) {
        if (!isEntityDefinition(option)) continue;
        for (const attribute of this.typeContainer.getVisibleAttributes(option, filter)) {
          if (seen.has(attribute)) continue;
          seen.add(attribute);
          attributes.push(attribute);
        }
      }
      return this.createScopeForNodes(attributes);
    }

    if (type === ScopeType.Entity && options.length == 1) {
      attributes.push(...this.typeContainer.getAttributesV2(options[0] as EntityDefinition));
      const scope = this.createScopeForNodes(attributes);
      return scope;
    }
    return EMPTY_SCOPE;
  }
  getSimpleScopeOptions(leftNode: AstNode, schema: ExpressP11Schema): { nodes: AstNode[]; type: ScopeType } {
    if (!leftNode) return { nodes: [], type: ScopeType.Empty };
    let nodes: AstNode[] = [];
    switch (leftNode.$type) {
      case Redeclared_attribute.$type:
      case Attribute_id.$type:
        if (!isExplicit_attr(leftNode.$container) && !isDerived_attr(leftNode.$container) && !isInverse_attr(leftNode.$container))
          return { nodes: [], type: ScopeType.Empty };
        const attribute = leftNode.$container;
        const attributeType = this.typeContainer.resolveAttribute(attribute);
        if (attributeType.type === ExpressP11ParameterTypeResolutionType.EntityDefinition) {
          return { nodes: attributeType.value, type: ScopeType.Entities };
        }
        break;
      case Parameter_id.$type:
        nodes = getFunctionParameterType(leftNode as Parameter_id).map((type) => type.node);
        return { nodes, type: ScopeType.Entities };

      case Variable_id.$type:
        const variable = leftNode as Variable_id;
        if (isVariable_id(variable) && isLocal_variable(variable.$container)) {
          const parameterType = variable.$container.type;
          nodes = getTypesFromParameterType(parameterType).map((type) => type.node);
          return { nodes, type: ScopeType.Entities };
        }
        if (isVariable_id(variable) && isQuery_expression(variable.$container)) {
          const source = variable.$container.source;
          if (source.expression) return this.getSimpleExpressionType(source.expression, schema);
        }
        return { nodes, type: ScopeType.Entities };

      case TypeDefinition.$type:
        if (!isEnumeration_type((leftNode as TypeDefinition).underlyingType)) return { nodes: [], type: ScopeType.Empty };
        const type = schema.getAllResources().findByName((leftNode as TypeDefinition).name);
        if (!type || type.type !== DefinitionType.EnumType) return { nodes: [], type: ScopeType.Empty };
        const enums = type.resource.getValues();

        nodes = enums.map((e) => e.node);
        return { nodes, type: ScopeType.Enums };

      case FunctionDefinition.$type:
        if (!(leftNode as FunctionDefinition).head?.returnType) return { nodes: [], type: ScopeType.Empty };
        nodes = getTypesFromParameterType((leftNode as FunctionDefinition).head.returnType).map((type) => type.node);
        return { nodes, type: ScopeType.Entities };

      case EntityDefinition.$type:
        return { nodes: [leftNode], type: ScopeType.Entities };
    }
    return { nodes: [], type: ScopeType.Empty };
  }
  private getSimpleExpressionType(expression: Simple_expression, schema: ExpressP11Schema): { nodes: AstNode[]; type: ScopeType } {
    if (isSimple_factor(expression)) {
      if (expression.primary) {
        return this.getPrimaryType(expression.primary, schema);
      }
    }
    if (isQuery_expression(expression)) {
      if (expression.variable) {
        return this.getSimpleScopeOptions(expression.variable, schema);
      }
    }
    return { nodes: [], type: ScopeType.Empty };
  }

  private resolveSelfType(node: AstNode): { nodes: AstNode[]; type: ScopeType } {
    const entity = AstUtils.getContainerOfType(node, isEntityDefinition);
    if (entity) return { nodes: [entity], type: ScopeType.Entities };
    const typeDefinition = AstUtils.getContainerOfType(node, isTypeDefinition);
    if (typeDefinition) {
      const nodes = extractInstanceTypes(typeDefinition.underlyingType);
      if (nodes.length > 0) return { nodes, type: ScopeType.Entities };
    }
    return { nodes: [], type: ScopeType.Empty };
  }

  private getPrimaryType(primary: Primary, schema: ExpressP11Schema): { nodes: AstNode[]; type: ScopeType } {
    if (isComplex_Primary(primary)) {
      if (!primary.body) {
        if (isComplex_Primary_reference(primary.head)) {
          if (primary.head.to.ref) return this.getSimpleScopeOptions(primary.head.to.ref, schema);
        }
      }
      if (isComplex_Primary_reference(primary.head) && isFunctionDefinition(primary.head.to.ref) && primary.body?.qualifiers.length < 1) {
        return this.getSimpleScopeOptions(primary.head.to.ref, schema);
      }
      if (isBuilt_in_function(primary.head)) {
        if (primary.head.toLowerCase() === "USEDIN".toLowerCase()) {
          const fullyQualifiedAttributeName = primary.body.parameterList?.params[1];
          if (!fullyQualifiedAttributeName) return { nodes: [], type: ScopeType.Empty };
          const namePath = resolveFullyQualifiedAttributeName(fullyQualifiedAttributeName);
          if (!namePath) return { nodes: [], type: ScopeType.Empty };
          if (namePath.length !== 3) return { nodes: [], type: ScopeType.Empty };
          const entity = this.typeContainer.findEntityByInsensitiveName(namePath[0], namePath[1]);
          if (!entity) return { nodes: [], type: ScopeType.Empty };
          return { nodes: [entity.getNode()], type: ScopeType.Entities };
        }
      }

      if (isBuilt_in_constant_or_function(primary.head) && primary.head.toLowerCase() === "self" && (primary.body?.qualifiers?.length ?? 0) === 0) {
        return this.resolveSelfType(primary);
      }
      if (primary.body?.qualifiers) {
        const lastQualifier = primary.body?.qualifiers.at(primary.body?.qualifiers.length - 1);
        if (isAttribute_qualifier(lastQualifier))
          if (!isEnumeration_id(lastQualifier.target) && lastQualifier.target.ref)
            return this.getSimpleScopeOptions(lastQualifier.target.ref, schema);
      }
    }
    return { nodes: [], type: ScopeType.Empty };
  }
}

const resolveFullyQualifiedAttributeName = (fullyQualifiedAttributeName: AstNode): string[] | undefined => {
  let namePath: string[] = [];
  if (isSimple_factor(fullyQualifiedAttributeName)) {
    namePath = getStringFromSimpleFactor(fullyQualifiedAttributeName)?.split(".") ?? [];
  }
  if (isBinaryExpression(fullyQualifiedAttributeName)) {
    const binaryExpressName = fullyQualifiedAttributeName as BinaryExpression;
    if (isSimple_factor(binaryExpressName.left) && isSimple_factor(binaryExpressName.right)) {
      const leftString = getStringFromSimpleFactor(binaryExpressName.left);
      const rightString = getStringFromSimpleFactor(binaryExpressName.right);
      if (!leftString || !rightString) return;
      namePath = (leftString + rightString).split(".");
    }
  }
  if (namePath.length !== 3) return;
  return namePath;
};

const getStringFromSimpleFactor = (simpleFactor: Simple_factor): string | undefined => {
  if (isSimple_factor(simpleFactor)) {
    if (isLiteral((simpleFactor as Simple_factor).primary)) {
      const namePath = ((simpleFactor as Simple_factor).primary as Literal).value.replaceAll("'", "");
      return namePath;
    }
  }
  return;
};

export const isReferenceToControlledEntity = (context: ReferenceInfo): boolean => {
  return (
    context.property === "entity" &&
    isEntityRef(context.container) &&
    (isSubtype_declaration(context.container.$container) || isSupertype_factor(context.container.$container))
  );
};
export const isReferenceToControlledType = (context: ReferenceInfo): boolean => {
  return context.property === "type" && isTypeExtension(context.container);
};

export enum ScopeType {
  Entities,
  Entity,
  Enums,
  Empty,
}

enum QualifierKind {
  Group,
  Attribute,
}
