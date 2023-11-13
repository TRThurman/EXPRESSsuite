import { DefaultReferences, LangiumDocuments, LangiumServices, getContainerOfType } from "langium";
import { EntityDefinition, isEntityDefinition, isSubtype_declaration, isSupertype_constraint } from "./generated/ast.js";

export class ExpressP11References extends DefaultReferences {
  protected readonly documents: LangiumDocuments;

  constructor(services: LangiumServices) {
    super(services);
    this.documents = services.shared.workspace.LangiumDocuments;
  }

  getUsedInSupertypeOf(entity: EntityDefinition): EntityDefinition[] {
    const usedIn: Array<EntityDefinition> = [];
    const refs = this.index.findAllReferences(entity, this.nodeLocator.getAstNodePath(entity));
    refs.forEach((ref) => {
      const doc = this.documents.getOrCreateDocument(ref.sourceUri);
      const astNode = this.nodeLocator.getAstNode(doc.parseResult.value, ref.sourcePath);

      //TODO: isSupertype_rule is not enough
      const subtypeOf = getContainerOfType(astNode, isSupertype_constraint);
      if (!subtypeOf) return;

      const entityContext = getContainerOfType(subtypeOf, isEntityDefinition);
      if (entityContext) usedIn.push(entityContext);
    });
    return usedIn;
  }

  getUsedInSubtypeOf(entity: EntityDefinition): EntityDefinition[] {
    const usedIn: Array<EntityDefinition> = [];
    const refs = this.index.findAllReferences(entity, this.nodeLocator.getAstNodePath(entity));
    refs.forEach((ref) => {
      const doc = this.documents.getOrCreateDocument(ref.sourceUri);
      const astNode = this.nodeLocator.getAstNode(doc.parseResult.value, ref.sourcePath);
      const subtypeOf = getContainerOfType(astNode, isSubtype_declaration);
      if (!subtypeOf) return;
      const entityContext = getContainerOfType(subtypeOf, isEntityDefinition);
      if (entityContext) usedIn.push(entityContext);
    });
    return usedIn;
  }
}
