import {
  AstNode,
  LangiumDocuments,
  MultiMap,
  NameProvider,
  ReferenceInfo,
  References,
  ValidationAcceptor,
  ValidationChecks,
  getContainerOfType,
  isNamed,
  streamAst,
  streamReferences,
} from "langium";
import {
  Attribute_decl,
  ExpressP11AstType,
  Reference_clause,
  Schema_decl,
  Use_clause,
  isConstant_body,
  isEntity_decl,
  isEntity_head,
  isFunction_head,
  isProcedure_head,
  isReference_clause,
  isResource_or_rename,
  isType_decl,
  isUse_clause,
} from "./generated/ast";
import type { ExpressP11Services } from "./express-p-11-module";
import { Entity_decl } from "./generated/ast";
import { schemaHasDeclarations } from "../utils/schema-helpers";
import { getReferenceSpecifications, getUseSpecifications } from "../utils/interface-helpers";
import { isSchema_decl } from "./generated/ast";

/**
 * Register custom validation checks.
 */
export function registerValidationChecks(services: ExpressP11Services) {
  const registry = services.validation.ValidationRegistry;
  const validator = services.validation.ExpressP11Validator;
  const checks: ValidationChecks<ExpressP11AstType> = {
    Schema_decl: [validator.checkUniqueEntityName, validator.checkReferencesAreImported],
  };
  registry.register(checks, validator);
}

export enum ExpressP11Issues {
  ReferenceStatementIncomplete = "reference-statement-incomplete",
  ReferenceStatementMissing = "reference-statement-missing",
  WrongReferenceLabel = "wrong-reference-label",
}

export type WrongReferenceLabelData = {
  expectedReference: string;
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
    console.log("ExpressP11Validator loaded;");
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
    } catch (e) {
      return;
    }
  }

  checkUniqueEntityName(schema: Schema_decl, accept: ValidationAcceptor): void {
    const reported = new Set();
    if (!schemaHasDeclarations(schema)) return;
    // var allDeclarations: Declaration[] = schema.body.declarations.filter(
    //   (d) => d.$type == "Declaration"
    // ) as Declaration[];
    var entityDeclarations = schema.body.declarations.filter((d) => isEntity_decl(d)) as Entity_decl[];
    entityDeclarations.forEach((e) => {
      if (reported.has(e.head.name)) {
        accept("error", `Entity has non-unique name '${e.head.name}'.`, {
          node: e.head,
          property: "name",
        });
      }
      reported.add(e.head.name);
    });
  }

  private buildImportedResourcesIndex(listOfReferenceFromClauses: Reference_clause[]): MultiMap<SchemaName, NamedNode> {
    const importedResources = new MultiMap<SchemaName, NamedNode>();
    listOfReferenceFromClauses.forEach((referenceFrom) => {
      //if (!referenceFrom.schema.ref) return;
      //referenceClauses.set(referenceFrom.schema.$refText, referenceFrom);
      referenceFrom.resources.forEach((resourceDeclaration) => {
        if (!resourceDeclaration.resource.ref) return;
        const resourceName = resourceDeclaration.isRenamed
          ? resourceDeclaration.name
          : resourceDeclaration.resource.$refText;
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
      useFrom.types.forEach((resourceDeclaration) => {
        if (!resourceDeclaration.namedType.ref) return;
        const resourceName = resourceDeclaration.isRenamed
          ? resourceDeclaration.name
          : resourceDeclaration.namedType.$refText;
        if (!resourceName) return;
        usedResources.add(useFrom.schema.$refText, {
          name: resourceName,
          node: resourceDeclaration.namedType.ref,
        });
      });
    });
    return usedResources;
  }
  checkReferencesAreImported(schema: Schema_decl, accept: ValidationAcceptor): void {
    const referenceSpecifications = getReferenceSpecifications(schema);
    const useSpecifications = getUseSpecifications(schema);
    if (!schema.name) return;
    let importedResourcesIndex = this.buildImportedResourcesIndex(referenceSpecifications);
    this.buildUsedResourcesIndex(useSpecifications).forEach((value, key) => importedResourcesIndex.add(key, value));
    const currentSchemaName = schema.name;

    for (const node of streamAst(schema)) {
      streamReferences(node).forEach((resourceNeeded) => {
        if (
          isResource_or_rename(resourceNeeded.container) ||
          isReference_clause(resourceNeeded.container) ||
          isUse_clause(resourceNeeded.container)
        )
          return;

        //console.log(resourceNeeded.reference.ref);
        if (!resourceNeeded.reference.$nodeDescription) return;
        const reference = resourceNeeded.reference.ref;
        if (
          !isEntity_head(reference) &&
          !isType_decl(reference) &&
          !isConstant_body(reference) &&
          !isFunction_head(reference) &&
          !isProcedure_head(reference)
        )
          return;

        const schemaNeeded = getContainerOfType(resourceNeeded.reference.ref, isSchema_decl);
        if (!schemaNeeded || !schemaNeeded.name) return;
        if (schemaNeeded.name === currentSchemaName) return;

        const resourceImported = importedResourcesIndex
          .get(schemaNeeded.name)
          .find((ref) => ref.node === resourceNeeded.reference.ref);

        if (!resourceImported) {
          const schemaIsAlreadyImported = importedResourcesIndex.has(schemaNeeded.name);
          this.issueReferenceStatementDiagnostic(
            currentSchemaName,
            schemaIsAlreadyImported,
            schemaNeeded,
            resourceNeeded,
            accept
          );
          return;
        }

        if (resourceImported.name !== resourceNeeded.reference.$refText) {
          this.issueRenameReferenceDiagnostic(resourceImported, accept, resourceNeeded);
          return;
        }
      });
    }
  }

  private issueReferenceStatementDiagnostic(
    sourceSchema: string,
    schemaIsAlreadyImported: boolean,
    schemaNeeded: Schema_decl,
    resourceNeeded: ReferenceInfo,
    accept: ValidationAcceptor
  ) {
    let data: ReferenceStatementData = {
      schema: schemaNeeded.name,
      resource: resourceNeeded.reference.$refText,
      sourceSchema,
    };
    const code = schemaIsAlreadyImported
      ? ExpressP11Issues.ReferenceStatementIncomplete
      : ExpressP11Issues.ReferenceStatementMissing;
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
  //   for (const node of streamAst(schema)) {
  //     streamReferences(node).forEach((resourceNeeded) => {
  //       if (isResource_or_rename(resourceNeeded.container) || isReference_clause(resourceNeeded.container)) return;

  //       if (!resourceNeeded.reference.$nodeDescription) return;

  //       const schemaNeeded = getContainerOfType(resourceNeeded.reference.ref, isSchema_decl);
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
