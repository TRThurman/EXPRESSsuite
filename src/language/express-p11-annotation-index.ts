/**
 * Annotation index service (Langium server-side, DESIGN §3.2.2).
 *
 * Walks the CST for ML_COMMENT hidden leaves on each document parse and
 * extracts named-remark annotations of the form `(*"tag" body *)`.
 * Exposed to the extension host via the custom LSP request
 * `express/getAnnotations`.
 *
 * The Phase 2 regex parser lived in the extension host (src/extension/
 * annotation-index.ts) and ran on every hover. This service moves the
 * parse work to the language server, where it runs once per document
 * change as part of the existing build pipeline.
 */

import {
  type CstNode,
  type LangiumDocument,
  DocumentState,
  URI,
} from "langium";
import type { LangiumSharedServices } from "langium/lsp";

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

const REMARK_RE = /\(\*\s*"([^"\n]+)"([\s\S]*?)\*\)/g;

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

export class ExpressP11AnnotationIndex {
  /** Per-document URI string → annotations in source order. */
  private readonly index = new Map<string, ServerRemarkAnnotation[]>();

  constructor(services: LangiumSharedServices) {
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

  private refresh(doc: LangiumDocument): void {
    const cst = doc.parseResult.value.$cstNode;
    if (!cst) {
      this.index.set(doc.uri.toString(), []);
      return;
    }
    const out: ServerRemarkAnnotation[] = [];
    for (const node of walkCst(cst)) {
      if (!isHiddenMlComment(node)) continue;
      const ann = parseRemark(node.text, node.offset);
      if (ann) out.push(ann);
    }
    this.index.set(doc.uri.toString(), out);
  }

  getAnnotations(uri: URI | string): readonly ServerRemarkAnnotation[] {
    const key = typeof uri === "string" ? uri : uri.toString();
    return this.index.get(key) ?? [];
  }
}

function isHiddenMlComment(node: CstNode): boolean {
  if (!node.hidden) return false;
  // Leaf CstNode has tokenType; non-leaves don't.
  const tokenType = (node as { tokenType?: { name?: string } }).tokenType;
  return tokenType?.name === "ML_COMMENT";
}
