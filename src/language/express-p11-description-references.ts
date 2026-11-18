import type { AstNode, AstNodeLocator, LangiumDocument, LangiumDocuments, NameProvider, References } from "langium";
import { AstUtils, CstUtils } from "langium";
import type { Range } from "vscode-languageserver";
import { annotationContexts } from "./annotation/blocks.js";
import type { DescriptionTarget } from "./annotation/definition.js";
import { annotationKeyOf } from "./annotation/keys.js";
import { descriptionSites, nameParts } from "./annotation/references.js";
import type { DescriptionSite } from "./annotation/references.js";
import type { ExpressP11Services } from "./express-module.js";
import type { ExpressP11DefinitionProvider } from "./express-p11-definition-provider.js";
import { isDerived_attr, isDomain_rule, isExpressFile, isInverse_attr, isRedeclared_attribute, isRule_head } from "./generated/ast.js";

/** What Find All References and Rename act on at a position: the declarations named there. */
export interface ReferenceSubject {
  /**
   * The declarations: the one named, with the attributes that redeclare it under the same name and
   * the attribute it redeclares. Empty when the position is in a description block and names nothing.
   */
  nodes: AstNode[];
  /** The declared name. */
  name: string;
  /** `express`: the position is in a schema. Otherwise it is in a description block (`annotation/definition.ts`). */
  where: "express" | "key" | "link" | "display" | "word";
  /** The name at the position, when Rename may start there. */
  range?: Range;
}

/** A place that names the subject. */
export interface ReferenceLocation {
  uri: string;
  range: Range;
  /** `express`: in a schema. Otherwise the kind of the site in a description block. */
  kind: "express" | DescriptionSite["kind"];
  text: string;
}

/**
 * The places that name a declaration, in the EXPRESS and in the description blocks after
 * `END_SCHEMA;` of every loaded file. The grammar reads those blocks as remarks, so Langium's
 * reference index holds nothing of them: they are read again for each request.
 */
export class DescriptionReferences {
  private readonly references: References;
  private readonly nameProvider: NameProvider;
  private readonly documents: LangiumDocuments;
  private readonly locator: AstNodeLocator;
  private readonly nameRegexp: RegExp;

  constructor(private readonly services: ExpressP11Services) {
    this.references = services.references.References;
    this.nameProvider = services.references.NameProvider;
    this.documents = services.shared.workspace.LangiumDocuments;
    this.locator = services.workspace.AstNodeLocator;
    this.nameRegexp = services.parser.GrammarConfig.nameRegexp;
  }

  private get definition(): ExpressP11DefinitionProvider {
    return this.services.lsp.DefinitionProvider as ExpressP11DefinitionProvider;
  }

  /** The subject at `offset`; `undefined` when the position is in a schema and names no declaration. */
  subjectAt(document: LangiumDocument, offset: number): ReferenceSubject | undefined {
    const text = document.textDocument.getText();
    const range = (start: number, end: number): Range => ({ start: document.textDocument.positionAt(start), end: document.textDocument.positionAt(end) });

    const described = this.definition.descriptionTargets(document, offset);
    if (described) {
      const { reference } = described;
      const nodes = described.targets.filter(namesItsTarget).map((target) => target.node);
      const display = reference.kind === "link" && text.startsWith("<<", reference.start);
      const where = display ? "display" : reference.kind;
      if (nodes.length === 0) return { nodes: [], name: "", where };
      const name = this.nameOf(nodes[0]) ?? reference.path;
      const subject: ReferenceSubject = { nodes: this.withRedeclarations(nodes), name, where };
      if (where === "key" || where === "link") {
        // Rename starts on the name itself: not on a role suffix, nor on the supertype of `SELF\supertype.attribute`.
        const segment = text.slice(reference.start, reference.end);
        const part = nameParts(segment).find((candidate) => !candidate.entity && offset >= reference.start + candidate.start && offset <= reference.start + candidate.end);
        if (part && segment.slice(part.start, part.end).toLowerCase() === name.toLowerCase()) {
          subject.range = range(reference.start + part.start, reference.start + part.end);
        }
      }
      return subject;
    }

    const leaf = CstUtils.findDeclarationNodeAtOffset(document.parseResult.value.$cstNode, offset, this.nameRegexp);
    if (!leaf) return undefined;
    let nodes = this.references.findDeclarations(leaf);
    if (nodes.length === 0 && isDomain_rule(leaf.astNode) && this.definition.nameNodeOf(leaf.astNode) === leaf) {
      // The label of a WHERE rule: nothing in EXPRESS refers to it, its description does.
      nodes = [leaf.astNode];
    }
    if (nodes.length === 0) return undefined;
    return { nodes: this.withRedeclarations(nodes), name: this.nameOf(nodes[0]) ?? leaf.text, where: "express", range: leaf.range };
  }

  /** The places in EXPRESS that name `nodes`: the references bound to them and, on request, their own names. */
  inExpress(nodes: AstNode[], includeDeclaration: boolean): ReferenceLocation[] {
    const found = new Map<string, ReferenceLocation>();
    const add = (uri: string, at: Range, text: string): void => {
      const id = `${uri}#${at.start.line}:${at.start.character}-${at.end.line}:${at.end.character}`;
      if (!found.has(id)) found.set(id, { uri, range: at, kind: "express", text });
    };
    for (const node of nodes) {
      if (includeDeclaration) {
        const name = this.definition.nameNodeOf(keyed(node));
        if (name) add(AstUtils.getDocument(node).textDocument.uri, name.range, name.text);
      }
      for (const reference of this.references.findReferences(node, { includeDeclaration })) {
        const source = this.documents.getDocument(reference.sourceUri);
        const text = source ? source.textDocument.getText(reference.segment.range) : "";
        add(reference.sourceUri.toString(), reference.segment.range, text);
      }
    }
    return [...found.values()];
  }

  /** The places in the description blocks of every loaded file that name `nodes`, called `name`. */
  inDescriptions(nodes: AstNode[], name: string): ReferenceLocation[] {
    const ids = new Set<string>();
    for (const node of nodes) {
      const id = this.idOf(node);
      if (id) ids.add(id);
    }
    if (ids.size === 0 || !name) return [];

    const finder = this.definition.targetsFinder();
    const hits = (targets: DescriptionTarget[]): boolean =>
      targets.some((target) => {
        if (!namesItsTarget(target)) return false;
        const id = this.idOf(target.node);
        return id !== undefined && ids.has(id);
      });
    const paths = new Map<string, boolean>();
    const quick = new RegExp(name.replace(/[^A-Za-z0-9_]/g, "\\$&"), "gi");
    const locations: ReferenceLocation[] = [];
    for (const document of this.documents.all) {
      const root = document.parseResult?.value;
      if (!isExpressFile(root) || !root.schemas?.length) continue;
      const firstEnd = root.schemas[0].$cstNode?.end;
      if (firstEnd === undefined) continue;
      const text = document.textDocument.getText();
      // Most files do not write the name after their first schema: they are not read further.
      quick.lastIndex = firstEnd;
      if (!quick.test(text)) continue;
      const words = new Map<string, boolean>();
      const sites = descriptionSites(annotationContexts(root, text), text, name, {
        path: (path) => {
          const lower = path.toLowerCase();
          let known = paths.get(lower);
          if (known === undefined) {
            known = hits(finder.ofPath(path));
            paths.set(lower, known);
          }
          return known;
        },
        word: (word, block) => {
          // A word is read in the block's schema and under the block's subject (`DescriptionTargets.ofWord`).
          const scope = `${block.schema}|${block.key.split(".").slice(0, 2).join(".")}`.toLowerCase();
          let known = words.get(scope);
          if (known === undefined) {
            const schema = root.schemas.find((candidate) => candidate.name === block.schema);
            known = hits(finder.find({ kind: "word", path: word, start: 0, end: 0, block }, schema));
            words.set(scope, known);
          }
          return known;
        },
      });
      const uri = document.textDocument.uri;
      for (const site of sites) {
        locations.push({
          uri,
          range: { start: document.textDocument.positionAt(site.start), end: document.textDocument.positionAt(site.end) },
          kind: site.kind,
          text: site.text,
        });
      }
    }
    return locations;
  }

  /**
   * `nodes` with the attributes bound to them by redeclaration: an attribute redeclared without
   * `RENAMED` is written with the name of the attribute it redeclares, so the two are named, and
   * renamed, together.
   */
  private withRedeclarations(nodes: AstNode[]): AstNode[] {
    const all = new Map<AstNode, true>();
    const queue = [...nodes];
    while (queue.length > 0) {
      const node = queue.pop()!;
      if (all.has(node)) continue;
      all.set(node, true);
      const attribute = isDerived_attr(node) || isInverse_attr(node) ? node.attribute : node;
      if (attribute !== node) queue.push(attribute);
      if (isRedeclared_attribute(attribute) && !attribute.isRenamed) {
        const redeclared = attribute.qualifiedAttribute?.attribute?.target?.ref;
        if (redeclared) queue.push(redeclared);
      }
      for (const reference of this.references.findReferences(node, { includeDeclaration: false })) {
        const source = this.documents.getDocument(reference.sourceUri);
        const from = source ? this.locator.getAstNode(source.parseResult.value, reference.sourcePath) : undefined;
        const redeclaration = from?.$container?.$container;
        if (isRedeclared_attribute(redeclaration) && !redeclaration.isRenamed && redeclaration.qualifiedAttribute?.attribute === from) {
          queue.push(redeclaration);
        }
      }
    }
    return [...all.keys()];
  }

  /** The file and the key of a keyed declaration: what two nodes of the same declaration share. */
  private idOf(node: AstNode): string | undefined {
    const key = annotationKeyOf(keyed(node), this.nameProvider);
    return key ? `${AstUtils.getDocument(node).textDocument.uri}#${key.toLowerCase()}` : undefined;
  }

  private nameOf(node: AstNode): string | undefined {
    return this.definition.nameNodeOf(keyed(node))?.text;
  }
}

/** The node that carries the key: a global rule is named in its head. */
function keyed(node: AstNode): AstNode {
  return isRule_head(node) ? node.$container : node;
}

/**
 * A target that the text names by the declaration's own name: the declaration itself, or one the
 * schema reaches through its interfaces or that one other schema declares. Not the owner or the
 * schema that stands in for a name that does not exist, nor one of several candidates.
 */
function namesItsTarget(target: DescriptionTarget): target is Extract<DescriptionTarget, { kind: "node" }> {
  return target.kind === "node" && (target.via === "exact" || target.via === "interface" || target.via === "elsewhere");
}
