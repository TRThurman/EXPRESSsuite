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
  Attribute_decl,
  EntityDefinition,
  ExpressAstType,
  Reference_clause,
  SchemaDefinition,
  Use_clause,
  isConstant_body,
  isEntityDefinition,
  isFunction_head,
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

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ExpressP11Services) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.ExpressP11Validator;
  const checks: ValidationChecks<ExpressAstType> = {
    Attribute_decl: validator.checkAttributeNameStartsWithLowerCase,
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
}

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
  // protected readonly resourceManager: ExpressP11ResourceManager;

  constructor(services: ExpressP11Services) {
    this.references = services.references.References;
    this.documents = services.shared.workspace.LangiumDocuments;
    this.nameProvider = services.references.NameProvider;
    // this.resourceManager = services.resources.ResourceManager;
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
      const currentSchemaName = schema.name;

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

          const resourceImported = importedResourcesIndex.get(schemaNeeded.name).find((r) => r.node === ref.ref);

          if (!resourceImported) {
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
