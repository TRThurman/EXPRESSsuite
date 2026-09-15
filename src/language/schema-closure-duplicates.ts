import { AstNode, AstUtils, LangiumDocument, LangiumDocuments, NameProvider } from "langium";
import type { CancellationToken, Position } from "vscode-languageserver";
import {
  ExpressFile,
  SchemaDefinition,
  isEntityDefinition,
  isFunctionDefinition,
  isProcedureDefinition,
  isRule_decl,
  isSubtypeConstraintDefinition,
  isTypeDefinition,
} from "./generated/ast.js";
import type { ExpressP11Services } from "./express-module.js";
import type {
  DetectSchemaClosureDuplicatesResult,
  SchemaClosureDuplicate,
  SchemaClosureDuplicateLocation,
} from "../shared/schema-closure-duplicates.js";

type Declaration = {
  category: string;
  name: string;
  node: AstNode;
};

export class SchemaClosureDuplicateAnalyzer {
  private readonly documents: LangiumDocuments;
  private readonly nameProvider: NameProvider;

  constructor(services: ExpressP11Services) {
    this.documents = services.shared.workspace.LangiumDocuments;
    this.nameProvider = services.references.NameProvider;
  }

  analyze(uri: string, position: Position, cancelToken?: CancellationToken): DetectSchemaClosureDuplicatesResult {
    const document = this.documents.all.find((candidate) => candidate.uri.toString() === uri) as
      | LangiumDocument<ExpressFile>
      | undefined;
    if (!document) return { conflicts: [] };

    const offset = document.textDocument.offsetAt(position);
    const current = document.parseResult.value.schemas.find((schema) => {
      const range = schema.$cstNode?.offset;
      const end = schema.$cstNode?.end;
      return range !== undefined && end !== undefined && offset >= range && offset <= end;
    });
    if (!current) return { conflicts: [] };

    const closure = this.collectClosure(current, cancelToken);
    const declarations = new Map<string, Declaration[]>();
    for (const schema of closure) {
      this.throwIfCancelled(cancelToken);
      for (const declaration of this.getDeclarations(schema)) {
        const effectiveName = this.getDirectEffectiveName(current, declaration);
        const effectiveDeclaration = { ...declaration, name: effectiveName };
        const key = `${declaration.category}:${effectiveName.toLowerCase()}`;
        const existing = declarations.get(key) ?? [];
        existing.push(effectiveDeclaration);
        declarations.set(key, existing);
      }
    }

    const conflicts: SchemaClosureDuplicate[] = [];
    for (const entries of declarations.values()) {
      const schemas = new Set(entries.map((entry) => this.getOwningSchema(entry.node)?.name.toLowerCase()));
      schemas.delete(undefined);
      if (schemas.size < 2) continue;

      const locations = entries
        .map((entry) => this.toLocation(entry.node))
        .filter((location): location is SchemaClosureDuplicateLocation => location !== undefined);
      if (locations.length < 2) continue;
      conflicts.push({
        category: entries[0].category,
        name: entries[0].name,
        locations,
      });
    }

    conflicts.sort((left, right) => left.name.localeCompare(right.name) || left.category.localeCompare(right.category));
    return { schema: current.name, conflicts };
  }

  private collectClosure(root: SchemaDefinition, cancelToken?: CancellationToken): SchemaDefinition[] {
    const result: SchemaDefinition[] = [];
    const pending = [root];
    const visited = new Set<SchemaDefinition>();
    while (pending.length > 0) {
      this.throwIfCancelled(cancelToken);
      const schema = pending.pop()!;
      if (visited.has(schema)) continue;
      visited.add(schema);
      result.push(schema);
      for (const specification of schema.body.specifications) {
        const imported = specification.schema.ref;
        if (imported && !visited.has(imported)) pending.push(imported);
      }
    }
    return result;
  }

  private getDeclarations(schema: SchemaDefinition): Declaration[] {
    const declarations: Declaration[] = [];
    for (const node of schema.body.declarations) {
      let category: string | undefined;
      let name: string | undefined;
      if (isEntityDefinition(node)) category = "ENTITY";
      else if (isTypeDefinition(node)) category = "TYPE";
      else if (isFunctionDefinition(node)) category = "FUNCTION";
      else if (isProcedureDefinition(node)) category = "PROCEDURE";
      else if (isSubtypeConstraintDefinition(node)) category = "SUBTYPE CONSTRAINT";
      else if (isRule_decl(node)) {
        declarations.push({ category: "RULE", name: node.ruleHead.name, node: node.ruleHead });
        continue;
      }
      if (category) name = this.nameProvider.getName(node);
      if (category && name) declarations.push({ category, name, node });
    }
    for (const constant of schema.body.constant?.items ?? []) {
      declarations.push({ category: "CONSTANT", name: constant.name, node: constant });
    }
    return declarations;
  }

  private getDirectEffectiveName(root: SchemaDefinition, declaration: Declaration): string {
    for (const specification of root.body.specifications) {
      for (const resource of specification.resources) {
        if (resource.resource.ref === declaration.node && resource.isRenamed && resource.name) {
          return resource.name;
        }
      }
    }
    return declaration.name;
  }

  private getOwningSchema(node: AstNode): SchemaDefinition | undefined {
    return AstUtils.getContainerOfType(node, (candidate): candidate is SchemaDefinition => candidate.$type === "SchemaDefinition");
  }

  private toLocation(node: AstNode): SchemaClosureDuplicateLocation | undefined {
    const schema = this.getOwningSchema(node);
    const nameNode = this.nameProvider.getNameNode(node) ?? node.$cstNode;
    if (!schema || !nameNode) return undefined;
    return {
      uri: AstUtils.getDocument(node).uri.toString(),
      range: nameNode.range,
      schema: schema.name,
    };
  }

  private throwIfCancelled(cancelToken?: CancellationToken): void {
    if (cancelToken?.isCancellationRequested) throw new Error("Schema closure duplicate analysis cancelled");
  }
}
