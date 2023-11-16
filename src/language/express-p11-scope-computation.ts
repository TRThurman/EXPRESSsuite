import {
  AstNode,
  AstNodeDescription,
  DefaultScopeComputation,
  LangiumDocument,
  MultiMap,
  PrecomputedScopes,
  getContainerOfType,
  interruptAndCheck,
  streamContents,
} from "langium";
import {
  ExpressFile,
  FunctionDefinition,
  ProcedureDefinition,
  Query_expression,
  Repeat_stmt,
  Rule_decl,
  SchemaDefinition,
  isAttribute_decl,
  isConstant_body,
  isConstant_decl,
  isDeclaration,
  isEntityDefinition,
  isEnumeration_id,
  isFunctionDefinition,
  isParameter_id,
  isProcedureDefinition,
  isSchemaDefinition,
  isTypeDefinition,
  isVariable_id,
} from "./generated/ast.js";
import { CancellationToken } from "vscode-jsonrpc";
import { getEntityDeclarations } from "../utils/entity-helpers.js";
import { getTypeDeclarations } from "../utils/type-helpers.js";
import { getFunctionDeclarations } from "../utils/function-helpers.js";
// import { getReferenceDeclarations } from "../utils/reference-helpers";
import { schemaHasConstants, schemaHasDeclarations, schemaHasSpecifications } from "../utils/schema-helpers.js";
import { getProcedureDeclarations } from "../utils/procedure-helpers.js";
import { getConstantDeclarations } from "../utils/constant-helpers.js";
import { getReferenceSpecifications } from "../utils/interface-helpers.js";
import { getSchemaDeclarations } from "../utils/schema-helpers.js";
import { getFirstContainerOfType } from "../utils/ast-utils.js";

export class ExpressP11ScopeComputation extends DefaultScopeComputation {
  //protected override processNode(node: AstNode, document: LangiumDocument<AstNode>, scopes: PrecomputedScopes): void {}

  override async computeExports(
    document: LangiumDocument<ExpressFile>,
    cancelToken = CancellationToken.None
  ): Promise<AstNodeDescription[]> {
    const exports: AstNodeDescription[] = [];

    for (const schema of getSchemaDeclarations(document)) {
      await interruptAndCheck(cancelToken);
      if (schema.name) exports.push(this.descriptions.createDescription(schema, schema.name, document));
      try {
        if (!schema.body) continue;
        for (const modelNode of streamContents(schema.body)) {
          await interruptAndCheck(cancelToken);
          if (
            isEntityDefinition(modelNode) ||
            isTypeDefinition(modelNode) ||
            isFunctionDefinition(modelNode) ||
            isProcedureDefinition(modelNode) ||
            isEnumeration_id(modelNode)
          ) {
            let name = this.nameProvider.getName(modelNode);
            if (name) {
              exports.push(this.descriptions.createDescription(modelNode, name, document));
            }
          }
          if (isConstant_decl(modelNode)) {
            for (const constant of streamContents(modelNode)) {
              if (isConstant_body(constant)) {
                let name = this.nameProvider.getName(constant);
                if (name) {
                  exports.push(this.descriptions.createDescription(constant, name, document));
                }
              }
            }
          }
        }
      } catch (err) {}
    }

    return exports;
  }

  protected override processNode(node: AstNode, document: LangiumDocument<AstNode>, scopes: PrecomputedScopes): void {
    //declarations, constants, and enumerations are visible to the whole subtree of the schema they belong to
    if (isDeclaration(node) || isConstant_body(node) || isEnumeration_id(node)) {
      const schema = getContainerOfType(node, isSchemaDefinition);
      if (!schema) return;
      this.addToLocalScope(node, schema, document, scopes);
      return;
    }

    //parameters or local variables are visible to the subtree of the function, procedure, or statement they belong to
    if (isParameter_id(node) || isVariable_id(node) || isConstant_body(node)) {
      const scopingContainer = getFirstContainerOfType(node, [
        FunctionDefinition,
        ProcedureDefinition,
        Repeat_stmt,
        Query_expression,
        Rule_decl,
      ]);
      if (!scopingContainer) return;
      this.addToLocalScope(node, scopingContainer, document, scopes);
    }

    if (isAttribute_decl(node)) {
      const entity = getContainerOfType(node, isEntityDefinition);
      if (!entity) return;
      this.addToLocalScope(node, entity, document, scopes);
    }
  }

  private addToLocalScope(node: AstNode, container: AstNode, document: LangiumDocument<AstNode>, scopes: PrecomputedScopes): void {
    const name = this.nameProvider.getName(node);
    scopes.add(container, this.descriptions.createDescription(node, name, document));
  }

  //   override async computeLocalScopes(
  //     document: LangiumDocument<ExpressFile>,
  //     cancelToken = CancellationToken.None
  //   ): Promise<PrecomputedScopes> {
  //     //const schema = document.parseResult.value.schema;
  //     const scopes = new MultiMap<AstNode, AstNodeDescription>();
  //     await getSchemaDeclarations(document).forEach(async (schema) => {
  //       await interruptAndCheck(cancelToken);
  //       this.addDeclarationsToScope(schema, scopes, document);
  //       this.addSpecificationsToScope(schema, scopes, document);
  //       this.addConstantsToScope(schema, scopes, document);
  //     });
  //     return scopes;
  //   }

  private addConstantsToScope(
    schema: SchemaDefinition,
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

  //@ts-ignore
  //   private async addDeclarationsToExport(
  //     schema: Schema_decl,
  //     exportList: AstNodeDescription[],
  //     document: LangiumDocument<ExpressFile>,
  //     cancelToken = CancellationToken.None
  //   ): Promise<void> {
  //     if (schemaHasDeclarations(schema)) {
  //       const entityDeclarations = getEntityDeclarations(schema);
  //       const typeDeclarations = getTypeDeclarations(schema);
  //       const functionDeclarations = getFunctionDeclarations(schema);
  //       const procedureDeclarations = getProcedureDeclarations(schema);
  //       entityDeclarations?.forEach(async (entity) => {
  //         await interruptAndCheck(cancelToken);
  //         exportList.push(this.descriptions.createDescription(entity.head, entity.head.name, document));
  //       });
  //       typeDeclarations?.forEach(async (type) => {
  //         await interruptAndCheck(cancelToken);
  //         exportList.push(this.descriptions.createDescription(type, type.name, document));
  //       });
  //       functionDeclarations?.forEach(async (f) => {
  //         await interruptAndCheck(cancelToken);
  //         exportList.push(this.descriptions.createDescription(f.head, f.head.name, document));
  //       });
  //       procedureDeclarations?.forEach(async (p) => {
  //         await interruptAndCheck(cancelToken);
  //         exportList.push(this.descriptions.createDescription(p.head, p.head.name, document));
  //       });
  //     }
  //   }
  private addDeclarationsToScope(
    schema: SchemaDefinition,
    scopes: MultiMap<AstNode, AstNodeDescription>,
    document: LangiumDocument<ExpressFile>
  ) {
    if (schemaHasDeclarations(schema)) {
      const entityDeclarations = getEntityDeclarations(schema);
      const typeDeclarations = getTypeDeclarations(schema);
      const functionDeclarations = getFunctionDeclarations(schema);
      const procedureDeclarations = getProcedureDeclarations(schema);
      entityDeclarations?.forEach((entity) => {
        scopes.add(schema, this.descriptions.createDescription(entity, entity.name, document));
      });
      typeDeclarations?.forEach((type) => {
        scopes.add(schema, this.descriptions.createDescription(type, type.name, document));
      });
      functionDeclarations?.forEach((f) => {
        scopes.add(schema, this.descriptions.createDescription(f, f.name, document));
      });
      procedureDeclarations?.forEach((p) => {
        scopes.add(schema, this.descriptions.createDescription(p, p.name, document));
      });
    }
  }

  private addSpecificationsToScope(
    schema: SchemaDefinition,
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
          if (resource.isRenamed) scopes.add(schema, this.descriptions.createDescription(resource, resource.name, document));
        });
      });
    }
  }
}
