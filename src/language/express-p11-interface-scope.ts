import { AstNode, AstNodeDescription, AstNodeDescriptionProvider, EMPTY_STREAM, MultiMap, NameProvider, Scope, Stream, stream } from "langium";

/**
 * Order descriptions by document URI (code units), keeping declaration order
 * within a document. The index collects documents in the order the file
 * system lists them, which differs between platforms; a lookup that falls
 * through to the index must not.
 */
export function byDescriptionUri(left: AstNodeDescription, right: AstNodeDescription): number {
  const l = left.documentUri.toString();
  const r = right.documentUri.toString();
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * The declarations a schema sees (ISO 10303-11:2004 clause 11: its own and
 * those its USE and REFERENCE statements bring in), keyed by name. Built once
 * per schema and build, so a lookup costs a map access instead of a scan of
 * the interface closure.
 */
export class InterfaceIndex {
  readonly byName = new MultiMap<string, AstNode>();

  constructor(nodes: Iterable<AstNode>, nameProvider: NameProvider) {
    for (const node of nodes) {
      const name = nameProvider.getName(node);
      if (name !== undefined) this.byName.add(name, node);
    }
  }
}

/**
 * A schema's interfaced declarations as a scope in front of `outer` (the
 * workspace index), restricted to the nodes `accepts` admits (the reference's
 * target type). Descriptions are created for hits only.
 */
export class InterfaceScope implements Scope {
  constructor(
    private readonly index: InterfaceIndex,
    private readonly accepts: (node: AstNode) => boolean,
    private readonly nameProvider: NameProvider,
    private readonly descriptions: AstNodeDescriptionProvider,
    private readonly outer: Scope
  ) {}

  getElement(name: string): AstNodeDescription | undefined {
    const node = this.index.byName.get(name).find(this.accepts);
    return node !== undefined ? this.descriptions.createDescription(node, name) : this.outer.getElement(name);
  }

  getElements(name: string): Stream<AstNodeDescription> {
    const node = this.index.byName.get(name).find(this.accepts);
    if (node !== undefined) return stream([this.descriptions.createDescription(node, name)]);
    return this.outer.getElements(name) ?? EMPTY_STREAM;
  }

  getAllElements(): Stream<AstNodeDescription> {
    const own = stream(this.index.byName.values())
      .filter(this.accepts)
      .map((node) => this.descriptions.createDescription(node, this.nameProvider.getName(node)));
    return own.concat(this.outer.getAllElements());
  }
}
