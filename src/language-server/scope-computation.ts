import {
  AstNode,
  AstNodeDescription,
  AstNodeDescriptionProvider,
  LangiumDocument,
  LangiumServices,
  MultiMap,
  PrecomputedScopes,
  ScopeComputation,
  // isReference,
} from "langium";
import { ExpressFile, Schema_decl } from "./generated/ast";
import { CancellationToken } from "vscode-jsonrpc";
import { getEntityDeclarations } from "../utils/entity-helpers";
import { getTypeDeclarations } from "../utils/type-helpers";
import { getFunctionDeclarations } from "../utils/function-helpers";
// import { getReferenceDeclarations } from "../utils/reference-helpers";
import { schemaHasConstants, schemaHasDeclarations, schemaHasSpecifications } from "../utils/schema-helpers";
import { getProcedureDeclarations } from "../utils/procedure-helpers";
import { getConstantDeclarations } from "../utils/constant-helpers";
import { getReferenceSpecifications } from "../utils/interface-helpers";
import { getSchemaDeclarations } from "../utils/schema-helpers";

export class ExpressP11ScopeComputation implements ScopeComputation {
  //protected readonly nameProvider: NameProvider;
  protected readonly descriptions: AstNodeDescriptionProvider;

  constructor(services: LangiumServices) {
    //this.nameProvider = services.references.NameProvider;
    this.descriptions = services.workspace.AstNodeDescriptionProvider;
  }

  /**
   * Returns a list of named nodes than can be used in other documents.
   * @param document The document from which we export nodes
   * @param cancelToken Cancellation token for async actions
   * @returns A list of AstNodeDecription exported from the document
   */
  async computeExports(
    document: LangiumDocument<ExpressFile>,
    cancelToken = CancellationToken.None
  ): Promise<AstNodeDescription[]> {
    const exports: AstNodeDescription[] = [];
    // const schema = getSchemaDeclarations(document);
    // if (!schema) return exports;
    getSchemaDeclarations(document).forEach((schema) => {
      exports.push(this.descriptions.createDescription(schema, schema.name, document));
      this.addDeclarationsToExport(schema, exports, document);
    });
    return exports;
  }
  async computeLocalScopes(
    document: LangiumDocument<ExpressFile>,
    cancelToken = CancellationToken.None
  ): Promise<PrecomputedScopes> {
    //const schema = document.parseResult.value.schema;
    const scopes = new MultiMap<AstNode, AstNodeDescription>();
    getSchemaDeclarations(document).forEach((schema) => {
      this.addDeclarationsToScope(schema, scopes, document);
      this.addSpecificationsToScope(schema, scopes, document);
      this.addConstantsToScope(schema, scopes, document);
    });
    return scopes;
  }

  private addConstantsToScope(
    schema: Schema_decl,
    scopes: MultiMap<AstNode, AstNodeDescription>,
    document: LangiumDocument<ExpressFile>
  ) {
    if (schemaHasConstants(schema)) {
      const constantDeclarations = getConstantDeclarations(schema);
      constantDeclarations?.forEach((c) => {
        scopes.add(schema, this.descriptions.createDescription(c, c.name, document));
      });
    }
  }

  private addDeclarationsToExport(
    schema: Schema_decl,
    exportList: AstNodeDescription[],
    document: LangiumDocument<ExpressFile>
  ): void {
    if (schemaHasDeclarations(schema)) {
      const entityDeclarations = getEntityDeclarations(schema);
      const typeDeclarations = getTypeDeclarations(schema);
      const functionDeclarations = getFunctionDeclarations(schema);
      const procedureDeclarations = getProcedureDeclarations(schema);
      entityDeclarations?.forEach((entity) => {
        exportList.push(this.descriptions.createDescription(entity.head, entity.head.name, document));
      });
      typeDeclarations?.forEach((type) => {
        exportList.push(this.descriptions.createDescription(type, type.name, document));
      });
      functionDeclarations?.forEach((f) => {
        exportList.push(this.descriptions.createDescription(f.head, f.head.name, document));
      });
      procedureDeclarations?.forEach((p) => {
        exportList.push(this.descriptions.createDescription(p.head, p.head.name, document));
      });
    }
  }
  private addDeclarationsToScope(
    schema: Schema_decl,
    scopes: MultiMap<AstNode, AstNodeDescription>,
    document: LangiumDocument<ExpressFile>
  ) {
    if (schemaHasDeclarations(schema)) {
      const entityDeclarations = getEntityDeclarations(schema);
      const typeDeclarations = getTypeDeclarations(schema);
      const functionDeclarations = getFunctionDeclarations(schema);
      const procedureDeclarations = getProcedureDeclarations(schema);
      entityDeclarations?.forEach((entity) => {
        scopes.add(schema, this.descriptions.createDescription(entity.head, entity.head.name, document));
      });
      typeDeclarations?.forEach((type) => {
        scopes.add(schema, this.descriptions.createDescription(type, type.name, document));
      });
      functionDeclarations?.forEach((f) => {
        scopes.add(schema, this.descriptions.createDescription(f.head, f.head.name, document));
      });
      procedureDeclarations?.forEach((p) => {
        scopes.add(schema, this.descriptions.createDescription(p.head, p.head.name, document));
      });
    }
  }

  private addSpecificationsToScope(
    schema: Schema_decl,
    scopes: MultiMap<AstNode, AstNodeDescription>,
    document: LangiumDocument<ExpressFile>
  ) {
    /**
     * We only add renamed resources to the local scope.
     * Other resources will be exposed by the scope provider.
     */
    if (schemaHasSpecifications(schema)) {
      const referenceSpecifications = getReferenceSpecifications(schema);
      referenceSpecifications?.forEach((r) => {
        r.resources.forEach((resource) => {
          // const name = resource.isRenamed ? resource.name : resource.resource.$refText;
          if (resource.isRenamed)
            scopes.add(schema, this.descriptions.createDescription(resource, resource.name, document));
        });
      });
    }
  }
}
