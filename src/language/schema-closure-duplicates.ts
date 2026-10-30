import { LangiumDocument, LangiumDocuments } from "langium";
import type { CancellationToken, Position } from "vscode-languageserver";
import { ExpressFile } from "./generated/ast.js";
import type { ExpressP11Services } from "./express-module.js";
import { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import { declarationNameRange } from "./express-p11-scope-index.js";
import type {
  DetectSchemaClosureDuplicatesResult,
  SchemaClosureDuplicate,
  SchemaClosureDuplicateLocation,
} from "../shared/schema-closure-duplicates.js";

/**
 * The on-demand form of the `duplicate-interfaced-declaration` check: the
 * identifiers that denote two or more declarations in the scope of the schema
 * at the cursor (ISO 10303-11:2004 10.1 b), computed by the same scope index
 * the validator uses, so the command and the Problems view never disagree.
 */
export class SchemaClosureDuplicateAnalyzer {
  private readonly documents: LangiumDocuments;
  private readonly typeContainer: ExpressP11TypeContainer;

  constructor(services: ExpressP11Services) {
    this.documents = services.shared.workspace.LangiumDocuments;
    this.typeContainer = services.validation.TypeContainer;
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
    this.throwIfCancelled(cancelToken);

    const conflicts: SchemaClosureDuplicate[] = [];
    for (const clash of this.typeContainer.getScopeIndex().clashesIn(current)) {
      this.throwIfCancelled(cancelToken);
      const locations: SchemaClosureDuplicateLocation[] = [];
      for (const decl of clash.declarations) {
        const range = declarationNameRange(decl);
        if (range) locations.push({ uri: decl.uri, range, schema: decl.schema });
      }
      if (locations.length < 2) continue;
      const category = [...new Set(clash.declarations.map((decl) => decl.kind))].join("/");
      conflicts.push({ category, name: clash.identifier, locations });
    }
    conflicts.sort((left, right) => left.name.localeCompare(right.name) || left.category.localeCompare(right.category));
    return { schema: current.name, conflicts };
  }

  private throwIfCancelled(cancelToken?: CancellationToken): void {
    if (cancelToken?.isCancellationRequested) throw new Error("Schema closure duplicate analysis cancelled");
  }
}
