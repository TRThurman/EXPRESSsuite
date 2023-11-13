import { AstNode } from "langium";

export function getFirstContainerOfType(node: AstNode | undefined, types: string[]): AstNode | undefined {
  let item = node?.$container;
  while (item) {
    if (types.includes(item.$type)) {
      return item;
    }
    item = item.$container;
  }
  return undefined;
}
