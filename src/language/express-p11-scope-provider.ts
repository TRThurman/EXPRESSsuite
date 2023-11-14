import {
  AstNode,
  AstNodeDescription,
  AstNodeDescriptionProvider,
  DefaultScopeProvider,
  EMPTY_SCOPE,
  ReferenceInfo,
  Scope,
  getContainerOfType,
} from "langium";
import {
  Attribute_qualifier,
  EntityDefinition,
  Group_qualifier,
  Inverse_attr,
  isAssignment_stmt_body,
  isAttribute_qualifier,
  isBuilt_in_constant_or_function,
  isComplex_Primary_body,
  isComplex_Primary_reference,
  isDerived_attr,
  isEntityDefinition,
  isExplicit_attr,
  isGroup_qualifier,
  //@ts-ignore
  isIndex_qualifier,
  isInverse_attr,
  isQualified_attribute,
  isQualifier,
} from "./generated/ast.js";
import { getFunctionParameterType, getVariableType } from "../utils/function-helpers.js";
import { isProcedure_call_Or_Assigment_stmt_reference } from "./generated/ast.js";
import { ExpressP11References } from "./express-p11-references.js";
import { ExpressP11Services } from "./express-module.js";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { ExpressP11ParameterTypeResolutionType } from "./express-p11-type-utilities.js";

export type CustomExpressDescription<T> = {
  nameInScope: string;
  node: T;
};

export class ExpressP11ScopeProvider extends DefaultScopeProvider {
  private readonly p11References: ExpressP11References;
  protected readonly astNodeDescriptionProvider: AstNodeDescriptionProvider;
  private readonly typeContainer: ExpressP11TypeContainer;

  constructor(services: ExpressP11Services) {
    super(services);
    this.p11References = services.references.References as ExpressP11References;
    this.astNodeDescriptionProvider = services.workspace.AstNodeDescriptionProvider;
    this.typeContainer = services.shared.workspace.TypeContainer;
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

      //Inverse attribute
      if (context.property === "forAttribute" && isInverse_attr(context.container)) {
        const inverseAttribute = context.container as Inverse_attr;
        const ofType = inverseAttribute.forEntity ? inverseAttribute.forEntity : inverseAttribute.type;
        if (ofType.error || !ofType.ref) return EMPTY_SCOPE;
        const attributes = this.typeContainer.getAllAttributes(ofType.ref);
        return this.createScopeForNodes(attributes);
      }
      if (isGroup_qualifier(context.container) || isAttribute_qualifier(context.container)) {
        enum Qualifier {
          Group,
          Attribute,
        }
        const searchingFor: Qualifier = isGroup_qualifier(context.container) ? Qualifier.Group : Qualifier.Attribute;

        const directLeftSideTypes: EntityDefinition[] = [];

        if (isQualified_attribute(context.container.$container)) {
          if (searchingFor === Qualifier.Group) {
            const entity = getContainerOfType(context.container, isEntityDefinition);
            if (entity) {
              for (const entityDef of this.typeContainer.getFullSubSuperGraph(entity)) {
                directLeftSideTypes.push(entityDef);
              }
            }
          }

          if (searchingFor === Qualifier.Attribute) {
            const entity = context.container.$container.group?.entity?.ref;
            // if (!entity) console.log("couldnt read");
            if (!entity || !isEntityDefinition(entity)) return EMPTY_SCOPE;
            directLeftSideTypes.push(entity);
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
            switch (leftNode.$type) {
              case "Redeclared_attribute":
              case "Attribute_id":
                if (!isExplicit_attr(leftNode.$container) && !isDerived_attr(leftNode.$container) && !isInverse_attr(leftNode.$container))
                  return EMPTY_SCOPE;
                const attribute = leftNode.$container;
                const attributeType = this.typeContainer.resolveAttribute(attribute);
                if (attributeType.type === ExpressP11ParameterTypeResolutionType.EntityDefinition) {
                  directLeftSideTypes.push(...attributeType.value);
                }
                break;
              case "Parameter_id":
                getFunctionParameterType(leftNode!, this.p11References).forEach((type) => directLeftSideTypes.push(type.node));

                break;
              case "Variable_id":
                getVariableType(leftNode!, this.p11References).forEach((type) => directLeftSideTypes.push(type.node));
                break;
            }
          }
          if (isBuilt_in_constant_or_function(leftMember)) {
            switch (leftMember.toLowerCase()) {
              case "self":
                const entity = getContainerOfType(context.container, isEntityDefinition);
                if (entity) {
                  directLeftSideTypes.push(entity);
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
                      directLeftSideTypes.push(...attributeType.value);
                    }

                    break;
                }
                break;
              case "Group_qualifier":
                const entity = (leftMember as Group_qualifier).entity?.ref;
                // if (!entity) console.log("couldnt read");

                if (!isEntityDefinition(entity)) break;
                if (entity) {
                  directLeftSideTypes.push(entity);
                }
                break;
            }
          }
        }

        const scopeElements: AstNodeDescription[] = [];
        if (searchingFor === Qualifier.Attribute) {
          if (directLeftSideTypes.length < 1) return EMPTY_SCOPE;

          const attributes = directLeftSideTypes.map((type) => this.typeContainer.getAllAttributes(type)).flat();
          return this.createScopeForNodes(attributes, undefined, { caseInsensitive: true });
        }

        if (searchingFor === Qualifier.Group) {
          for (const entity of directLeftSideTypes) {
            for (const entityDef of this.typeContainer.getFullSubSuperGraph(entity)) {
              scopeElements.push(this.descriptions.createDescription(entityDef, entityDef.name));
            }
          }
        }
        return this.createScope(scopeElements, undefined, { caseInsensitive: true });
      }

      return super.getScope(context);
    } catch (error) {
      return EMPTY_SCOPE;
    }
  }
}
