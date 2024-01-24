import { AstNode, AstNodeDescriptionProvider, DefaultScopeProvider, EMPTY_SCOPE, ReferenceInfo, Scope, getContainerOfType } from "langium";
import {
  Attribute_decl,
  Attribute_id,
  Attribute_qualifier,
  EntityDefinition,
  FunctionDefinition,
  Group_qualifier,
  Parameter_id,
  Primary,
  Redeclared_attribute,
  Simple_expression,
  TypeDefinition,
  Variable_id,
  isAssignment_stmt_body,
  isAttribute_qualifier,
  isBuilt_in_constant_or_function,
  isBuilt_in_function,
  isComplex_Primary,
  isComplex_Primary_body,
  isComplex_Primary_reference,
  isDerived_attr,
  isEntityDefinition,
  isEnumeration_extension,
  isEnumeration_id,
  isEnumeration_type,
  isExplicit_attr,
  isFunctionDefinition,
  isGroup_qualifier,
  isIndex_qualifier,
  isInverse_attr,
  isLocal_variable,
  isQualified_attribute,
  isQualifier,
  isQuery_expression,
  isSchemaDefinition,
  isSelect_extension,
  isSimple_expression,
  isSimple_factor,
  isVariable_id,
} from "./generated/ast.js";
import { getFunctionParameterType } from "../utils/function-helpers.js";
import { isProcedure_call_Or_Assigment_stmt_reference } from "./generated/ast.js";
import { ExpressP11Services } from "./express-module.js";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { DefinitionType, ExpressP11ParameterTypeResolutionType, ExpressP11Schema } from "./express-p11-type-utilities.js";
import { getTypesFromParameterType } from "../utils/entity-helpers.js";
import { isTypeExtension } from "./type-system/semantic-type.js";

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
    // if we are looking for a group or attr qualifier, then
    // retrieve type of previous member

    // to retrieve the type of the previous member, few options:
    // are we in a qualifiedAttribute, if yes, process, else:
    // 1. previous is an attr qualifier,
    // 2. previous is a group qualifier,
    // 3. previous is an index qualifier
    // 4. previous is head

    try {
      //   if (context.property === "entity" && isEntityRef(context.container)) {
      //     const schema = getContainerOfType(context.container, isSchemaDefinition);
      //     if (!schema) return EMPTY_SCOPE;
      //     const entities = this.typeContainer.getAllResourcesFrom(schema.name);
      //     return this.createScopeForNodes(entities);
      //   }

      const schemaNode = getContainerOfType(context.container, isSchemaDefinition);
      if (!schemaNode || !schemaNode.name) return EMPTY_SCOPE;
      const schema = this.typeContainer.getSchemas().get(schemaNode.name);
      if (!schema) return EMPTY_SCOPE;

      //type extension
      if (isTypeExtension(context.container) && context.property === "type") {
        const typeOfType = isSelect_extension(context.container) ? DefinitionType.SelectType : DefinitionType.EnumType;
        const resources = this.typeContainer.getAllRessourcesFrom(schema, true);
        if (!resources.resources.get(typeOfType)) return EMPTY_SCOPE;
        const types = [...resources.resources.get(typeOfType)!.values()].map((typeObject) => typeObject.resource.getNode());
        return this.createScopeForNodes(types);
      }

      //Inverse attribute
      if (context.property === "forAttribute" && isInverse_attr(context.container)) {
        const inverseAttribute = context.container;
        const ofType = inverseAttribute.forEntity ? inverseAttribute.forEntity : inverseAttribute.type;
        if (ofType.error || !ofType.ref) return EMPTY_SCOPE;
        const attributes = this.typeContainer.getAllAttributes(ofType.ref, context.reference.$refText);
        const scope = this.createScopeForNodes(attributes);
        return scope;
      }

      if (isGroup_qualifier(context.container) || isAttribute_qualifier(context.container)) {
        enum Qualifier {
          Group,
          Attribute,
        }
        const searchingFor: Qualifier = isGroup_qualifier(context.container) ? Qualifier.Group : Qualifier.Attribute;

        const nodesInScope: AstNode[] = [];
        let nodesInScopeType: ScopeType = ScopeType.Empty;

        if (isQualified_attribute(context.container.$container)) {
          if (searchingFor === Qualifier.Group) {
            const entity = getContainerOfType(context.container, isEntityDefinition);
            if (entity) {
              nodesInScopeType = ScopeType.Entities;
              //   for (const entityDef of this.typeContainer.getFullSubSuperGraph(entity)) {
              //     nodesInScope.push(entityDef);
              //   }
              nodesInScope.push(entity);
            }
          }

          if (searchingFor === Qualifier.Attribute) {
            const entity = context.container.$container.group?.entity?.ref;
            // if (!entity) console.log("couldnt read");
            if (!entity || !isEntityDefinition(entity)) return EMPTY_SCOPE;
            nodesInScope.push(entity);
            nodesInScopeType = ScopeType.Entity;
          }
        }

        if (isComplex_Primary_body(context.container.$container) || isAssignment_stmt_body(context.container.$container)) {
          const complexbody = context.container.$container;
          const index = context.container.$containerIndex ?? 0;
          let leftMember: AstNode | string;
          //if (!context.container.$containerIndex) return EMPTY_SCOPE;
          if (index > 0) leftMember = complexbody.qualifiers[index - 1];
          else leftMember = complexbody.$container.head;

          if (isIndex_qualifier(leftMember) && isComplex_Primary_body(leftMember.$container)) {
            let subIndex = leftMember.$containerIndex ?? -1;
            if (subIndex >= 0) {
              if (subIndex > 0) leftMember = complexbody.qualifiers[index - 2];
              else leftMember = complexbody.$container.head;
              //leftMember = leftMember.$container.qualifiers[leftMember.$containerIndex ?? 0 - 1];
            }
          }

          if (isComplex_Primary_reference(leftMember) || isProcedure_call_Or_Assigment_stmt_reference(leftMember)) {
            // if (!leftMember.to.ref) console.log("couldnt read");

            if (!leftMember.to.ref) return EMPTY_SCOPE;
            const leftNode = leftMember.to.ref;
            if (!leftNode) return EMPTY_SCOPE;
            const { nodes, type } = this.getSimpleScopeOptions(leftNode, schema);
            nodesInScope.push(...nodes);
            nodesInScopeType = type;
          }
          if (isBuilt_in_constant_or_function(leftMember)) {
            switch (leftMember.toLowerCase()) {
              case "self":
                const entity = getContainerOfType(context.container, isEntityDefinition);
                if (entity) {
                  nodesInScope.push(entity);
                  nodesInScopeType = ScopeType.Entities;
                }
                break;
            }
          }
          if (isQualifier(leftMember)) {
            switch (leftMember.$type) {
              case "Attribute_qualifier":
                const attribute = (leftMember as Attribute_qualifier).target?.ref;
                // if (!attribute) console.log("couldnt read");

                if (!attribute) break;
                switch (attribute.$type) {
                  case "Redeclared_attribute":
                  case "Attribute_id":
                    if (
                      !isExplicit_attr(attribute.$container) &&
                      !isDerived_attr(attribute.$container) &&
                      !isInverse_attr(attribute.$container)
                    )
                      return EMPTY_SCOPE;
                    const attr = attribute.$container; //reference.reference.ref?.$container as Explicit_attr;
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
                // if (!entity) console.log("couldnt read");

                if (!isEntityDefinition(entity)) break;
                if (entity) {
                  nodesInScope.push(entity);
                  nodesInScopeType = ScopeType.Entity;
                }
                break;
            }
          }
        }

        if (searchingFor === Qualifier.Attribute) {
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
          //   const attributes: Attribute_decl[] = [];
          //   if (nodesInScopeType === ScopeType.Entities) {
          //     const graphProcessed: number[] = [];
          //     for (const type of nodesInScope) {
          //       if (!graphProcessed.includes(this.typeContainer.getGraphKey(type as EntityDefinition))) {
          //         for (const attribute of this.typeContainer.getAllAttributes(type as EntityDefinition, context.reference.$refText)) {
          //           attributes.push(attribute);
          //         }
          //         graphProcessed.push(this.typeContainer.getGraphKey(type as EntityDefinition));
          //       }
          //     }
          //     const scope = this.createScopeForNodes(attributes);
          //     return scope;
          //   }

          //   if (nodesInScopeType === ScopeType.Entity && nodesInScope.length == 1) {
          //     attributes.push(...this.typeContainer.getAttributesV2(nodesInScope[0] as EntityDefinition));
          //     const scope = this.createScopeForNodes(attributes);
          //     return scope;
          //   }
          //   if (nodesInScopeType === ScopeType.Enums) {
          //     return this.resolveEnumQualifierScope(nodesInScope);
          //   }
        }

        if (searchingFor === Qualifier.Group) {
          return this.resolveGroupQualifierScope(nodesInScope, context.reference.$refText);
        }
      }

      const scope = super.getScope(context);
      return scope;
    } catch (error) {
      return EMPTY_SCOPE;
    }
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

  private resolveAttributeQualifierScope(options: AstNode[], type: ScopeType, filter: string = ""): Scope {
    const attributes: Attribute_decl[] = [];
    if (type === ScopeType.Entities) {
      const graphProcessed: string[] = [];
      for (const type of options) {
        if (!graphProcessed.includes(this.typeContainer.getGraphKey(type as EntityDefinition))) {
          for (const attribute of this.typeContainer.getAllAttributes(type as EntityDefinition, filter)) {
            attributes.push(attribute);
          }
          graphProcessed.push(this.typeContainer.getGraphKey(type as EntityDefinition));
        }
      }
      const scope = this.createScopeForNodes(attributes);
      return scope;
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
      case Redeclared_attribute:
      case Attribute_id:
        if (!isExplicit_attr(leftNode.$container) && !isDerived_attr(leftNode.$container) && !isInverse_attr(leftNode.$container))
          return { nodes: [], type: ScopeType.Empty };
        const attribute = leftNode.$container;
        const attributeType = this.typeContainer.resolveAttribute(attribute);
        if (attributeType.type === ExpressP11ParameterTypeResolutionType.EntityDefinition) {
          return { nodes: attributeType.value, type: ScopeType.Entities };
        }
        break;
      case Parameter_id:
        nodes = getFunctionParameterType(leftNode as Parameter_id).map((type) => type.node);
        return { nodes, type: ScopeType.Entities };

      case Variable_id:
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

      case TypeDefinition:
        if (!isEnumeration_type((leftNode as TypeDefinition).underlyingType)) return { nodes: [], type: ScopeType.Empty };
        const type = schema.getAllResources().findByName((leftNode as TypeDefinition).name);
        if (!type || type.type !== DefinitionType.EnumType) return { nodes: [], type: ScopeType.Empty };
        const enums = type.resource.getValues();

        nodes = enums.map((e) => e.node);
        return { nodes, type: ScopeType.Enums };

      case FunctionDefinition:
        if (!(leftNode as FunctionDefinition).head?.returnType) return { nodes: [], type: ScopeType.Empty };
        nodes = getTypesFromParameterType((leftNode as FunctionDefinition).head.returnType).map((type) => type.node);
        return { nodes, type: ScopeType.Entities };

      case EntityDefinition:
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
        if (primary.head === "USEDIN") {
          const source = primary.body.parameterList?.params[0];
          if (!source) return { nodes: [], type: ScopeType.Empty };
          if (isSimple_expression(source)) return this.getSimpleExpressionType(source, schema);
        }
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

enum ScopeType {
  Entities,
  Entity,
  Enums,
  Empty,
}
