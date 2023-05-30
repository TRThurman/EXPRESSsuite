import { AbstractSemanticTokenProvider, AstNode, SemanticTokenAcceptor } from "langium";
import { Domain_rule, Entity_head, Explicit_attr, Named_types } from "./generated/ast";
import { SemanticTokenTypes } from "vscode-languageserver";

export class ExpressP11SemanticProvider extends AbstractSemanticTokenProvider {
  protected override highlightElement(node: AstNode, acceptor: SemanticTokenAcceptor): void | "prune" | undefined {
    switch (node.$type) {
      case Entity_head:
        acceptor({ node, property: "name", type: SemanticTokenTypes.class });
        break;
      case Explicit_attr:
        acceptor({ node, property: "attributes", type: SemanticTokenTypes.property });
        break;
      case Named_types:
        acceptor({ node, property: "of", type: SemanticTokenTypes.type });
        break;
      case Domain_rule:
        acceptor({ node, property: "id", type: SemanticTokenTypes.variable });
        break;
    }
  }
}
