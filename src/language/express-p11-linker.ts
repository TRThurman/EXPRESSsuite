import { AstNodeDescription, DefaultLinker, DocumentState, LinkingError, ReferenceInfo, getContainerOfType, getDocument } from "langium";
import { Attribute_decl, EntityDefinition, SchemaDefinition, isEntityDefinition, isQualified_attribute } from "./generated/ast.js";

export class ExpressP11Linker extends DefaultLinker {
  protected override createLinkingError(refInfo: ReferenceInfo, targetDescription?: AstNodeDescription | undefined): LinkingError {
    const document = getDocument(refInfo.container);
    if (document.state < DocumentState.ComputedScopes) {
      console.warn(`Attempted reference resolution before document reached ComputedScopes state (${document.uri}).`);
    }
    const referenceType = this.reflection.getReferenceType(refInfo);
    let message: string = "A reference could not be resolved.";
    let referenceName = refInfo.reference.$refText;
    switch (referenceType) {
      case EntityDefinition:
        const qualifiedAttribute = getContainerOfType(refInfo.container, isQualified_attribute);
        if (qualifiedAttribute) {
          const entityContext = getContainerOfType(qualifiedAttribute, isEntityDefinition);
          if (entityContext) {
            if (entityContext.name) {
              message = `The entity '${referenceName}' could not be found in the supertype/subtype of '${entityContext.name}'`;
              break;
            }
          }
        }
        message = `The entity '${referenceName}' could not be found.`;
        break;
      case SchemaDefinition:
        message = `The schema '${referenceName}' could not be found.`;
        break;
      case Attribute_decl:
        message = `The attribute '${referenceName}' could not be found.`;
        break;
    }
    return {
      ...refInfo,
      message,
      targetDescription,
    };
  }
}
