import {
  AstNode,
  AstNodeDescription,
  AstNodeDescriptionProvider,
  DefaultScopeProvider,
  EMPTY_SCOPE,
  ReferenceInfo,
  Scope,
  Stream,
  StreamScope,
  getContainerOfType,
} from "langium";
import {
  Attribute_qualifier,
  EntityDefinition,
  Explicit_attr,
  Group_qualifier,
  Inverse_attr,
  Parameter_id,
  Procedure_call_Or_Assigment_stmt_reference,
  Qualified_attribute,
  Reference_clause,
  SchemaDefinition,
  isAlias_stmt,
  isAssignment_stmt_body,
  isAttribute_qualifier,
  isAttribute_ref,
  isBuilt_in_constant_or_function,
  isComplex_Primary_body,
  isComplex_Primary_reference,
  isDerived_attr,
  isEntityDefinition,
  isExplicit_attr,
  isFunctionDefinition,
  isGeneral_ref,
  isGroup_qualifier,
  //@ts-ignore
  isIndex_qualifier,
  isInverse_attr,
  isQualified_attribute,
  isQualifier,
  isReference_clause,
  isResource_or_rename,
} from "./generated/ast";
import { getReferenceSpecifications } from "../utils/interface-helpers";
import {
  getAttributeDeclarations,
  getAttributeName,
  getDataTypesFromAttribute,
  getDataTypesFromParameterId,
  getDerivedAttributes,
  //@ts-ignore
  getDirectDataTypeFromAttribute,
  getExplicitAttributeDeclarations,
} from "../utils/entity-helpers";
import { getFunctionParameterType, getStatementVariables, getVariableType } from "../utils/function-helpers";
import { isProcedure_call_Or_Assigment_stmt_reference } from "./generated/ast";
import { ExpressP11References } from "./express-p11-references";
import { ScopingCache } from "../utils/caching";
import { ExpressP11Services } from "./express-p11-module";
import { ExpressP11TypeContainer } from "./express-p11-type-container";

export type CustomExpressDescription<T> = {
  nameInScope: string;
  node: T;
};

export class ExpressP11ScopeProvider extends DefaultScopeProvider {
  private readonly p11References: ExpressP11References;
  protected readonly astNodeDescriptionProvider: AstNodeDescriptionProvider;
  private readonly typeContainer: ExpressP11TypeContainer;

  private readonly cache: ScopingCache;

  constructor(services: ExpressP11Services) {
    super(services);
    this.p11References = services.references.References as ExpressP11References;
    this.astNodeDescriptionProvider = services.workspace.AstNodeDescriptionProvider;
    this.typeContainer = services.shared.workspace.TypeContainer;
    this.cache = services.caching.CustomCache;
  }
  //TODO: manage renamed resources
  toAstNodeDescription(customExpressDescription: CustomExpressDescription<AstNode>): AstNodeDescription {
    return this.descriptions.createDescription(customExpressDescription.node, customExpressDescription.nameInScope);
  }
  getImportedTypes(schema: SchemaDefinition, referenceType: string): AstNodeDescription[] {
    const imports = getReferenceSpecifications(schema);
    const additionalScope: AstNodeDescription[] = [];
    if (!imports) return additionalScope;
    // console.log(`found ${imports.length} imports in ${schema.name}`);
    imports.forEach((i) => {
      i.resources.forEach((resource) => {
        // console.log(
        //   `checking for ${i.schema.$refText} and ${resource.resource.$refText} of type ${resource.resource.$nodeDescription?.type}`
        // );
        if (!resource.resource.$nodeDescription) return;

        if (this.reflection.isSubtype(resource.resource.$nodeDescription?.type, referenceType) && !resource.isRenamed) {
          if (resource.resource.$nodeDescription?.node) additionalScope.push(resource.resource.$nodeDescription);
        }

        if (resource.isRenamed && this.reflection.isSubtype(resource.resource.$nodeDescription?.type, referenceType)) {
          additionalScope.push(
            this.descriptions.createDescription(resource.resource.$nodeDescription?.node!, resource.name)
          );
        }
      });
    });
    // console.log(`imported ${additionalScope.length} types`);
    return additionalScope;
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
        // this is used for a group qualifier options
        const leftSideTypeOptions: AstNodeDescription[] = [];
        //this is used for an attribute qualifier and represent the type we are extracting attributes from
        const directLeftSideTypes: EntityDefinition[] = [];

        if (isQualified_attribute(context.container.$container)) {
          if (searchingFor === Qualifier.Group) {
            const entity = getContainerOfType(context.container, isEntityDefinition);
            if (entity) {
              //   this.cache
              //     .getFullSubSuperGraph(entity, this.p11References, [
              //       entity.$container.$document?.uri.toString() ?? "unknown",
              //     ])
              //     .forEach((e) => {
              //       leftSideTypeOptions.push(this.toAstNodeDescription(e));
              //     });
              for (const entityDef of this.typeContainer.getFullSubSuperGraph(entity)) {
                leftSideTypeOptions.push(this.descriptions.createDescription(entityDef, entityDef.name));
              }
            }
          }

          if (searchingFor === Qualifier.Attribute) {
            const entity = context.container.$container.group?.entity?.ref;
            if (!entity || !isEntityDefinition(entity)) return EMPTY_SCOPE;
            directLeftSideTypes.push(entity);
          }
        }

        if (
          isComplex_Primary_body(context.container.$container) ||
          isAssignment_stmt_body(context.container.$container)
        ) {
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
            if (!leftMember.to.ref) return EMPTY_SCOPE;
            const leftNode = leftMember.to.ref;
            if (!leftNode) return EMPTY_SCOPE;
            switch (leftNode.$type) {
              case "Redeclared_attribute":
              case "Attribute_id":
                if (!isExplicit_attr(leftNode.$container) && !isDerived_attr(leftNode.$container)) return EMPTY_SCOPE;
                const attribute = leftNode.$container; //reference.reference.ref?.$container as Explicit_attr;
                //directLeftSideTypes =getDirectDataTypeFromAttribute(attribute)?.node;
                getDirectDataTypeFromAttribute(attribute, this.p11References).forEach((type) =>
                  directLeftSideTypes.push(type.node)
                );
                getDataTypesFromAttribute(attribute, this.p11References).forEach((type) =>
                  leftSideTypeOptions.push(
                    this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node })
                  )
                );
                break;
              case "Parameter_id":
                //directLeftSideTypes = getFunctionParameterType(leftNode)?.node;
                getFunctionParameterType(leftNode, this.p11References).forEach((type) =>
                  directLeftSideTypes.push(type.node)
                );
                if (directLeftSideTypes) {
                  directLeftSideTypes.forEach((type) => {
                    // this.cache
                    //   .getFullSubSuperGraph(type, this.p11References, [
                    //     type.$container.$document?.uri.toString() ?? "unknown",
                    //   ])
                    //   .forEach((e) => {
                    //     leftSideTypeOptions.push(this.toAstNodeDescription(e));
                    //   });
                    for (const entityDef of this.typeContainer.getFullSubSuperGraph(type)) {
                      leftSideTypeOptions.push(this.descriptions.createDescription(entityDef, entityDef.name));
                    }
                  });
                }
                break;
              case "Variable_id":
                // directLeftSideTypes = getVariableType(leftNode)?.node;
                getVariableType(leftNode, this.p11References).forEach((type) => directLeftSideTypes.push(type.node));
                if (directLeftSideTypes) {
                  directLeftSideTypes.forEach((type) => {
                    // this.cache
                    //   .getFullSubSuperGraph(type, this.p11References, [
                    //     type.$container.$document?.uri.toString() ?? "unknown",
                    //   ])
                    //   .forEach((e) => {
                    //     leftSideTypeOptions.push(this.toAstNodeDescription(e));
                    //   });
                    for (const entityDef of this.typeContainer.getFullSubSuperGraph(type)) {
                      leftSideTypeOptions.push(this.descriptions.createDescription(entityDef, entityDef.name));
                    }
                  });
                }

                break;
            }
          }
          if (isBuilt_in_constant_or_function(leftMember)) {
            switch (leftMember.toLowerCase()) {
              case "self":
                const entity = getContainerOfType(context.container, isEntityDefinition);
                if (entity) {
                  directLeftSideTypes.push(entity);
                  //const test = this.typeContainer.getSuperTypesFromDefinition(entity);
                  //   this.cache
                  //     .getFullSubSuperGraph(entity, this.p11References, [
                  //       entity.$container.$document?.uri.toString() ?? "unknown",
                  //     ])
                  //     .forEach((supertype) => {
                  //       leftSideTypeOptions.push(
                  //         this.toAstNodeDescription({
                  //           nameInScope: supertype.nameInScope,
                  //           node: supertype.node,
                  //         })
                  //       );
                  //     });
                  for (const entityDef of this.typeContainer.getFullSubSuperGraph(entity)) {
                    leftSideTypeOptions.push(this.descriptions.createDescription(entityDef, entityDef.name));
                  }
                }
                break;
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
                    if (!isExplicit_attr(attribute.$container) && !isDerived_attr(attribute.$container))
                      return EMPTY_SCOPE;
                    const attr = attribute.$container; //reference.reference.ref?.$container as Explicit_attr;
                    // directLeftSideTypes = getDirectDataTypeFromAttribute(attr)?.node;
                    getDirectDataTypeFromAttribute(attr, this.p11References).forEach((type) =>
                      directLeftSideTypes.push(type.node)
                    );
                    getDataTypesFromAttribute(attr, this.p11References).forEach((type) =>
                      leftSideTypeOptions.push(
                        this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node })
                      )
                    );
                    break;
                }
                break;
              case "Group_qualifier":
                const entity = (leftMember as Group_qualifier).entity?.ref;
                if (!isEntityDefinition(entity)) break;
                if (entity) {
                  directLeftSideTypes.push(entity);
                  //   this.cache
                  //     .getFullSubSuperGraph(entity, this.p11References, [
                  //       entity?.$container.$document?.uri.toString() ?? "unknown",
                  //     ])
                  //     .forEach((e) => {
                  //       leftSideTypeOptions.push(this.toAstNodeDescription(e));
                  //     });
                  for (const entityDef of this.typeContainer.getFullSubSuperGraph(entity)) {
                    leftSideTypeOptions.push(this.descriptions.createDescription(entityDef, entityDef.name));
                  }
                }
                break;
            }
          }
        }

        const scopeElements: AstNodeDescription[] = [];
        if (searchingFor === Qualifier.Attribute) {
          if (directLeftSideTypes.length < 1) return EMPTY_SCOPE;

          const attributes = directLeftSideTypes.map((type) => this.typeContainer.getAllAttributes(type)).flat();
          return this.createScopeForNodes(attributes);
        }

        if (searchingFor === Qualifier.Group) {
          leftSideTypeOptions.forEach((e) => {
            if (!isEntityDefinition(e.node)) return;
            scopeElements.push(e);
          });

          //   leftSideTypeOptions
          //     .filter((o) => isEntityDefinition(o.node))
          //     .map((e) => this.descriptions.createDescription(e.node!, e.node?.name!));
        }
        return this.createScope(scopeElements);
      }

      return super.getScope(context);
    } catch (error) {
      console.log("A scope could not be computed.");
      return EMPTY_SCOPE;
    }

    // try {
    //   const referenceType = this.reflection.getReferenceType(context);
    //   if (
    //     isResource_or_rename(context.container) &&
    //     isReference_clause(context.container.$container) &&
    //     context.property === "resource"
    //   ) {
    //     const schema = (context.container.$container as Reference_clause).schema;
    //     if (schema.ref) {
    //       const schemaName = schema.ref.name;
    //       if (schemaName) {
    //         const precomputed = getDocument(schema.ref).precomputedScopes;

    //         const elements = precomputed
    //           ?.get(schema.ref)
    //           .filter((e) => this.reflection.isSubtype(e.type, referenceType));
    //         if (elements) {
    //           const scope = this.createScope(elements);
    //           return scope;
    //         }
    //       }
    //     } else {
    //       return EMPTY_SCOPE;
    //     }
    //   }

    //   // a complex_primary_ref is needed
    //   if (isComplex_Primary_reference(context.container)) {
    //     const options: AstNodeDescription[] = [];

    //     const contextIsFunction = getContainerOfType(context.container, isFunctionDefinition);
    //     if (contextIsFunction) {
    //       this.cache
    //         .getFunctionParameters(contextIsFunction, [contextIsFunction.$document?.uri.toString() ?? "unknown"])
    //         .forEach((param) => options.push(this.descriptions.createDescription(param, param.name)));

    //       this.cache
    //         .getFunctionLocalVariables(contextIsFunction, [contextIsFunction.$document?.uri.toString() ?? "unknown"])
    //         .forEach((variable) => options.push(this.descriptions.createDescription(variable, variable.name)));
    //       this.cache
    //         .getFunctionLocalConstants(contextIsFunction, [contextIsFunction.$document?.uri.toString() ?? "unknown"])
    //         .forEach((constant) => options.push(this.descriptions.createDescription(constant, constant.name)));
    //       // getStatementVariables(context.container, isFunction_decl).forEach((variable) =>
    //       //   options.push(this.descriptions.createDescription(variable, variable.name))
    //       // );
    //       this.cache
    //         .getFunctionStatementVariables(context.container, [
    //           context.container.$document?.uri.toString() ?? "unknown",
    //         ])
    //         .forEach((variable) => options.push(this.descriptions.createDescription(variable, variable.name)));
    //     }

    //     const contextIsEntity = getContainerOfType(context.container, isEntityDefinition);
    //     if (contextIsEntity) {
    //       const attributes: Attribute_decl[] = [];
    //       getExplicitAttributeDeclarations(contextIsEntity).forEach((explicitAttribute) =>
    //         getAttributeDeclarations(explicitAttribute).forEach((attributeDeclaration) =>
    //           attributes.push(attributeDeclaration)
    //         )
    //       );

    //       getDerivedAttributes(contextIsEntity).forEach((derivedAttribute) =>
    //         attributes.push(derivedAttribute.attribute)
    //       );

    //       attributes
    //         .map((attribute) => this.descriptions.createDescription(attribute, attribute.name ?? "test"))
    //         .filter((e) => this.reflection.isSubtype(e.type, referenceType))
    //         .forEach((s) => options.push(s));

    //       this.cache
    //         .getEntityStatementVariables(context.container, [context.container.$document?.uri.toString() ?? "unknown"])
    //         .forEach((variable) => options.push(this.descriptions.createDescription(variable, variable.name)));
    //     }

    //     super
    //       .getScope(context)
    //       .getAllElements()
    //       //.filter((e) => this.reflection.isSubtype(e.type, referenceType))
    //       .forEach((e) => options.push(e));

    //     return this.createScope(options);
    //   }

    //   //Inverse attribute
    //   if (context.property === "forAttribute" && isInverse_attr(context.container)) {
    //     const inverseAttribute = context.container as Inverse_attr;
    //     const ofType = inverseAttribute.forEntity ? inverseAttribute.forEntity : inverseAttribute.ofEntity;
    //     if (ofType.error || !ofType.ref) return EMPTY_SCOPE;
    //     const elementsInScope: AstNodeDescription[] = [];
    //     getExplicitAttributeDeclarations(ofType.ref).forEach((explicitAttribute) =>
    //       getAttributeDeclarations(explicitAttribute).forEach((attribute) =>
    //         elementsInScope.push(this.descriptions.createDescription(attribute, attribute.name ?? "test"))
    //       )
    //     );
    //     return this.createScope(elementsInScope);
    //   }

    //   if (
    //     // isQualifiable_ref(context.container) ||
    //     isGeneral_ref(context.container) ||
    //     isProcedure_call_Or_Assigment_stmt_reference(context.container)
    //   ) {
    //     const scope: AstNodeDescription[] = [];
    //     const entityContext = getContainerOfType(context.container, isEntityDefinition);
    //     if (entityContext) {
    //       const attributes: Attribute_decl[] = [];
    //       getExplicitAttributeDeclarations(entityContext).forEach((explicitAttribute) =>
    //         getAttributeDeclarations(explicitAttribute).forEach((attributeDeclaration) =>
    //           attributes.push(attributeDeclaration)
    //         )
    //       );

    //       attributes
    //         .map((attribute) => this.descriptions.createDescription(attribute, attribute.name))
    //         .filter((e) => this.reflection.isSubtype(e.type, referenceType))
    //         .forEach((s) => scope.push(s));
    //       return this.createScope(scope);
    //     }

    //     const functionContext = getContainerOfType(context.container, isFunctionDefinition);
    //     if (functionContext) {
    //       if (functionContext) {
    //         this.cache
    //           .getFunctionParameters(functionContext, [functionContext.$document?.uri.toString() ?? "unknown"])
    //           .forEach((param) => scope.push(this.descriptions.createDescription(param, param.name)));
    //         this.cache
    //           .getFunctionLocalVariables(functionContext, [functionContext.$document?.uri.toString() ?? "unknown"])
    //           .forEach((variable) => scope.push(this.descriptions.createDescription(variable, variable.name)));
    //         // console.log(`in Function ${functionScope.head.name} with ${parametersInScope.length} for ${referenceType}`);
    //         return this.createScope(scope);
    //       }
    //     }

    //     return EMPTY_SCOPE;
    //   }

    //   if (isAttribute_ref(context.container)) {
    //     const scope: AstNodeDescription[] = [];
    //     const entityContext = getContainerOfType(context.container, isEntityDefinition);
    //     if (entityContext) {
    //       const attributes: Attribute_decl[] = [];
    //       getExplicitAttributeDeclarations(entityContext).forEach((explicitAttribute) =>
    //         getAttributeDeclarations(explicitAttribute).forEach((attributeDeclaration) =>
    //           attributes.push(attributeDeclaration)
    //         )
    //       );

    //       attributes
    //         .map((attribute) => this.descriptions.createDescription(attribute, getAttributeName(attribute)))
    //         .filter((e) => this.reflection.isSubtype(e.type, referenceType))
    //         .forEach((s) => scope.push(s));
    //       return this.createScope(scope);
    //     }
    //   }

    //   if (isGroup_qualifier(context.container) || isAttribute_qualifier(context.container)) {
    //     enum Qualifier {
    //       Group,
    //       Attribute,
    //     }
    //     const searchingFor: Qualifier = isGroup_qualifier(context.container) ? Qualifier.Group : Qualifier.Attribute;
    //     // this is used for a group qualifier options
    //     const leftSideTypeOptions: AstNodeDescription[] = [];
    //     //this is used for an attribute qualifier and represent the type we are extracting attributes from
    //     let directLeftSideType: EntityDefinition | undefined;

    //     if (isQualified_attribute(context.container.$container)) {
    //       if (searchingFor === Qualifier.Group) {
    //         directLeftSideType = getContainerOfType(context.container, isEntityDefinition);
    //         if (directLeftSideType)
    //           this.cache
    //             .getFullSubSuperGraph(directLeftSideType, this.p11References, [
    //               directLeftSideType.$container.$document?.uri.toString() ?? "unknown",
    //             ])
    //             .forEach((e) => {
    //               leftSideTypeOptions.push(this.toAstNodeDescription(e));
    //             });
    //       }

    //       if (searchingFor === Qualifier.Attribute) {
    //         const entity = context.container.$container.group?.entity?.ref;
    //         if (!entity || !isEntityDefinition(entity)) return EMPTY_SCOPE;
    //         directLeftSideType = entity;
    //       }
    //     }

    //     if (
    //       isComplex_Primary_body(context.container.$container) ||
    //       isAssignment_stmt_body(context.container.$container)
    //     ) {
    //       const complexbody = context.container.$container;
    //       const index = context.container.$containerIndex ?? 0;
    //       let leftMember: AstNode | string;
    //       //if (!context.container.$containerIndex) return EMPTY_SCOPE;
    //       if (index > 0) leftMember = complexbody.qualifiers[index - 1];
    //       else leftMember = complexbody.$container.head;

    //       if (isIndex_qualifier(leftMember) && isComplex_Primary_body(leftMember.$container)) {
    //         let subIndex = leftMember.$containerIndex ?? -1;
    //         if (subIndex >= 0) {
    //           if (subIndex > 0) leftMember = complexbody.qualifiers[index - 2];
    //           else leftMember = complexbody.$container.head;
    //           //leftMember = leftMember.$container.qualifiers[leftMember.$containerIndex ?? 0 - 1];
    //         }
    //       }

    //       if (isComplex_Primary_reference(leftMember) || isProcedure_call_Or_Assigment_stmt_reference(leftMember)) {
    //         if (!leftMember.to.ref) return EMPTY_SCOPE;
    //         const leftNode = leftMember.to.ref;
    //         if (!leftNode) return EMPTY_SCOPE;
    //         switch (leftNode.$type) {
    //           case "Attribute_id":
    //             if (!isExplicit_attr(leftNode.$container) && !isDerived_attr(leftNode.$container)) return EMPTY_SCOPE;
    //             const attribute = leftNode.$container; //reference.reference.ref?.$container as Explicit_attr;
    //             directLeftSideType = getDirectDataTypeFromAttribute(attribute)?.node;

    //             getDataTypesFromAttribute(attribute, this.p11References).forEach((type) =>
    //               leftSideTypeOptions.push(
    //                 this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node })
    //               )
    //             );
    //             break;
    //           case "Parameter_id":
    //             directLeftSideType = getFunctionParameterType(leftNode)?.node;
    //             if (directLeftSideType) {
    //               this.cache
    //                 .getFullSubSuperGraph(directLeftSideType, this.p11References, [
    //                   directLeftSideType.$container.$document?.uri.toString() ?? "unknown",
    //                 ])
    //                 .forEach((e) => {
    //                   leftSideTypeOptions.push(this.toAstNodeDescription(e));
    //                 });
    //             }
    //             break;
    //           case "Variable_id":
    //             directLeftSideType = getVariableType(leftNode)?.node;
    //             if (directLeftSideType) {
    //               this.cache
    //                 .getFullSubSuperGraph(directLeftSideType, this.p11References, [
    //                   directLeftSideType.$container.$document?.uri.toString() ?? "unknown",
    //                 ])
    //                 .forEach((e) => {
    //                   leftSideTypeOptions.push(this.toAstNodeDescription(e));
    //                 });
    //             }
    //             break;
    //         }
    //       }
    //       if (isBuilt_in_constant_or_function(leftMember)) {
    //         switch (leftMember.toLowerCase()) {
    //           case "self":
    //             const entity = getContainerOfType(context.container, isEntityDefinition);
    //             if (entity) {
    //               directLeftSideType = entity;
    //               this.cache
    //                 .getFullSubSuperGraph(directLeftSideType, this.p11References, [
    //                   directLeftSideType.$container.$document?.uri.toString() ?? "unknown",
    //                 ])
    //                 .forEach((supertype) => {
    //                   leftSideTypeOptions.push(
    //                     this.toAstNodeDescription({
    //                       nameInScope: supertype.nameInScope,
    //                       node: supertype.node,
    //                     })
    //                   );
    //                 });
    //             }
    //             break;
    //         }
    //       }
    //       if (isQualifier(leftMember)) {
    //         switch (leftMember.$type) {
    //           case "Attribute_qualifier":
    //             const attribute = (leftMember as Attribute_qualifier).target?.ref;
    //             if (!attribute) break;
    //             switch (attribute.$type) {
    //               case "Attribute_id":
    //                 if (!isExplicit_attr(attribute.$container) && !isDerived_attr(attribute.$container))
    //                   return EMPTY_SCOPE;
    //                 const attr = attribute.$container; //reference.reference.ref?.$container as Explicit_attr;
    //                 directLeftSideType = getDirectDataTypeFromAttribute(attr)?.node;
    //                 getDataTypesFromAttribute(attr, this.p11References).forEach((type) =>
    //                   leftSideTypeOptions.push(
    //                     this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node })
    //                   )
    //                 );
    //                 break;
    //             }
    //             break;
    //           case "Group_qualifier":
    //             const entity = (leftMember as Group_qualifier).entity.ref;
    //             if (!isEntityDefinition(entity)) break;
    //             directLeftSideType = entity;
    //             if (directLeftSideType) {
    //               this.cache
    //                 .getFullSubSuperGraph(directLeftSideType, this.p11References, [
    //                   directLeftSideType?.$container.$document?.uri.toString() ?? "unknown",
    //                 ])
    //                 .forEach((e) => {
    //                   leftSideTypeOptions.push(this.toAstNodeDescription(e));
    //                 });
    //             }
    //             break;
    //         }
    //       }
    //     }

    //     const scopeElements: AstNodeDescription[] = [];
    //     if (searchingFor === Qualifier.Attribute) {
    //       if (!isEntityDefinition(directLeftSideType)) return EMPTY_SCOPE;
    //       getExplicitAttributeDeclarations(directLeftSideType).forEach((explicitAttr) => {
    //         getAttributeDeclarations(explicitAttr).forEach((attribute) => {
    //           const name = getAttributeName(attribute);
    //           if (!name) return;
    //           scopeElements.push(this.descriptions.createDescription(attribute, name));
    //         });
    //       });
    //     }

    //     if (searchingFor === Qualifier.Group) {
    //       leftSideTypeOptions.forEach((e) => {
    //         if (!isEntityDefinition(e.node)) return;
    //         scopeElements.push(this.toAstNodeDescription({ node: e.node, nameInScope: e.node.name }));
    //       });
    //     }
    //     return this.createScope(scopeElements.filter((e) => this.reflection.isSubtype(e.type, referenceType)));
    //   }
    //   /*
    //     Section 12.7.4 Group references
    //     The group reference (\) provides a reference to a partial complex entity value within a complex entity instance.
    //     The expression to the left of the group reference shall evaluate to a complex entity instance.
    //     The entity data type of the partial complex entity value to be referenced is specified following the reverse solidus(\).
    //   */
    //   if (isGroup_qualifier(context.container)) {
    //     const leftSideTypeOptions: AstNodeDescription[] = [];

    //     // SELF\Entity.attribute
    //     //        ^
    //     //        |
    //     //        |
    //     if (isQualified_attribute(context.container.$container)) {
    //       const leftEntityDataType = getContainerOfType(context.container, isEntityDefinition);
    //       if (leftEntityDataType) {
    //         this.cache
    //           .getFullSubSuperGraph(leftEntityDataType, this.p11References, [
    //             leftEntityDataType.$container.$document?.uri.toString() ?? "unknown",
    //           ])
    //           .forEach((supertype) => {
    //             leftSideTypeOptions.push(
    //               this.toAstNodeDescription({ nameInScope: supertype.nameInScope, node: supertype.node })
    //             );
    //           });
    //       }
    //     }

    //     // Qualified_Rep:(factor=Qualifiable_factor qualifiers+=Qualifier*);
    //     // Qualifier: ...| Group_qualifier(\Y) | ... ;
    //     // Qualifiable_factor: Constant_factor  | Attribute_ref |  General_ref | Population | Function_call;
    //     //                          (1)               (2)               (3)         (4)           (5)
    //     if (isComplex_Primary_body(context.container.$container)) {
    //       const complexbody = context.container.$container;
    //       const index = complexbody.qualifiers.indexOf(context.container as Group_qualifier);
    //       let previousOrHead: AstNode | string;
    //       if (index > 0) previousOrHead = complexbody.qualifiers[index - 1];
    //       else previousOrHead = complexbody.$container.head;

    //       if (isComplex_Primary_reference(previousOrHead)) {
    //         if (!previousOrHead.to.ref) return EMPTY_SCOPE;
    //         const head = previousOrHead.to.ref;
    //         switch (head.$type) {
    //           case "Attribute_id":
    //             if (!isExplicit_attr(head.$container) && !isDerived_attr(head.$container)) return EMPTY_SCOPE;
    //             const attribute = head.$container; //reference.reference.ref?.$container as Explicit_attr;
    //             getDataTypesFromAttribute(attribute, this.p11References).forEach((type) =>
    //               leftSideTypeOptions.push(
    //                 this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node })
    //               )
    //             );
    //             break;
    //         }
    //       }
    //       if (isBuilt_in_constant_or_function(previousOrHead)) {
    //         switch (previousOrHead) {
    //           case "SELF":
    //             const entity = getContainerOfType(context.container, isEntityDefinition);
    //             if (entity) {
    //               this.cache
    //                 .getFullSubSuperGraph(entity, this.p11References, [
    //                   entity.$container.$document?.uri.toString() ?? "unknown",
    //                 ])
    //                 .forEach((supertype) => {
    //                   leftSideTypeOptions.push(
    //                     this.toAstNodeDescription({
    //                       nameInScope: supertype.nameInScope,
    //                       node: supertype.node,
    //                     })
    //                   );
    //                 });
    //             }
    //             break;
    //         }
    //       }
    //       if (isQualifier(previousOrHead)) {
    //         switch (previousOrHead.$type) {
    //           case "Attribute_qualifier":
    //             const attribute = (previousOrHead as Attribute_qualifier).target?.ref;
    //             if (!attribute) break;
    //             switch (attribute.$type) {
    //               case "Attribute_id":
    //                 if (!isExplicit_attr(attribute.$container) && !isDerived_attr(attribute.$container))
    //                   return EMPTY_SCOPE;
    //                 const attr = attribute.$container; //reference.reference.ref?.$container as Explicit_attr;
    //                 getDataTypesFromAttribute(attr, this.p11References).forEach((type) =>
    //                   leftSideTypeOptions.push(
    //                     this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node })
    //                   )
    //                 );
    //                 break;
    //             }
    //         }
    //       }

    //       // if (qualifiedRep.factor) {
    //       //   switch (qualifiedRep.factor.$type) {
    //       //     // (1) Constant_factor
    //       //     case Constant_factor:
    //       //       //TODO: for now we only support built-in constant
    //       //       const constant = qualifiedRep.factor as Constant_factor;
    //       //       if (constant.constant === "SELF") {
    //       //         const entity = getContainerOfType(context.container, isEntity_decl);
    //       //         if (entity) {
    //       //           getSuperTypes(entity).forEach((supertype) => {
    //       //             leftSideTypeOptions.push(
    //       //               this.toAstNodeDescription({ nameInScope: supertype.nameInScope, node: supertype.node.head })
    //       //             );
    //       //           });
    //       //         }
    //       //       }
    //       //       break;
    //       //     // (2) Attribute_ref
    //       //     //case Attribute_ref:
    //       //     case Qualifiable_ref:
    //       //       const reference = qualifiedRep.factor as Qualifiable_ref;
    //       //       if (isAttribute_id(reference.reference.ref) || isAttribute_decl(reference.reference.ref)) {
    //       //         // const factor = qualifiedRep.factor as Attribute_ref;
    //       //         // if (!factor.target) return EMPTY_SCOPE;
    //       //         // const attribute = factor.target.ref?.$container as Explicit_attr;
    //       //         // getDataTypesFromAttribute(attribute).forEach((type) =>
    //       //         //   leftSideTypeOptions.push(
    //       //         //     this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node.head })
    //       //         //   )
    //       //         // );
    //       //         const attribute = reference.reference.ref?.$container as Explicit_attr;
    //       //         getDataTypesFromAttribute(attribute).forEach((type) =>
    //       //           leftSideTypeOptions.push(
    //       //             this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node.head })
    //       //           )
    //       //         );
    //       //       }
    //       //       break;
    //       //   }
    //       // }
    //     }
    //     return this.createScope(leftSideTypeOptions);
    //   }

    //   //we are looking at an Attribute reference
    //   if (isAttribute_qualifier(context.container)) {
    //     const attributesInScope: AstNodeDescription[] = [];
    //     const dataTypesInScope: EntityDefinition[] = [];

    //     //if we are looking an attribute_qualifier ...

    //     if (
    //       isComplex_Primary_body(context.container.$container) ||
    //       isAssignment_stmt_body(context.container.$container)
    //     ) {
    //       const qualifiedRep = context.container.$container;
    //       const index = qualifiedRep.qualifiers.indexOf(context.container as Attribute_qualifier);
    //       if (index > 0) {
    //         //we can now look at the previous qualifier (expression to the left of the attribute ref) to figure out what the scope will be
    //         const leftSideExpression = qualifiedRep.qualifiers[index - 1] as AstNode;
    //         /*
    //           Section 12.7.3 Attribute references
    //           "if the expression to the left of the attribute reference evaluates to a partial complex entity value
    //           then the attribute name to the right of the attribute reference shall occur within
    //           the entity declaration for that partial complex entity data type"
    //         */
    //         if (isGroup_qualifier(leftSideExpression)) {
    //           const entity = (leftSideExpression as Group_qualifier).entity.ref;
    //           if (entity) dataTypesInScope.push(entity);
    //         }

    //         /*
    //           Section 12.7.3 Attribute references
    //           "if the declared type of the expression to the left of the attribute reference is an entity data type
    //           then the attribute name to the right of the attribute reference shall be declared
    //           in that entity data type, a supertype or subtype of that entity data type."
    //         */
    //         if (isAttribute_qualifier(leftSideExpression)) {
    //           const attribute = (leftSideExpression as Attribute_qualifier).target.ref?.$container as Explicit_attr;
    //           getDataTypesFromAttribute(attribute, this.p11References).forEach((type) =>
    //             dataTypesInScope.push(type.node)
    //           );
    //         }
    //         //TODO Index qualifier
    //       }

    //       if (index == 0) {
    //         if (isComplex_Primary_body(qualifiedRep)) {
    //           const head = (qualifiedRep as Complex_Primary_body).$container.head;
    //           if (isComplex_Primary_reference(head)) {
    //             if (!head.to.ref) return EMPTY_SCOPE;
    //             switch (head.to.ref.$type) {
    //               case Parameter_id:
    //                 getDataTypesFromParameterId(head.to.ref as Parameter_id, this.p11References).forEach((t) =>
    //                   dataTypesInScope.push(t.node)
    //                 );
    //                 break;
    //             }
    //           }
    //           if (isBuilt_in_constant_or_function(head)) {
    //             const builtIn = head as string;
    //             switch (builtIn.toLowerCase()) {
    //               case "self":
    //                 const localEntity = getContainerOfType(qualifiedRep, isEntityDefinition);
    //                 if (localEntity) {
    //                   dataTypesInScope.push(localEntity);
    //                   this.cache
    //                     .getFullSubSuperGraph(localEntity, this.p11References, [
    //                       localEntity.$container.$document?.uri.toString() ?? "unknown",
    //                     ])
    //                     .forEach((e) => dataTypesInScope.push(e.node));
    //                 }
    //                 break;
    //             }
    //           }
    //         }
    //         if (isAssignment_stmt_body(qualifiedRep)) {
    //           const statement = qualifiedRep as Assignment_stmt_body;
    //           const leftSideExpression = statement.$container.head;
    //           if (!leftSideExpression || !isProcedure_call_Or_Assigment_stmt_reference(leftSideExpression))
    //             return EMPTY_SCOPE;
    //           const typedHead = leftSideExpression as Procedure_call_Or_Assigment_stmt_reference;
    //           switch (typedHead.to.ref?.$type) {
    //             case Parameter_id:
    //               getDataTypesFromParameterId(typedHead.to.ref as Parameter_id, this.p11References).forEach((t) =>
    //                 dataTypesInScope.push(t.node)
    //               );
    //               break;
    //           }
    //         }

    //         //console.log(`in ${qualifiedRep.$type} with ${factor.$type}`);
    //       }
    //     }

    //     if (isQualified_attribute(context.container.$container)) {
    //       const group = (context.container.$container as Qualified_attribute).group;
    //       if (group) {
    //         const entity = group.entity.ref;
    //         if (entity) dataTypesInScope.push(entity);
    //       }
    //     }

    //     if (isAlias_stmt(context.container.$container)) {
    //     }

    //     dataTypesInScope.forEach((entity) => {
    //       getExplicitAttributeDeclarations(entity).forEach((explicitAttr) => {
    //         getAttributeDeclarations(explicitAttr).forEach((attribute) => {
    //           const name = getAttributeName(attribute);
    //           if (!name) return;
    //           attributesInScope.push(this.descriptions.createDescription(attribute, name));
    //         });
    //       });
    //     });
    //     return this.createScope(attributesInScope.filter((e) => this.reflection.isSubtype(e.type, referenceType)));
    //   }

    //   if (context.property === "reference") {
    //     // if (isQualifiable_ref(context.container)) {
    //     //   const functionScope = getContainerOfType(context.container, isFunction_decl);
    //     //   if (functionScope) {
    //     //     const parametersInScope: AstNodeDescription[] = [];
    //     //     getFunctionParameters(functionScope).forEach((param) =>
    //     //       parametersInScope.push(this.descriptions.createDescription(param, param.name))
    //     //     );
    //     //     // console.log(`in Function ${functionScope.head.name} with ${parametersInScope.length} for ${referenceType}`);
    //     //     return this.createScope(parametersInScope);
    //     //   }
    //     // }
    //   }

    //   return super.getScope(context);
    // } catch (error) {
    //   console.log(error);
    //   return EMPTY_SCOPE;
    // }
  }

  private getAttributesInScope(entity: EntityDefinition, context: ReferenceInfo): Scope {
    if (!entity || !context) return EMPTY_SCOPE;
    const simulatedContext = {
      ...context,
      container: { ...context.container, container: entity, $container: entity },
    };

    return super.getScope(simulatedContext);
  }

  private newCaseInsensitiveScope(stream: Stream<AstNodeDescription>, outerScope: Scope | undefined = undefined) {
    return new StreamScope(stream, outerScope, { caseInsensitive: true });
  }
}
