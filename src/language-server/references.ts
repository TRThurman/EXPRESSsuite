import { DefaultReferences, LangiumDocuments, LangiumServices, getContainerOfType } from "langium";
import { Entity_decl, isEntity_decl, isSubtype_declaration, isSupertype_constraint } from "./generated/ast";

export class ExpressP11References extends DefaultReferences {
  protected readonly documents: LangiumDocuments;

  constructor(services: LangiumServices) {
    super(services);
    this.documents = services.shared.workspace.LangiumDocuments;
  }

  getUsedInSupertypeOf(entity: Entity_decl): Entity_decl[] {
    const usedIn: Array<Entity_decl> = [];
    const refs = this.index.findAllReferences(entity.head, this.nodeLocator.getAstNodePath(entity.head));
    refs.forEach((ref) => {
      const doc = this.documents.getOrCreateDocument(ref.sourceUri);
      const astNode = this.nodeLocator.getAstNode(doc.parseResult.value, ref.sourcePath);

      //TODO: isSupertype_rule is not enough
      const subtypeOf = getContainerOfType(astNode, isSupertype_constraint);
      if (!subtypeOf) return;

      const entityContext = getContainerOfType(subtypeOf, isEntity_decl);
      if (entityContext) usedIn.push(entityContext);
    });
    return usedIn;
  }

  getUsedInSubtypeOf(entity: Entity_decl): Entity_decl[] {
    const usedIn: Array<Entity_decl> = [];
    const refs = this.index.findAllReferences(entity.head, this.nodeLocator.getAstNodePath(entity.head));
    refs.forEach((ref) => {
      const doc = this.documents.getOrCreateDocument(ref.sourceUri);
      const astNode = this.nodeLocator.getAstNode(doc.parseResult.value, ref.sourcePath);
      const subtypeOf = getContainerOfType(astNode, isSubtype_declaration);
      if (!subtypeOf) return;
      const entityContext = getContainerOfType(subtypeOf, isEntity_decl);
      if (entityContext) usedIn.push(entityContext);
    });
    return usedIn;
  }
}
