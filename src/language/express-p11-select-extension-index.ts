import { DocumentState, LangiumDocuments } from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import { TypeDefinition, isExpressFile, isSelect_extension, isSelect_type, isTypeDefinition } from "./generated/ast.js";

/**
 * Which TYPE declarations extend a given SELECT with `SELECT BASED_ON base`.
 * ISO 10303-11:2004 13.3.2 counts "items added to that domain by other select
 * data types based on the select data type" as members of the base, so a type
 * check on an EXTENSIBLE select must fold its extensions in. Rebuilt lazily
 * after each workspace build phase that recomputes scopes.
 */
export class ExpressP11SelectExtensionIndex {
  private readonly documents: LangiumDocuments;
  private extensions: Map<TypeDefinition, TypeDefinition[]> | undefined;

  constructor(services: LangiumSharedServices) {
    this.documents = services.workspace.LangiumDocuments;
    services.workspace.DocumentBuilder.onBuildPhase(DocumentState.ComputedScopes, () => {
      this.extensions = undefined;
    });
  }

  extensionsOf(base: TypeDefinition): TypeDefinition[] {
    if (!this.extensions) this.extensions = this.build();
    return this.extensions.get(base) ?? [];
  }

  private build(): Map<TypeDefinition, TypeDefinition[]> {
    const map = new Map<TypeDefinition, TypeDefinition[]>();
    for (const document of this.documents.all) {
      const file = document.parseResult.value;
      if (!isExpressFile(file)) continue;
      for (const schema of file.schemas ?? []) {
        for (const declaration of schema.body?.declarations ?? []) {
          if (!isTypeDefinition(declaration) || !isSelect_type(declaration.underlyingType)) continue;
          const select = declaration.underlyingType.select;
          if (!isSelect_extension(select)) continue;
          const base = select.type.ref;
          if (!base) continue;
          const list = map.get(base) ?? [];
          list.push(declaration);
          map.set(base, list);
        }
      }
    }
    return map;
  }
}
