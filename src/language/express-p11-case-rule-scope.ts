import { AstNode, AstNodeDescription, AstNodeDescriptionProvider, EMPTY_STREAM, MultiMap, NameProvider, Scope, Stream, stream } from "langium";
import { EntityDefinition, SchemaDefinition } from "./generated/ast.js";

/**
 * Which declaration kinds a reference may bind to regardless of letter case.
 *
 * ISO 10303-11:2004 7.1.2 reads identifiers regardless of case. The SC4 modular
 * architecture makes entity names carry case (ARM `Product`, MIM `product`)
 * and schema references bind exact-case, so in a short form those two kinds
 * bind exact-case only (project rulings, 2026-10-29 and 2026-10-30). A long
 * form (`_lf`) is unique regardless of case (WG11 N239) and every kind binds
 * regardless of case there (ruling 2026-10-30).
 */
export function foldsCase(type: string, longForm: boolean): boolean {
  return longForm || (type !== EntityDefinition.$type && type !== SchemaDefinition.$type);
}

/**
 * A scope under the case rule: an exact match wins; otherwise a match
 * regardless of case among the declarations whose kind folds case; otherwise
 * the outer scope. A folded match in an inner scope therefore wins over an
 * exact match further out, as EXPRESS scoping has it for names that do not
 * carry case.
 */
export class CaseRuleScope implements Scope {
  private readonly exact = new MultiMap<string, AstNodeDescription>();
  private readonly folded = new MultiMap<string, AstNodeDescription>();

  constructor(
    elements: Iterable<AstNodeDescription>,
    private readonly outer: Scope | undefined,
    longForm: boolean
  ) {
    for (const description of elements) {
      this.exact.add(description.name, description);
      if (foldsCase(description.type, longForm)) this.folded.add(description.name.toLowerCase(), description);
    }
  }

  getElement(name: string): AstNodeDescription | undefined {
    return this.exact.get(name)[0] ?? this.folded.get(name.toLowerCase())[0] ?? this.outer?.getElement(name);
  }

  getElements(name: string): Stream<AstNodeDescription> {
    const exact = this.exact.get(name);
    if (exact.length > 0) return stream(exact);
    const folded = this.folded.get(name.toLowerCase());
    if (folded.length > 0) return stream(folded);
    return this.outer?.getElements(name) ?? EMPTY_STREAM;
  }

  getAllElements(): Stream<AstNodeDescription> {
    const own = stream(this.exact.values());
    return this.outer ? own.concat(this.outer.getAllElements()) : own;
  }
}

/**
 * The same rule over AST nodes, evaluated lazily: the nodes are scanned on
 * each lookup and the scan stops at an exact match, so a scope built for one
 * reference costs what Langium's stream scope cost. A folded candidate seen
 * during the scan is used when no exact match follows. For the index, which
 * serves every reference of a build, `CaseRuleScope` with its maps is cheaper.
 */
export class LazyCaseRuleScope implements Scope {
  constructor(
    private readonly nodes: Iterable<AstNode>,
    private readonly nameProvider: NameProvider,
    private readonly descriptions: AstNodeDescriptionProvider,
    private readonly outer: Scope | undefined,
    private readonly longForm: boolean
  ) {}

  getElement(name: string): AstNodeDescription | undefined {
    const lower = name.toLowerCase();
    let folded: AstNode | undefined;
    let foldedName = "";
    for (const node of this.nodes) {
      const nodeName = this.nameProvider.getName(node);
      if (nodeName === undefined) continue;
      if (nodeName === name) return this.descriptions.createDescription(node, nodeName);
      if (folded === undefined && nodeName.toLowerCase() === lower && foldsCase(node.$type, this.longForm)) {
        folded = node;
        foldedName = nodeName;
      }
    }
    if (folded !== undefined) return this.descriptions.createDescription(folded, foldedName);
    return this.outer?.getElement(name);
  }

  getElements(name: string): Stream<AstNodeDescription> {
    const found = this.getElement(name);
    return found ? stream([found]) : (this.outer?.getElements(name) ?? EMPTY_STREAM);
  }

  getAllElements(): Stream<AstNodeDescription> {
    const own = stream(this.nodes)
      .map((node) => {
        const nodeName = this.nameProvider.getName(node);
        return nodeName ? this.descriptions.createDescription(node, nodeName) : undefined;
      })
      .nonNullable();
    return this.outer ? own.concat(this.outer.getAllElements()) : own;
  }
}

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
 * those its USE and REFERENCE statements bring in), keyed by exact name and,
 * for the kinds that fold case, by lower-cased name. Built once per schema
 * and build, so a lookup costs a map access instead of a scan of the
 * interface closure.
 */
export class CaseRuleNodeIndex {
  readonly exact = new MultiMap<string, AstNode>();
  readonly folded = new MultiMap<string, AstNode>();

  constructor(nodes: Iterable<AstNode>, nameProvider: NameProvider, longForm: boolean) {
    for (const node of nodes) {
      const name = nameProvider.getName(node);
      if (name === undefined) continue;
      this.exact.add(name, node);
      if (foldsCase(node.$type, longForm)) this.folded.add(name.toLowerCase(), node);
    }
  }
}

/**
 * The case rule over a prebuilt node index in front of `outer`, restricted to
 * the nodes `accepts` admits (the reference's target type). Descriptions are
 * created for hits only.
 */
export class IndexedCaseRuleScope implements Scope {
  constructor(
    private readonly index: CaseRuleNodeIndex,
    private readonly accepts: (node: AstNode) => boolean,
    private readonly nameProvider: NameProvider,
    private readonly descriptions: AstNodeDescriptionProvider,
    private readonly outer: Scope | undefined
  ) {}

  getElement(name: string): AstNodeDescription | undefined {
    const exact = this.index.exact.get(name).find(this.accepts);
    if (exact !== undefined) return this.descriptions.createDescription(exact, name);
    const folded = this.index.folded.get(name.toLowerCase()).find(this.accepts);
    if (folded !== undefined) return this.descriptions.createDescription(folded, this.nameProvider.getName(folded));
    return this.outer?.getElement(name);
  }

  getElements(name: string): Stream<AstNodeDescription> {
    const found = this.getElement(name);
    return found ? stream([found]) : (this.outer?.getElements(name) ?? EMPTY_STREAM);
  }

  getAllElements(): Stream<AstNodeDescription> {
    const own = stream(this.index.exact.values())
      .filter(this.accepts)
      .map((node) => this.descriptions.createDescription(node, this.nameProvider.getName(node)));
    return this.outer ? own.concat(this.outer.getAllElements()) : own;
  }
}
