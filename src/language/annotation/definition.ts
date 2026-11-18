/* Go to Definition from inside a description block: which declaration the text at an offset names.
 * The key of a block, an `<<express:...>>` cross-reference and a plain name are read here; the
 * provider (`express-p11-definition-provider.ts`) turns the nodes found into locations.
 */
import type { AstNode, NameProvider } from "langium";
import type { ExpressFile, SchemaDefinition } from "../generated/ast.js";
import type { AnnotationBlock, AnnotationContext } from "./blocks.js";
import { findExpressLinks } from "./blocks.js";
import { keyedNodes } from "./keys.js";
import type { LinkResolver } from "./link-resolver.js";

/** What the text at an offset of a description block names. */
export interface DescriptionReference {
  /**
   * `key`: a segment of the block's key. `link`: a segment of the target of an `<<express:...>>`
   * cross-reference, or its display text. `word`: a name in the text of the block.
   */
  kind: "key" | "link" | "word";
  /** For `key` and `link`, the path up to and including the segment at the offset; for `word`, the name. */
  path: string;
  /** Offsets in the document of the text that names the target. */
  start: number;
  end: number;
  block: AnnotationBlock;
}

/**
 * How a target was found. `exact`: the path is the key of the node. `proposition`: the `--IPn:` line
 * of an informal proposition. `interface`: the schema named does not declare the name and reaches it
 * through its interfaces. `elsewhere`: one other schema, which the schema named does not interface,
 * declares it. `ambiguous`: several other schemas declare it, and each is offered. `nearest`: the last
 * part names nothing anywhere, and the owner or the schema stands in.
 */
export type DescriptionRoute = "exact" | "proposition" | "interface" | "elsewhere" | "ambiguous" | "nearest";

/** A target of Go to Definition: a node, or a line of the file for an informal proposition's signature. */
export type DescriptionTarget =
  | { kind: "node"; node: AstNode; via: DescriptionRoute }
  | { kind: "text"; owner: AstNode; start: number; end: number; via: DescriptionRoute };

const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LINK_PREFIX = "<<express:";

/**
 * The segments of a key or link target, with their offsets in it. A redeclared attribute written
 * `SELF\supertype.attribute` is one segment: the dot inside it does not separate.
 */
export function pathSegments(path: string): Array<{ text: string; start: number; end: number }> {
  const segments: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  const parts = path.split(".");
  for (let i = 0; i < parts.length; i++) {
    let text = parts[i];
    if (text.includes("\\") && i + 1 < parts.length) {
      text = `${text}.${parts[i + 1]}`;
      i++;
    }
    segments.push({ text, start, end: start + text.length });
    start += text.length + 1;
  }
  return segments;
}

function segmentAt(path: string, pathStart: number, offset: number): { path: string; start: number; end: number } {
  const segments = pathSegments(path);
  let index = segments.findIndex((segment) => offset <= pathStart + segment.end);
  if (index < 0) index = segments.length - 1;
  const segment = segments[index];
  return {
    path: segments.slice(0, index + 1).map((s) => s.text).join("."),
    start: pathStart + segment.start,
    end: pathStart + segment.end,
  };
}

/** The reference at `offset`, when it lies in a keyed description block of `contexts`. */
export function descriptionReferenceAt(contexts: AnnotationContext[], text: string, offset: number): DescriptionReference | undefined {
  let block: AnnotationBlock | undefined;
  for (const context of contexts) {
    if (offset < context.start || offset > context.end) continue;
    block = context.blocks.find((candidate) => offset >= candidate.start && offset < candidate.end);
    if (block) break;
  }
  if (!block) return undefined;

  if (offset >= block.keyStart && offset <= block.keyEnd) {
    return { kind: "key", block, ...segmentAt(block.key, block.keyStart, offset) };
  }

  const bodyEnd = block.bodyStart + block.body.length;
  if (offset < block.bodyStart || offset > bodyEnd) return undefined;
  const inBody = offset - block.bodyStart;
  for (const link of findExpressLinks(block.body)) {
    if (inBody < link.start || inBody >= link.end) continue;
    const targetStart = block.bodyStart + link.start + LINK_PREFIX.length;
    const targetEnd = targetStart + link.target.length;
    if (offset >= targetStart && offset <= targetEnd) {
      return { kind: "link", block, ...segmentAt(link.target, targetStart, offset) };
    }
    // The display text, the comma or the brackets: the whole cross-reference names its target.
    return { kind: "link", block, path: link.target, start: block.bodyStart + link.start, end: block.bodyStart + link.end };
  }

  let start = offset;
  let end = offset;
  while (start > block.bodyStart && IDENTIFIER_CHAR.test(text[start - 1])) start--;
  while (end < bodyEnd && IDENTIFIER_CHAR.test(text[end])) end++;
  const word = text.slice(start, end);
  if (!IDENTIFIER.test(word)) return undefined;
  return { kind: "word", block, path: word, start, end };
}

/** The last segment of a key without its role suffixes (`.__note`, `.__example`, `.__figure`, ...). */
function withoutRoles(segments: string[]): string[] {
  const kept = [...segments];
  while (kept.length > 1 && kept[kept.length - 1].startsWith("__")) kept.pop();
  return kept;
}

/** `wr:IP1`, or the malformed `IP1`: an informal proposition, which the schema carries as a `--IP1:` line. */
const INFORMAL_PROPOSITION = /^(?:wr:)?(ip[0-9]+)$/i;

export interface SchemaSource {
  /** Every loaded file that declares a schema of this name (compared without regard to case). */
  rootsOf(schema: string): Array<{ root: ExpressFile; text: string }>;
}

/** Finds the declarations that a {@link DescriptionReference} names. */
export class DescriptionTargets {
  constructor(
    private readonly source: SchemaSource,
    private readonly links: LinkResolver,
    private readonly nameProvider: NameProvider,
  ) {}

  /** The keyed nodes of each file read so far: one finder serves one request, in which no file changes. */
  private readonly keyed = new Map<ExpressFile, Map<string, AstNode>>();

  private nodesOf(root: ExpressFile): Map<string, AstNode> {
    let nodes = this.keyed.get(root);
    if (!nodes) {
      nodes = keyedNodes(root, this.nameProvider);
      this.keyed.set(root, nodes);
    }
    return nodes;
  }

  /** The targets of `reference`, read in `schema` (the schema whose description context holds the block). */
  find(reference: DescriptionReference, schema: SchemaDefinition | undefined): DescriptionTarget[] {
    if (reference.kind !== "word") return this.ofPath(reference.path);
    return this.ofWord(reference.path, reference.block, schema);
  }

  /**
   * `schema`, `schema.declaration`, `schema.owner.member`, `schema.owner.wr:label`, `schema.owner.ur:label`,
   * `schema.owner.wr:IPn`, each with or without role suffixes. When the schema named does not declare
   * the name, the declaration it reaches through its interfaces is taken, then the declarations of
   * that name in other schemas. A path whose last part names nothing goes to the nearest subject that
   * exists: the owner, then the schema.
   */
  ofPath(path: string, follow = true): DescriptionTarget[] {
    const segments = withoutRoles(pathSegments(path).map((segment) => segment.text));
    const [schema, ...rest] = segments;
    const targets: DescriptionTarget[] = [];
    for (const { root, text } of this.source.rootsOf(schema)) {
      const nodes = this.nodesOf(root);
      const base = schema.toLowerCase();
      const node = (...names: string[]): AstNode | undefined => nodes.get([base, ...names].join(".").toLowerCase());
      const schemaNode = nodes.get(base);
      if (rest.length === 0) {
        if (schemaNode) targets.push({ kind: "node", node: schemaNode, via: "exact" });
        continue;
      }
      const owner = node(rest[0]);
      if (!owner) {
        // The name is not this schema's own: an interfaced declaration, described or cited under this schema's name.
        const moved = follow && schemaNode ? this.throughInterfaces(schemaNode as SchemaDefinition, rest) : [];
        if (moved.length > 0) targets.push(...moved);
        else if (schemaNode) targets.push({ kind: "node", node: schemaNode, via: "nearest" });
        continue;
      }
      if (rest.length === 1) {
        targets.push({ kind: "node", node: owner, via: "exact" });
        continue;
      }
      // The member: an attribute (also written `SELF\supertype.attribute`), an enumeration item,
      // a parameter, a WHERE or UNIQUE rule (also written without `wr:` or `ur:`), an informal proposition.
      const last = rest[rest.length - 1].replace(/^.*\\[^.]*\./, "");
      const member = node(rest[0], last) ?? node(rest[0], `wr:${last}`) ?? node(rest[0], `ur:${last}`);
      if (member) {
        targets.push({ kind: "node", node: member, via: "exact" });
        continue;
      }
      const proposition = INFORMAL_PROPOSITION.exec(last);
      if (proposition) {
        const signature = signatureOf(owner, proposition[1], text);
        if (signature) targets.push({ kind: "text", owner, ...signature, via: "proposition" });
        else targets.push({ kind: "node", node: owner, via: "proposition" });
        continue;
      }
      targets.push({ kind: "node", node: owner, via: "nearest" });
    }
    return targets;
  }

  /**
   * `rest` read in the schema that declares `rest[0]`: the one `from` reaches through its interfaces,
   * or the one other schema that declares it, or each of the schemas that do.
   */
  private throughInterfaces(from: SchemaDefinition, rest: string[]): DescriptionTarget[] {
    const resolution = this.links.resolve(from, rest[0]);
    if (resolution.kind === "none") return [];
    const homes: Array<{ schema: string; name: string }> =
      resolution.kind === "reachable"
        ? [{ schema: resolution.schema, name: resolution.name }]
        : resolution.kind === "unique-elsewhere"
          ? [{ schema: resolution.schema, name: rest[0] }]
          : resolution.schemas.map((schema) => ({ schema, name: rest[0] }));
    const via: DescriptionRoute = resolution.kind === "reachable" ? "interface" : resolution.kind === "unique-elsewhere" ? "elsewhere" : "ambiguous";
    return homes
      .flatMap((home) => this.ofPath([home.schema, home.name, ...rest.slice(1)].join("."), false))
      .map((target) => ({ ...target, via: target.via === "exact" ? via : target.via }));
  }

  /**
   * A name in the text of a block: a member of the block's subject (an attribute of the entity
   * described, a parameter of the function), then a declaration of the block's schema, then what
   * the schema reaches through its interfaces, then a declaration found in one other schema only,
   * then a schema of that name. A name that several schemas could mean yields each of them.
   */
  private ofWord(word: string, block: AnnotationBlock, schema: SchemaDefinition | undefined): DescriptionTarget[] {
    const key = withoutRoles(pathSegments(block.key).map((segment) => segment.text));
    const home = key[0] ?? block.schema;
    if (key.length >= 2) {
      const member = this.exact(`${home}.${key[1]}.${word}`);
      if (member.length > 0) return member;
    }
    const local = this.exact(`${home}.${word}`);
    if (local.length > 0) return local;
    if (schema) {
      const resolution = this.links.resolve(schema, word);
      if (resolution.kind === "reachable") return this.exact(`${resolution.schema}.${resolution.name}`);
      if (resolution.kind === "unique-elsewhere") return this.exact(`${resolution.schema}.${word}`);
      if (resolution.kind === "ambiguous") return resolution.schemas.flatMap((other) => this.exact(`${other}.${word}`));
    }
    return this.exact(word);
  }

  /** As {@link ofPath}, without the fall back to the owner or the schema. */
  private exact(path: string): DescriptionTarget[] {
    const segments = pathSegments(path).map((segment) => segment.text);
    const targets: DescriptionTarget[] = [];
    for (const { root } of this.source.rootsOf(segments[0])) {
      const found = this.nodesOf(root).get(path.toLowerCase());
      if (found) targets.push({ kind: "node", node: found, via: "exact" });
    }
    return targets;
  }
}

/** The `--IPn:` line inside `owner`, as offsets in `text`. */
function signatureOf(owner: AstNode, ip: string, text: string): { start: number; end: number } | undefined {
  const cst = owner.$cstNode;
  if (!cst) return undefined;
  const inside = text.slice(cst.offset, cst.end);
  const line = new RegExp(`^[\\t ]*--[\\t ]*(${ip})\\b[^\\r\\n]*`, "im").exec(inside);
  if (!line) return undefined;
  const start = cst.offset + line.index + line[0].indexOf("--");
  return { start, end: cst.offset + line.index + line[0].length };
}
