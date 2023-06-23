import {
  AstNode,
  AstNodeDescription,
  DefaultScopeProvider,
  EMPTY_SCOPE,
  ReferenceInfo,
  Scope,
  getContainerOfType,
  getDocument,
} from "langium";
import {
  Assignment_stmt_core,
  // Assignment_stmt_core,
  Attribute_decl,
  Attribute_qualifier,
  Complex_Primary_body,
  // Attribute_qualifier,
  // Constant_factor,
  Entity_decl,
  Entity_head,
  Explicit_attr,
  Group_qualifier,
  Inverse_attr,
  Parameter_id,
  Procedure_call_Or_Assigment_stmt_ref,
  // Entity_head,
  // Explicit_attr,
  // Group_qualifier,
  // Parameter_id,
  // Procedure_call_Or_Assigment_stmt_ref,
  // Qualifiable_ref,
  // Qualified_Rep,
  Qualified_attribute,
  Reference_clause,
  Schema_decl,
  isAlias_stmt,
  isAssignment_stmt_core,
  // isAssignment_stmt_core,
  // isAttribute_decl,
  // isAttribute_id,
  isAttribute_qualifier,
  //@ts-ignore
  isAttribute_ref,
  isBuilt_in_constant_or_function,
  isComplex_Primary_body,
  isComplex_Primary_id,
  isDerived_attr,
  isEntity_decl,
  isExplicit_attr,
  isFunction_decl,
  //@ts-ignore
  isGeneral_ref,
  isGroup_qualifier,
  isInverse_attr,
  //@ts-ignore
  isPrimary,
  //@ts-ignore
  isQualifiable_factor,
  // isQualifiable_ref,
  // isQualified_Rep,
  isQualified_attribute,
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
  // getDataTypesFromAttribute,
  // getDataTypesFromParameterId,
  getExplicitAttributeDeclarations,
  getSuperTypes,
} from "../utils/entity-helpers";
import {
  getFunctionLocalConstants,
  getFunctionLocalVariables,
  getFunctionParameters,
  getStatementVariables,
} from "../utils/function-helpers";
import { isProcedure_call_Or_Assigment_stmt_ref } from "./generated/ast";

export type CustomExpressDescription<T> = {
  nameInScope: string;
  node: T;
};

export class ExpressP11ScopeProvider extends DefaultScopeProvider {
  //TODO: manage renamed resources
  toAstNodeDescription(customExpressDescription: CustomExpressDescription<AstNode>): AstNodeDescription {
    return this.descriptions.createDescription(customExpressDescription.node, customExpressDescription.nameInScope);
  }
  getImportedTypes(schema: Schema_decl, referenceType: string): AstNodeDescription[] {
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
    const referenceType = this.reflection.getReferenceType(context);
    // console.log(
    //   `need ${referenceType} for ${context.property} of ${context.container.$container?.$type} \ ${context.container.$type}`
    // );
    if (
      isResource_or_rename(context.container) &&
      isReference_clause(context.container.$container) &&
      context.property === "resource"
    ) {
      const schema = (context.container.$container as Reference_clause).schema;
      if (schema.ref) {
        const schemaName = schema.ref.name;
        if (schemaName) {
          const precomputed = getDocument(schema.ref).precomputedScopes;

          const elements = precomputed?.get(schema.ref).filter((e) => this.reflection.isSubtype(e.type, referenceType));
          if (elements) {
            const scope = this.createScope(elements);
            return scope;
          }
        }
      } else {
        return EMPTY_SCOPE;
      }
    }

    // a complex_primary_ref is needed
    if (isComplex_Primary_id(context.container)) {
      const options: AstNodeDescription[] = [];

      const contextIsFunction = getContainerOfType(context.container, isFunction_decl);
      if (contextIsFunction) {
        if (contextIsFunction) {
          getFunctionParameters(contextIsFunction).forEach((param) =>
            options.push(this.descriptions.createDescription(param, param.name))
          );
          getFunctionLocalVariables(contextIsFunction).forEach((variable) =>
            options.push(this.descriptions.createDescription(variable, variable.name))
          );
          getFunctionLocalConstants(contextIsFunction).forEach((constant) =>
            options.push(this.descriptions.createDescription(constant, constant.name))
          );
          getStatementVariables(context.container, isFunction_decl).forEach((variable) =>
            options.push(this.descriptions.createDescription(variable, variable.name))
          );
        }
      }

      const contextIsEntity = getContainerOfType(context.container, isEntity_decl);
      if (contextIsEntity) {
        const attributes: Attribute_decl[] = [];
        getExplicitAttributeDeclarations(contextIsEntity).forEach((explicitAttribute) =>
          getAttributeDeclarations(explicitAttribute).forEach((attributeDeclaration) =>
            attributes.push(attributeDeclaration)
          )
        );

        getDerivedAttributes(contextIsEntity).forEach((derivedAttribute) =>
          attributes.push(derivedAttribute.attribute)
        );

        attributes
          .map((attribute) => this.descriptions.createDescription(attribute, attribute.name))
          .filter((e) => this.reflection.isSubtype(e.type, referenceType))
          .forEach((s) => options.push(s));

        getStatementVariables(context.container, isEntity_decl).forEach((variable) =>
          options.push(this.descriptions.createDescription(variable, variable.name))
        );
      }

      super
        .getScope(context)
        .getAllElements()
        .filter((e) => this.reflection.isSubtype(e.type, referenceType))
        .forEach((e) => options.push(e));

      return this.createScope(options);
    }

    //Inverse attribute
    if (context.property === "forAttribute" && isInverse_attr(context.container)) {
      const inverseAttribute = context.container as Inverse_attr;
      const ofType = inverseAttribute.forEntity ? inverseAttribute.forEntity : inverseAttribute.ofEntity;
      if (ofType.error || !ofType.ref) return EMPTY_SCOPE;
      const elementsInScope: AstNodeDescription[] = [];
      getExplicitAttributeDeclarations(ofType.ref.$container as Entity_decl).forEach((explicitAttribute) =>
        getAttributeDeclarations(explicitAttribute).forEach((attribute) =>
          elementsInScope.push(this.descriptions.createDescription(attribute, attribute.name))
        )
      );
      return this.createScope(elementsInScope);
    }

    if (
      // isQualifiable_ref(context.container) ||
      isGeneral_ref(context.container) ||
      isProcedure_call_Or_Assigment_stmt_ref(context.container)
    ) {
      const scope: AstNodeDescription[] = [];
      const entityContext = getContainerOfType(context.container, isEntity_decl);
      if (entityContext) {
        const attributes: Attribute_decl[] = [];
        getExplicitAttributeDeclarations(entityContext).forEach((explicitAttribute) =>
          getAttributeDeclarations(explicitAttribute).forEach((attributeDeclaration) =>
            attributes.push(attributeDeclaration)
          )
        );

        attributes
          .map((attribute) => this.descriptions.createDescription(attribute, attribute.name))
          .filter((e) => this.reflection.isSubtype(e.type, referenceType))
          .forEach((s) => scope.push(s));
        return this.createScope(scope);
      }

      const functionContext = getContainerOfType(context.container, isFunction_decl);
      if (functionContext) {
        if (functionContext) {
          getFunctionParameters(functionContext).forEach((param) =>
            scope.push(this.descriptions.createDescription(param, param.name))
          );
          getFunctionLocalVariables(functionContext).forEach((variable) =>
            scope.push(this.descriptions.createDescription(variable, variable.name))
          );
          // console.log(`in Function ${functionScope.head.name} with ${parametersInScope.length} for ${referenceType}`);
          return this.createScope(scope);
        }
      }

      return EMPTY_SCOPE;
    }

    /*
      Section 12.7.4 Group references
      The group reference (\) provides a reference to a partial complex entity value within a complex entity instance.
      The expression to the left of the group reference shall evaluate to a complex entity instance.
      The entity data type of the partial complex entity value to be referenced is specified following the reverse solidus(\).
    */
    if (isGroup_qualifier(context.container)) {
      const leftSideTypeOptions: AstNodeDescription[] = [];

      // SELF\Entity.attribute
      //        ^
      //        |
      //        |
      if (isQualified_attribute(context.container.$container)) {
        const leftEntityDataType = getContainerOfType(context.container, isEntity_decl);
        getSuperTypes(leftEntityDataType).forEach((supertype) => {
          leftSideTypeOptions.push(
            this.toAstNodeDescription({ nameInScope: supertype.nameInScope, node: supertype.node.head })
          );
        });
      }

      // Qualified_Rep:(factor=Qualifiable_factor qualifiers+=Qualifier*);
      // Qualifier: ...| Group_qualifier(\Y) | ... ;
      // Qualifiable_factor: Constant_factor  | Attribute_ref |  General_ref | Population | Function_call;
      //                          (1)               (2)               (3)         (4)           (5)
      if (isComplex_Primary_body(context.container.$container)) {
        const complexbody = context.container.$container;
        const index = complexbody.qualifiers.indexOf(context.container as Group_qualifier);
        if (index > 0) return EMPTY_SCOPE;
        if (isComplex_Primary_id(complexbody.$container.head)) {
          if (!complexbody.$container.head.to.ref) return EMPTY_SCOPE;
          const head = complexbody.$container.head.to.ref;
          switch (head.$type) {
            case "Attribute_id":
              if (!isExplicit_attr(head.$container) && !isDerived_attr(head.$container)) return EMPTY_SCOPE;
              const attribute = head.$container; //reference.reference.ref?.$container as Explicit_attr;
              getDataTypesFromAttribute(attribute).forEach((type) =>
                leftSideTypeOptions.push(
                  this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node.head })
                )
              );
              break;
          }
        } else {
          switch (complexbody.$container.head) {
            case "SELF":
              const entity = getContainerOfType(context.container, isEntity_decl);
              if (entity) {
                getSuperTypes(entity).forEach((supertype) => {
                  leftSideTypeOptions.push(
                    this.toAstNodeDescription({ nameInScope: supertype.nameInScope, node: supertype.node.head })
                  );
                });
              }
              break;
          }
        }

        // if (qualifiedRep.factor) {
        //   switch (qualifiedRep.factor.$type) {
        //     // (1) Constant_factor
        //     case Constant_factor:
        //       //TODO: for now we only support built-in constant
        //       const constant = qualifiedRep.factor as Constant_factor;
        //       if (constant.constant === "SELF") {
        //         const entity = getContainerOfType(context.container, isEntity_decl);
        //         if (entity) {
        //           getSuperTypes(entity).forEach((supertype) => {
        //             leftSideTypeOptions.push(
        //               this.toAstNodeDescription({ nameInScope: supertype.nameInScope, node: supertype.node.head })
        //             );
        //           });
        //         }
        //       }
        //       break;
        //     // (2) Attribute_ref
        //     //case Attribute_ref:
        //     case Qualifiable_ref:
        //       const reference = qualifiedRep.factor as Qualifiable_ref;
        //       if (isAttribute_id(reference.reference.ref) || isAttribute_decl(reference.reference.ref)) {
        //         // const factor = qualifiedRep.factor as Attribute_ref;
        //         // if (!factor.target) return EMPTY_SCOPE;
        //         // const attribute = factor.target.ref?.$container as Explicit_attr;
        //         // getDataTypesFromAttribute(attribute).forEach((type) =>
        //         //   leftSideTypeOptions.push(
        //         //     this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node.head })
        //         //   )
        //         // );
        //         const attribute = reference.reference.ref?.$container as Explicit_attr;
        //         getDataTypesFromAttribute(attribute).forEach((type) =>
        //           leftSideTypeOptions.push(
        //             this.toAstNodeDescription({ nameInScope: type.nameInScope, node: type.node.head })
        //           )
        //         );
        //       }
        //       break;
        //   }
        // }
      }
      return this.createScope(leftSideTypeOptions);
    }

    //we are looking at an Attribute reference
    if (isAttribute_qualifier(context.container)) {
      const attributesInScope: AstNodeDescription[] = [];
      const dataTypesInScope: Entity_decl[] = [];

      //if we are looking an attribute_qualifier ...

      if (
        isComplex_Primary_body(context.container.$container) ||
        isAssignment_stmt_core(context.container.$container)
      ) {
        const qualifiedRep = context.container.$container;
        const index = qualifiedRep.qualifiers.indexOf(context.container as Attribute_qualifier);
        if (index > 0) {
          //we can now look at the previous qualifier (expression to the left of the attribute ref) to figure out what the scope will be
          const leftSideExpression = qualifiedRep.qualifiers[index - 1] as AstNode;
          /*
            Section 12.7.3 Attribute references
            "if the expression to the left of the attribute reference evaluates to a partial complex entity value
            then the attribute name to the right of the attribute reference shall occur within
            the entity declaration for that partial complex entity data type"
          */
          if (isGroup_qualifier(leftSideExpression)) {
            const entity = (leftSideExpression as Group_qualifier).entity.ref as Entity_head;
            if (entity) dataTypesInScope.push(entity.$container as Entity_decl);
          }

          /*
            Section 12.7.3 Attribute references
            "if the declared type of the expression to the left of the attribute reference is an entity data type
            then the attribute name to the right of the attribute reference shall be declared
            in that entity data type, a supertype or subtype of that entity data type."
          */
          if (isAttribute_qualifier(leftSideExpression)) {
            const attribute = (leftSideExpression as Attribute_qualifier).target.ref?.$container as Explicit_attr;
            getDataTypesFromAttribute(attribute).forEach((type) => dataTypesInScope.push(type.node));
          }
          //TODO Index qualifier
        }

        if (index == 0) {
          if (isComplex_Primary_body(qualifiedRep)) {
            const head = (qualifiedRep as Complex_Primary_body).$container.head;
            if (isComplex_Primary_id(head)) {
              if (!head.to.ref) return EMPTY_SCOPE;
              switch (head.to.ref.$type) {
                case Parameter_id:
                  getDataTypesFromParameterId(head.to.ref as Parameter_id).forEach((t) =>
                    dataTypesInScope.push(t.node)
                  );
                  break;
              }
            }
            if (isBuilt_in_constant_or_function(head)) {
              const builtIn = head as string;
              switch (builtIn.toLowerCase()) {
                case "self":
                  const localEntity = getContainerOfType(qualifiedRep, isEntity_decl);
                  if (localEntity) {
                    dataTypesInScope.push(localEntity);
                    getSuperTypes(localEntity).forEach((e) => dataTypesInScope.push(e.node));
                  }
                  break;
              }
            }
          }
          if (isAssignment_stmt_core(qualifiedRep)) {
            const statement = qualifiedRep as Assignment_stmt_core;
            const leftSideExpression = statement.$container.head;
            if (!leftSideExpression || !isProcedure_call_Or_Assigment_stmt_ref(leftSideExpression)) return EMPTY_SCOPE;
            const typedHead = leftSideExpression as Procedure_call_Or_Assigment_stmt_ref;
            switch (typedHead.to.ref?.$type) {
              case Parameter_id:
                getDataTypesFromParameterId(typedHead.to.ref as Parameter_id).forEach((t) =>
                  dataTypesInScope.push(t.node)
                );
                break;
            }
          }

          //console.log(`in ${qualifiedRep.$type} with ${factor.$type}`);
        }
      }

      if (isQualified_attribute(context.container.$container)) {
        const group = (context.container.$container as Qualified_attribute).group;
        if (group) {
          const entity = group.entity.ref?.$container as Entity_decl;
          if (entity) dataTypesInScope.push(entity);
        }
      }

      if (isAlias_stmt(context.container.$container)) {
      }

      dataTypesInScope.forEach((entity) => {
        getExplicitAttributeDeclarations(entity).forEach((explicitAttr) => {
          getAttributeDeclarations(explicitAttr).forEach((attribute) => {
            const name = getAttributeName(attribute);
            if (!name) return;
            attributesInScope.push(this.descriptions.createDescription(attribute, name));
          });
        });
      });
      return this.createScope(attributesInScope.filter((e) => this.reflection.isSubtype(e.type, referenceType)));
    }

    if (context.property === "reference") {
      // if (isQualifiable_ref(context.container)) {
      //   const functionScope = getContainerOfType(context.container, isFunction_decl);
      //   if (functionScope) {
      //     const parametersInScope: AstNodeDescription[] = [];
      //     getFunctionParameters(functionScope).forEach((param) =>
      //       parametersInScope.push(this.descriptions.createDescription(param, param.name))
      //     );
      //     // console.log(`in Function ${functionScope.head.name} with ${parametersInScope.length} for ${referenceType}`);
      //     return this.createScope(parametersInScope);
      //   }
      // }
    }

    return super.getScope(context);
  }
}
