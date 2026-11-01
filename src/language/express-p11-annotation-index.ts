/**
 * Annotation index service (Langium server-side, DESIGN §3.2.2).
 *
 * Collects the named remarks `(*"tag" body *)` of every document from the
 * hidden ML_COMMENT leaves of its CST, as the document is parsed, and answers
 * the extension host's custom requests (`express/getAnnotations`,
 * `express/findAnnotationsForEntity`, `express/findAnnotationsByPath`,
 * `express/findAnnotationsAt`).
 *
 * A document parsed before this service existed, or whose parse phase was
 * not observed, is indexed the first time it is asked about, so an answer
 * never depends on when the first request arrived. The service is also
 * created with the server (src/language/main.ts) so the parse-phase listener
 * is in place for the workspace's initial build.
 */

import {
  type AstNode,
  AstUtils,
  type CstNode,
  CstUtils,
  DocumentState,
  type LangiumDocument,
  type LangiumDocuments,
  type NameProvider,
  type ServiceRegistry,
  URI,
} from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import type { Position } from "vscode-languageserver";
import { isDeclaration, isSchemaDefinition } from "./generated/ast.js";

/** Iterate every CST node (depth-first). `streamCst` is not on Langium's public surface. */
function* walkCst(root: CstNode): IterableIterator<CstNode> {
  yield root;
  const children = (root as { content?: CstNode[] }).content;
  if (children) {
    for (const c of children) yield* walkCst(c);
  }
}

export interface ServerRemarkAnnotation {
  /** Full tag, e.g. "geometry_schema.point" or "geometry_schema.point.__note". */
  tag: string;
  /** Tag split on ".": ["geometry_schema", "point", "__note"]. */
  parts: string[];
  /** AsciiDoc body, trimmed. */
  body: string;
  /** Byte offsets into the source text. */
  startOffset: number;
  endOffset: number;
}

/** A remark together with the document it was read from. */
export interface AnnotationHit {
  uri: string;
  annotation: ServerRemarkAnnotation;
}

/** The remarks of the declaration a position denotes, keyed by the declaration's tag path. */
export interface AnnotationsAtResult {
  path: string;
  annotations: AnnotationHit[];
}

// Cross-platform: exclude both \n and \r from the tag string so CRLF files
// don't capture a stray \r. Body uses [\s\S]*? which is line-ending agnostic.
const REMARK_RE = /\(\*\s*"([^"\r\n]+)"([\s\S]*?)\*\)/g;

function parseRemark(text: string, baseOffset: number): ServerRemarkAnnotation | undefined {
  REMARK_RE.lastIndex = 0;
  const m = REMARK_RE.exec(text);
  if (!m) return undefined;
  const tag = m[1].trim();
  return {
    tag,
    parts: tag.split("."),
    body: m[2].trim(),
    startOffset: baseOffset + m.index,
    endOffset: baseOffset + m.index + m[0].length,
  };
}

/** `tag` names `path` itself or one of its `__` variants (`path.__note`, `path.__example`, ...). */
function tagMatchesPath(tag: string, path: string): boolean {
  return tag === path || tag.startsWith(`${path}.__`);
}

export class ExpressP11AnnotationIndex {
  /** Per-document URI string → annotations in source order. */
  private readonly index = new Map<string, ServerRemarkAnnotation[]>();
  private readonly documents: LangiumDocuments;
  private readonly serviceRegistry: ServiceRegistry;

  constructor(services: LangiumSharedServices) {
    this.documents = services.workspace.LangiumDocuments;
    this.serviceRegistry = services.ServiceRegistry;
    // Refresh on every parse — earliest state where the CST is available.
    services.workspace.DocumentBuilder.onBuildPhase(DocumentState.Parsed, async (documents) => {
      for (const doc of documents) {
        this.refresh(doc);
      }
    });
    // Also drop on document close.
    services.workspace.DocumentBuilder.onUpdate((_changed, deleted) => {
      for (const uri of deleted) {
        this.index.delete(uri.toString());
      }
    });
  }

  private refresh(doc: LangiumDocument): ServerRemarkAnnotation[] {
    const out: ServerRemarkAnnotation[] = [];
    const cst = doc.parseResult.value.$cstNode;
    if (cst) {
      for (const node of walkCst(cst)) {
        if (!isHiddenMlComment(node)) continue;
        const ann = parseRemark(node.text, node.offset);
        if (ann) out.push(ann);
      }
    }
    this.index.set(doc.uri.toString(), out);
    return out;
  }

  /** The indexed remarks of `doc`, indexing it now if its parse was not observed. */
  private annotationsOf(doc: LangiumDocument): readonly ServerRemarkAnnotation[] {
    const known = this.index.get(doc.uri.toString());
    if (known) return known;
    if (doc.state < DocumentState.Parsed) return [];
    return this.refresh(doc);
  }

  private *everyDocument(): IterableIterator<[uri: string, annotations: readonly ServerRemarkAnnotation[]]> {
    for (const doc of this.documents.all) {
      yield [doc.uri.toString(), this.annotationsOf(doc)];
    }
  }

  getAnnotations(uri: URI | string): readonly ServerRemarkAnnotation[] {
    const parsed = typeof uri === "string" ? URI.parse(uri) : uri;
    const known = this.index.get(parsed.toString());
    if (known) return known;
    const doc = this.documents.getDocument(parsed);
    return doc ? this.annotationsOf(doc) : [];
  }

  /**
   * Find annotations across every document whose tag has `entityName` as
   * the second segment (i.e. `*.entityName` or `*.entityName.__*`). The
   * name-only fallback of the hover provider, used when the word at the
   * cursor is not a bound reference.
   */
  findByEntityName(entityName: string): AnnotationHit[] {
    const out: AnnotationHit[] = [];
    for (const [uri, anns] of this.everyDocument()) {
      for (const annotation of anns) {
        if (annotation.parts.length >= 2 && annotation.parts[1] === entityName) {
          out.push({ uri, annotation });
        }
      }
    }
    return out;
  }

  /** The remarks tagged `path` or one of its `__` variants, in any document. */
  findByPath(path: string): AnnotationHit[] {
    const out: AnnotationHit[] = [];
    for (const [uri, anns] of this.everyDocument()) {
      for (const annotation of anns) {
        if (tagMatchesPath(annotation.tag, path)) out.push({ uri, annotation });
      }
    }
    return out;
  }

  /**
   * The remarks of the declaration the word at `position` denotes: the
   * declaration the linker bound the reference to, through the schema's USE
   * and REFERENCE statements (ISO 10303-11:2004 clause 11), or the
   * declaration itself when the position is on its name. The tag path is
   * `schema.declaration`, or `schema.owner.member` for an attribute or an
   * enumeration item; `schema` alone for the schema's name. `undefined` when
   * the position denotes no declaration or none of them has a remark.
   */
  annotationsAt(uri: string, position: Position): AnnotationsAtResult | undefined {
    const doc = this.documents.getDocument(URI.parse(uri));
    const root = doc?.parseResult.value.$cstNode;
    if (!doc || !root || doc.state < DocumentState.Parsed) return undefined;
    const leaf = CstUtils.findLeafNodeAtOffset(root, doc.textDocument.offsetAt(position));
    if (!leaf) return undefined;
    const services = this.serviceRegistry.getServices(doc.uri);
    const nameProvider = services.references.NameProvider;
    let declarations: AstNode[];
    try {
      // A reference yields what it bound to; a declaration's own name yields the declaration.
      declarations = services.references.References.findDeclarations(leaf);
    } catch {
      return undefined;
    }
    for (const declaration of declarations) {
      const path = tagPathOf(declaration, nameProvider);
      if (!path) continue;
      const annotations = this.findByPath(path);
      if (annotations.length > 0) return { path, annotations };
    }
    return undefined;
  }
}

/** The tag path under which stepmod describes `node`, or `undefined` when it has no name. */
export function tagPathOf(node: AstNode, nameProvider: NameProvider): string | undefined {
  if (isSchemaDefinition(node)) return node.name || undefined;
  const schema = AstUtils.getContainerOfType(node, isSchemaDefinition);
  if (!schema?.name) return undefined;
  const name = nameProvider.getName(node);
  if (!name) return undefined;
  if (isDeclaration(node)) return `${schema.name}.${name}`;
  // An attribute, an enumeration item, a local of a function: the member of
  // the nearest enclosing declaration.
  const owner = AstUtils.getContainerOfType(node.$container, isDeclaration);
  const ownerName = owner ? nameProvider.getName(owner) : undefined;
  return ownerName ? `${schema.name}.${ownerName}.${name}` : `${schema.name}.${name}`;
}

function isHiddenMlComment(node: CstNode): boolean {
  if (!node.hidden) return false;
  // Leaf CstNode has tokenType; non-leaves don't.
  const tokenType = (node as { tokenType?: { name?: string } }).tokenType;
  return tokenType?.name === "ML_COMMENT";
}
