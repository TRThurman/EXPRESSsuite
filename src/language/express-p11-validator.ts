import {
  AstNode,
  AstUtils,
  isReference,
  LangiumDocuments,
  MultiMap,
  NameProvider,
  ReferenceInfo,
  References,
  ValidationAcceptor,
  ValidationChecks,
  isNamed,
} from "langium";
import {
  Assignment_stmt_body,
  Attribute_decl,
  Attribute_qualifier,
  Complex_Primary_body,
  EntityDefinition,
  ExpressAstType,
  Local_decl,
  Reference_clause,
  SchemaDefinition,
  Use_clause,
  isAttribute_decl,
  isConstant_body,
  isDerived_attr,
  isEntityDefinition,
  isExplicit_attr,
  isFunction_head,
  isIndex_qualifier,
  isInverse_attr,
  isProcedure_call_Or_Assigment_stmt_reference,
  isRedeclared_attribute,
  isIncrement_control,
  isProcedure_head,
  isReference_clause,
  isResource_or_rename,
  isSchemaDefinition,
  isTypeDefinition,
  isUse_clause,
} from "./generated/ast.js";
import type { ExpressP11Services } from "./express-module.js";
import { schemaHasDeclarations } from "../utils/schema-helpers.js";
import { getReferenceSpecifications, getUseSpecifications } from "../utils/interface-helpers.js";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { ExpressP11ScopeProvider, ScopeType } from "./express-p11-scope-provider.js";
import { ExpressTypeBuilder } from "./type-system/express-type-builder.js";
import { mentionsExtensibleSelect, notIndexableClosed, renderType, spec } from "./type-system/express-type-model.js";

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ExpressP11Services) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.ExpressP11Validator;
  const checks: ValidationChecks<ExpressAstType> = {
    Assignment_stmt_body: validator.checkIndexQualifierOperands,
    Attribute_decl: validator.checkAttributeNameStartsWithLowerCase,
    Attribute_qualifier: validator.checkAmbiguousAttributeReference,
    Complex_Primary_body: validator.checkIndexQualifierOperands,
    EntityDefinition: validator.checkRedeclaredAttributeTypes,
    Local_decl: validator.checkLocalVariablesDoNotDuplicateLoopIndices,
    SchemaDefinition: [
      validator.checkUniqueEntityName,
      validator.checkReferencesAreImported,
      validator.checkDeclarationNameCasing,
    ],
  };
  registry.register(checks, validator);
}

export enum ExpressP11Issues {
  ReferenceStatementIncomplete = "reference-statement-incomplete",
  ReferenceStatementMissing = "reference-statement-missing",
  WrongReferenceLabel = "wrong-reference-label",
  DeclarationNameCase = "declaration-name-case",
  DuplicateLoopIndex = "duplicate-loop-index",
  RedeclarationNotSpecialization = "redeclaration-not-specialization",
  IndexOnNonAggregate = "index-on-non-aggregate",
  AmbiguousAttributeReference = "ambiguous-attribute-reference",
}

export type RedeclarationData = {
  attribute: string;
  newType: string;
  originalType: string;
};

export type IndexOperandData = {
  operandType: string;
};

export type AmbiguousAttributeData = {
  attribute: string;
  operand: string;
  declaredIn: string[];
};

export type WrongReferenceLabelData = {
  expectedReference: string;
};

export type DeclarationNameCaseData = {
  expectedName: string;
};

export type ReferenceStatementData = {
  schema: string;
  resource: string;
  sourceSchema: string;
};
type NamedNode = { name: string; node: AstNode };
type SchemaName = string;
/**
 * Implementation of custom validations.
 */
export class ExpressP11Validator {
  protected readonly references: References;
  protected readonly documents: LangiumDocuments;
  protected readonly nameProvider: NameProvider;
  protected readonly typeContainer: ExpressP11TypeContainer;
  protected readonly typeBuilder: ExpressTypeBuilder;
  protected readonly scopeProvider: ExpressP11ScopeProvider;

  constructor(services: ExpressP11Services) {
    this.references = services.references.References;
    this.documents = services.shared.workspace.LangiumDocuments;
    this.nameProvider = services.references.NameProvider;
    this.typeContainer = services.validation.TypeContainer;
    this.typeBuilder = new ExpressTypeBuilder(services.validation.TypeContainer, services.shared.workspace.SelectExtensionIndex);
    this.scopeProvider = services.references.ScopeProvider as ExpressP11ScopeProvider;
  }

  /**
   * ISO 10303-11:2004 12.7.3, last sentence: "If two or more attributes are
   * found with the same name then the reference is ambiguous and indeterminate
   * (?) is returned." Reported for an entity-typed operand when the nearest
   * depth of the 12.7.3 walk that declares the name holds declarations in two
   * or more entities (multiple inheritance); a diamond inheriting one
   * declaration along two paths is not ambiguous. The linker still binds the
   * first candidate so that hover and navigation keep working. The NOTE of
   * 12.7.3 recommends a group reference to select one. Select-typed operands
   * are not reported: a select of entities with same-named attributes is the
   * common case in SMRL and the standard's own NOTE names it.
   */
  checkAmbiguousAttributeReference(qualifier: Attribute_qualifier, accept: ValidationAcceptor): void {
    const operand = this.scopeProvider.getQualifierOperand(qualifier);
    if (!operand || operand.type !== ScopeType.Entities) return;
    const entities = operand.nodes.filter(isEntityDefinition);
    if (entities.length !== 1) return;
    const name = qualifier.target.$refText;
    const nearest = this.typeContainer
      .getVisibleAttributeCandidates(entities[0], name)
      .map((level) => level.declarations.filter((declaration) => this.nameProvider.getName(declaration) === name))
      .find((declarations) => declarations.length > 0);
    if (!nearest) return;
    const owners = new Map<EntityDefinition, string>();
    for (const declaration of nearest) {
      const owner = AstUtils.getContainerOfType(declaration, isEntityDefinition);
      if (owner) owners.set(owner, owner.name);
    }
    if (owners.size < 2) return;
    const data: AmbiguousAttributeData = { attribute: name, operand: entities[0].name, declaredIn: [...owners.values()] };
    accept(
      "warning",
      `Attribute reference '${name}' is ambiguous for an operand of type ${data.operand}: it is declared in ${data.declaredIn.join(" and ")} at the same depth, so the reference evaluates to indeterminate (ISO 10303-11:2004 12.7.3). Qualify it with a group reference, as in x\\${data.declaredIn[0]}.${name}.`,
      { node: qualifier, property: "target", code: ExpressP11Issues.AmbiguousAttributeReference, data }
    );
  }

  /**
   * ISO 10303-11:2004 9.2.3.4 a): the type of a redeclared attribute shall be the
   * same as, or a specialization (9.2.7) of, the original attribute's type. The
   * relation is `spec` from the type model, proved sound in
   * lean/ExpressSuite/Soundness.lean; defined types and selects are seen
   * through on both sides, and select extensions in the workspace are folded in.
   * Nothing is reported when either type lies outside the proved domain.
   */
  checkRedeclaredAttributeTypes(entity: EntityDefinition, accept: ValidationAcceptor): void {
    if (!entity.body) return;
    const owners: Array<{ node: AstNode; declarations: Attribute_decl[]; type: unknown }> = [];
    for (const explicit of entity.body.attributes) owners.push({ node: explicit, declarations: explicit.attributes, type: explicit.type });
    for (const derived of entity.body.derived?.attributes ?? []) owners.push({ node: derived, declarations: [derived.attribute], type: derived.type });
    for (const owner of owners) {
      for (const declaration of owner.declarations) {
        if (!isRedeclared_attribute(declaration)) continue;
        const original = declaration.qualifiedAttribute.attribute.target.ref;
        if (!original || !isAttribute_decl(original)) continue;
        const originalOwner = original.$container;
        if (!isExplicit_attr(originalOwner) && !isDerived_attr(originalOwner) && !isInverse_attr(originalOwner)) continue;
        const newType = this.typeBuilder.ofType(owner.type as Parameters<ExpressTypeBuilder["ofType"]>[0]);
        const originalType = this.typeBuilder.ofAttribute(original);
        if (!newType || !originalType) continue;
        if (spec(newType, originalType)) continue;
        const attributeName = declaration.name ?? declaration.qualifiedAttribute.attribute.target.$refText;
        const data: RedeclarationData = { attribute: attributeName, newType: renderType(newType), originalType: renderType(originalType) };
        // An EXTENSIBLE select may have extensions outside the workspace that
        // would admit the new type, so the verdict is then only a warning.
        const severity = mentionsExtensibleSelect(originalType) ? "warning" : "error";
        accept(
          severity,
          `Redeclared attribute '${attributeName}' has type ${data.newType}, which is not a specialization of the original type ${data.originalType} (ISO 10303-11:2004 9.2.3.4, 9.2.7).`,
          { node: owner.node, property: "type", code: ExpressP11Issues.RedeclarationNotSpecialization, data }
        );
      }
    }
  }

  /**
   * ISO 10303-11:2004 12.6.1 (aggregate), 12.5.1 (string) and 12.3.1 (binary)
   * indexing: the indexed operand shall be an aggregate, string or binary
   * value. Reported only when the declared type of the operand can hold none
   * of these (`notIndexable` in lean/ExpressSuite/IndexOperand.lean) and no
   * EXTENSIBLE select is involved; unknown types are not reported.
   */
  checkIndexQualifierOperands(body: Complex_Primary_body | Assignment_stmt_body, accept: ValidationAcceptor): void {
    const qualifiers = body.qualifiers ?? [];
    if (!qualifiers.some(isIndex_qualifier)) return;
    const head = isProcedure_call_Or_Assigment_stmt_reference(body.$container.head) ? body.$container.head.to.ref : body.$container.head;
    let current =
      typeof head === "string" || head === undefined
        ? this.typeBuilder.ofHead(head ?? "", "parameterList" in body && Boolean(body.parameterList), body)
        : isProcedure_call_Or_Assigment_stmt_reference(body.$container.head)
          ? this.typeBuilder.ofDeclaration(head)
          : this.typeBuilder.ofHead(body.$container.head as Parameters<ExpressTypeBuilder["ofHead"]>[0], "parameterList" in body && Boolean(body.parameterList), body);
    qualifiers.forEach((qualifier, index) => {
      if (isIndex_qualifier(qualifier) && current && notIndexableClosed(current)) {
        const data: IndexOperandData = { operandType: renderType(current) };
        accept("error", `Index applied to an operand of type ${data.operandType}, which is neither an aggregate nor a string or binary value (ISO 10303-11:2004 12.6.1, 12.5.1, 12.3.1).`, {
          node: body,
          property: "qualifiers",
          index,
          code: ExpressP11Issues.IndexOnNonAggregate,
          data,
        });
      }
      current = this.typeBuilder.afterQualifier(current, qualifier);
    });
  }

  checkAttributeNameStartsWithLowerCase(attribute: Attribute_decl, accept: ValidationAcceptor): void {
    if (!isNamed(attribute)) return;
    try {
      const attributeName = this.nameProvider.getName(attribute);
      if (attributeName) {
        const firstChar = attributeName.substring(0, 1);
        if (firstChar.toLowerCase() !== firstChar) {
          accept("warning", "Attribute name should start with a lower case.", {
            node: attribute,
          });
        }
      }
    } catch {
      return;
    }
  }

  checkUniqueEntityName(schema: SchemaDefinition, accept: ValidationAcceptor): void {
    const reported = new Set();
    if (!schemaHasDeclarations(schema)) return;
    // var allDeclarations: Declaration[] = schema.body.declarations.filter(
    //   (d) => d.$type == "Declaration"
    // ) as Declaration[];
    const entityDeclarations = schema.body.declarations.filter((d) => isEntityDefinition(d)) as EntityDefinition[];
    entityDeclarations.forEach((e) => {
      if (reported.has(e.name)) {
        accept("error", `Entity has non-unique name '${e.name}'.`, {
          node: e,
          property: "name",
        });
      }
      reported.add(e.name);
    });
  }

  checkDeclarationNameCasing(schema: SchemaDefinition, accept: ValidationAcceptor): void {
    if (!schemaHasDeclarations(schema)) return;
    const isArmSchema = schema.name.toLowerCase().endsWith("_arm");

    for (const declaration of schema.body.declarations) {
      if (!isEntityDefinition(declaration) && !isTypeDefinition(declaration)) continue;
      let expectedName: string;
      let kind: "Entity" | "Type";
      if (isEntityDefinition(declaration)) {
        kind = "Entity";
        expectedName = isArmSchema
          ? declaration.name.charAt(0).toUpperCase() + declaration.name.slice(1)
          : declaration.name.toLowerCase();
      } else {
        kind = "Type";
        expectedName = declaration.name.toLowerCase();
      }

      if (declaration.name === expectedName) continue;
      const data: DeclarationNameCaseData = { expectedName };
      accept("info", `${kind} name should be '${expectedName}'.`, {
        node: declaration,
        property: "name",
        code: ExpressP11Issues.DeclarationNameCase,
        data,
      });
    }
  }

  checkLocalVariablesDoNotDuplicateLoopIndices(local: Local_decl, accept: ValidationAcceptor): void {
    const algorithm = local.$container.$container;
    const loopIndices = new Set<string>();

    for (const statement of algorithm.stmts) {
      for (const node of AstUtils.streamAst(statement)) {
        if (isIncrement_control(node)) {
          loopIndices.add(node.var.name.toLowerCase());
        }
      }
    }

    for (const declaration of local.variables) {
      for (const variable of declaration.ids) {
        if (!loopIndices.has(variable.name.toLowerCase())) continue;
        accept("error", `Local variable '${variable.name}' duplicates an implicitly declared loop index.`, {
          node: variable,
          property: "name",
          code: ExpressP11Issues.DuplicateLoopIndex,
        });
      }
    }
  }

  private buildImportedResourcesIndex(listOfReferenceFromClauses: Reference_clause[]): MultiMap<SchemaName, NamedNode> {
    const importedResources = new MultiMap<SchemaName, NamedNode>();
    listOfReferenceFromClauses.forEach((referenceFrom) => {
      //if (!referenceFrom.schema.ref) return;
      //referenceClauses.set(referenceFrom.schema.$refText, referenceFrom);
      referenceFrom.resources.forEach((resourceDeclaration) => {
        if (!resourceDeclaration.resource.ref) return;
        const resourceName = resourceDeclaration.isRenamed ? resourceDeclaration.name : resourceDeclaration.resource.$refText;
        if (!resourceName) return;
        importedResources.add(referenceFrom.schema.$refText, {
          name: resourceName,
          node: resourceDeclaration.resource.ref,
        });
      });
    });
    return importedResources;
  }

  private buildUsedResourcesIndex(listOfUseFromClauses: Use_clause[]): MultiMap<SchemaName, NamedNode> {
    const usedResources = new MultiMap<SchemaName, NamedNode>();
    listOfUseFromClauses.forEach((useFrom) => {
      //if (!referenceFrom.schema.ref) return;
      //referenceClauses.set(referenceFrom.schema.$refText, referenceFrom);
      useFrom.resources.forEach((resourceDeclaration) => {
        if (!resourceDeclaration.resource.ref) return;
        const resourceName = resourceDeclaration.isRenamed ? resourceDeclaration.name : resourceDeclaration.resource.$refText;
        if (!resourceName) return;
        usedResources.add(useFrom.schema.$refText, {
          name: resourceName,
          node: resourceDeclaration.resource.ref,
        });
      });
    });
    return usedResources;
  }
  checkReferencesAreImported(schema: SchemaDefinition, accept: ValidationAcceptor): void {
    try {
      const referenceSpecifications = getReferenceSpecifications(schema);
      const useSpecifications = getUseSpecifications(schema);
      if (!schema.name) return;
      const importedResourcesIndex = this.buildImportedResourcesIndex(referenceSpecifications);
      this.buildUsedResourcesIndex(useSpecifications).forEach((value, key) => importedResourcesIndex.add(key, value));
      const fullyImportedSchemas = new Set(
        [...referenceSpecifications, ...useSpecifications]
          .filter((specification) => specification.resources.length === 0)
          .map((specification) => specification.schema.$refText)
      );
      const currentSchemaName = schema.name;
      const currentSchema = this.typeContainer.getSchemas().get(currentSchemaName);
      const visibleDefinitions = new Set<AstNode>();
      if (currentSchema) {
        for (const definitions of this.typeContainer.getAllRessourcesFrom(currentSchema, true).resources.values()) {
          for (const definition of definitions.values()) visibleDefinitions.add(definition.resource.getNode());
        }
      }

      for (const node of AstUtils.streamAst(schema)) {
        AstUtils.streamReferences(node).forEach((resourceNeeded) => {
          if (
            isResource_or_rename(resourceNeeded.container) ||
            isReference_clause(resourceNeeded.container) ||
            isUse_clause(resourceNeeded.container)
          )
            return;

          //console.log(resourceNeeded.reference.ref);
          if (!isReference(resourceNeeded.reference)) return;
          const ref = resourceNeeded.reference;
          if (!ref.$nodeDescription) return;
          const reference = ref.ref;
          if (
            !isEntityDefinition(reference) &&
            !isTypeDefinition(reference) &&
            !isConstant_body(reference) &&
            !isFunction_head(reference) &&
            !isProcedure_head(reference)
          )
            return;

          const schemaNeeded = AstUtils.getContainerOfType(ref.ref, isSchemaDefinition);
          if (!schemaNeeded || !schemaNeeded.name) return;
          if (schemaNeeded.name === currentSchemaName) return;
          if (fullyImportedSchemas.has(schemaNeeded.name)) return;

          const resourceImported = importedResourcesIndex.get(schemaNeeded.name).find((r) => r.node === ref.ref);

          if (!resourceImported) {
            // A declaration reached through the current schema's transitive
            // interface closure does not require another direct import.
            if (visibleDefinitions.has(reference)) return;
            const schemaIsAlreadyImported = importedResourcesIndex.has(schemaNeeded.name);
            this.issueReferenceStatementDiagnostic(currentSchemaName, schemaIsAlreadyImported, schemaNeeded, resourceNeeded, accept);
            return;
          }

          if (resourceImported.name !== resourceNeeded.reference.$refText) {
            this.issueRenameReferenceDiagnostic(resourceImported, accept, resourceNeeded);
            return;
          }
        });
      }
    } catch {
      console.log("ERROR VALIDATION");
    }
  }

  private issueReferenceStatementDiagnostic(
    sourceSchema: string,
    schemaIsAlreadyImported: boolean,
    schemaNeeded: SchemaDefinition,
    resourceNeeded: ReferenceInfo,
    accept: ValidationAcceptor
  ) {
    const data: ReferenceStatementData = {
      schema: schemaNeeded.name,
      resource: resourceNeeded.reference.$refText,
      sourceSchema,
    };
    const code = schemaIsAlreadyImported ? ExpressP11Issues.ReferenceStatementIncomplete : ExpressP11Issues.ReferenceStatementMissing;
    accept("error", "This resource needs to be imported.", {
      node: resourceNeeded.container,
      property: resourceNeeded.property,
      code,
      data,
    });
  }

  private issueRenameReferenceDiagnostic(
    resourceImported: { name: string; node: AstNode },
    accept: ValidationAcceptor,
    resourceNeeded: ReferenceInfo
  ) {
    const data: WrongReferenceLabelData = { expectedReference: resourceImported.name };
    accept("error", `'${resourceNeeded.reference.$refText}' should be referenced as '${resourceImported.name}'`, {
      node: resourceNeeded.container,
      property: resourceNeeded.property,
      code: ExpressP11Issues.WrongReferenceLabel,
      data,
    });
  }
  // checkReferencesAreImportedV2(schema: Schema_decl, accept: ValidationAcceptor): void {
  //   // this.resourceManager.loadImportedResources();

  //   //const referenceFromClauses = getReferenceDeclarations(schema);
  //   if (!schema.name) return;
  //   //this.buildImportedResourcesIndex(referenceFromClauses);
  //   const currentSchemaName = schema.name;
  //   const importedResources = this.resourceManager.getImportedResource(currentSchemaName);
  //   console.log(`in ${currentSchemaName}, we found ${importedResources.length} imports`);
  //   for (const node of AstUtils.streamAst(schema)) {
  //     AstUtils.streamReferences(node).forEach((resourceNeeded) => {
  //       if (isResource_or_rename(resourceNeeded.container) || isReference_clause(resourceNeeded.container)) return;

  //       if (!resourceNeeded.reference.$nodeDescription) return;

  //       const schemaNeeded = AstUtils.getContainerOfType(resourceNeeded.reference.ref, isSchema_decl);
  //       if (!schemaNeeded || !schemaNeeded.name) return;
  //       if (schemaNeeded.name === currentSchemaName) return;

  //       const resourceImported = importedResources.find(
  //         (r) => r.from === schemaNeeded.name && r.node === resourceNeeded.reference.ref
  //       );
  //       // .get(schemaNeeded.name)
  //       // .find((ref) => ref.node === resourceNeeded.reference.ref);

  //       if (!resourceImported) {
  //         const schemaIsAlreadyImported = importedResources.filter((r) => r.from === schemaNeeded.name).length > 0;
  //         this.issueReferenceStatementDiagnostic(schemaIsAlreadyImported, schemaNeeded, resourceNeeded, accept);
  //         return;
  //       }

  //       if (resourceImported.name !== resourceNeeded.reference.$refText) {
  //         this.issueRenameReferenceDiagnostic(resourceImported, accept, resourceNeeded);
  //         return;
  //       }
  //     });
  //   }
  // }
}
