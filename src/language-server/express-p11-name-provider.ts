import { AstNode, CstNode, DefaultNameProvider, findNodeForProperty } from "langium";
import {
  Attribute_decl,
  isAttribute_decl,
  isAttribute_id,
  isConstant_body,
  isDeclaration,
  isDerived_attr,
  isEnumeration_id,
  isInverse_attr,
  isParameter_id,
  isRedeclared_attribute,
  isVariable_id,
} from "./generated/ast";

export class ExpressP11NameProvider extends DefaultNameProvider {
  override getName(node: AstNode): string | undefined {
    if (
      isDeclaration(node) ||
      isConstant_body(node) ||
      isParameter_id(node) ||
      isVariable_id(node) ||
      isEnumeration_id(node)
    ) {
      return super.getName(node);
    }

    //attributes
    if (isAttribute_decl(node)) {
      return this.getAttributeName(node);
    }
    if (isDerived_attr(node) || isInverse_attr(node)) {
      return this.getAttributeName(node.attribute);
    }

    return;
  }

  override getNameNode(node: AstNode): CstNode | undefined {
    if (isAttribute_decl(node)) {
      return this.getAttributeNameNode(node);
    }
    if (isDerived_attr(node) || isInverse_attr(node)) {
      return this.getAttributeNameNode(node.attribute);
    }
    return super.getNameNode(node);
  }
  private getAttributeName(node: Attribute_decl): string | undefined {
    if (isAttribute_id(node)) return node.name;
    if (isRedeclared_attribute(node)) {
      if (node.isRenamed) return super.getName(node);
      //we use refText because we are not guaranteed that the reference has been resolved yet
      return node.qualifiedAttribute.attribute.target?.$refText;
    }
    return;
  }

  private getAttributeNameNode(node: Attribute_decl): CstNode | undefined {
    if (isAttribute_id(node)) return super.getNameNode(node);
    if (isRedeclared_attribute(node)) {
      if (node.isRenamed) return super.getNameNode(node);
      return node.qualifiedAttribute.attribute.target?.$refNode;
      //   return findNodeForProperty(node.qualifiedAttribute.attribute.$cstNode, "target");
    }
    return undefined;
  }
}
