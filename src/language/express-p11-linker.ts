import { AstNodeDescription, DefaultLinker, DocumentState, LinkingError, ReferenceInfo, getContainerOfType, getDocument } from "langium";
import {
  Attribute_decl,
  EntityDefinition,
  FunctionDefinition,
  SchemaDefinition,
  TypeDefinition,
  isEntityDefinition,
  isQualified_attribute,
} from "./generated/ast.js";
import { isReferenceToControlledEntity, isReferenceToControlledType } from "./express-p11-scope-provider.js";

export class ExpressP11Linker extends DefaultLinker {
  override getCandidate(refInfo: ReferenceInfo): AstNodeDescription | LinkingError {
    const scope = this.scopeProvider.getScope(refInfo);
    const description = scope.getElement(refInfo.reference.$refText);
    return description ?? this.createLinkingError(refInfo);
  }
  protected override createLinkingError(refInfo: ReferenceInfo, targetDescription?: AstNodeDescription | undefined): LinkingError {
    const document = getDocument(refInfo.container);
    if (document.state < DocumentState.ComputedScopes) {
      console.warn(`Attempted reference resolution before document reached ComputedScopes state (${document.uri}).`);
    }
    let message: string = this.getErrorMessage(refInfo);
    return {
      ...refInfo,
      message,
      targetDescription,
    };
  }

  private getErrorMessage(refInfo: ReferenceInfo): string {
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
        if (isReferenceToControlledEntity(refInfo)) {
          message = `The entity '${referenceName}' is not available and may require an interface.`;
          break;
        }
        message = `The entity '${referenceName}' could not be found.`;
        break;
      case SchemaDefinition:
        message = `The schema '${referenceName}' could not be found.`;
        break;
      case Attribute_decl:
        message = `The attribute '${referenceName}' could not be found.`;
        break;
      case TypeDefinition:
        if (isReferenceToControlledType(refInfo)) {
          message = `The type '${referenceName}' is not available and may require an interface.`;
          break;
        } else {
          message = `The type '${referenceName}' could not be found.`;
          break;
        }
      case FunctionDefinition:
        message = `The function '${referenceName}' could not be found.`;
        break;
    }
    return message;
  }
}
