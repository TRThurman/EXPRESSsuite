/**
 * Extension-host client for the language server's annotation index
 * (DESIGN §3.2.2). Calls the custom LSP request `express/getAnnotations`
 * and offers the same query surface as `AnnotationIndex` so callers can
 * be migrated incrementally.
 *
 * The local regex parser in `annotation-index.ts` remains the authoritative
 * source for unit tests and as a synchronous fallback when the language
 * client is not yet ready (e.g. during extension activation, before the
 * server has finished its first parse).
 */

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { AnnotationIndex, type RemarkAnnotation } from "./annotation-index.js";

interface CachedIndex {
  version: number;
  index: AnnotationIndexLike;
}

/** Same shape as the local AnnotationIndex's public surface. */
export interface AnnotationIndexLike {
  size(): number;
  allTags(): string[];
  allAnnotations(): readonly RemarkAnnotation[];
  byExactTag(tag: string): readonly RemarkAnnotation[];
  byPath(path: string): RemarkAnnotation[];
  byEntityName(entityName: string): RemarkAnnotation[];
  expressGDiagrams(): Array<{ svgFile: string; entities: string[]; hotspotMap: Record<string, string> }>;
  expressGForEntity(query: string): string[];
}

/** Wraps a precomputed annotation list into the AnnotationIndexLike shape. */
class FrozenAnnotationView implements AnnotationIndexLike {
  constructor(private readonly items: RemarkAnnotation[]) {}

  size(): number { return this.items.length; }

  allTags(): string[] {
    const s = new Set<string>();
    for (const a of this.items) s.add(a.tag);
    return Array.from(s);
  }

  allAnnotations(): readonly RemarkAnnotation[] { return this.items; }

  byExactTag(tag: string): readonly RemarkAnnotation[] {
    return this.items.filter((a) => a.tag === tag);
  }

  byPath(path: string): RemarkAnnotation[] {
    const subtypePrefix = `${path}.__`;
    return this.items.filter((a) => a.tag === path || a.tag.startsWith(subtypePrefix));
  }

  byEntityName(entityName: string): RemarkAnnotation[] {
    return this.items.filter((a) => a.parts.length >= 2 && a.parts[1] === entityName);
  }

  expressGDiagrams(): Array<{ svgFile: string; entities: string[]; hotspotMap: Record<string, string> }> {
    const results: Array<{ svgFile: string; entities: string[]; hotspotMap: Record<string, string> }> = [];
    for (const ann of this.items) {
      if (!ann.tag.endsWith(".__expressg")) continue;
      const imgMatch = /image::([^[\s]+\.svg)\[\]/.exec(ann.body);
      if (!imgMatch) continue;
      const svgFile = imgMatch[1];
      const entities: string[] = [];
      const hotspotMap: Record<string, string> = {};
      const xrefRe = /<<express:([^,>]+?)(?:,[^>]*)?>>/g;
      let m: RegExpExecArray | null;
      while ((m = xrefRe.exec(ann.body)) !== null) entities.push(m[1].trim());
      const bulletRe = /^\*\s+<<express:([^,>]+?)(?:,[^>]*)?>>\s*;\s*(\d+)\s*$/gm;
      while ((m = bulletRe.exec(ann.body)) !== null) hotspotMap[m[2]] = m[1].trim();
      results.push({ svgFile, entities, hotspotMap });
    }
    return results;
  }

  expressGForEntity(query: string): string[] {
    const out = new Set<string>();
    for (const d of this.expressGDiagrams()) {
      for (const e of d.entities) {
        if (e === query) { out.add(d.svgFile); break; }
        const parts = e.split(".");
        if (parts.length >= 2 && parts[1] === query) { out.add(d.svgFile); break; }
      }
    }
    return Array.from(out);
  }
}

const cache = new Map<string, CachedIndex>();

/**
 * Get an annotation index for `doc`. Tries the language server first
 * (single source of truth, single parse). Falls back to local regex
 * parsing if the LSP request fails (server not yet started, custom
 * request not registered, etc.).
 */
export async function getAnnotationIndex(
  doc: vscode.TextDocument,
  client?: LanguageClient,
): Promise<AnnotationIndexLike> {
  const key = doc.uri.toString();
  const cached = cache.get(key);
  if (cached && cached.version === doc.version) return cached.index;

  let index: AnnotationIndexLike;
  if (client) {
    try {
      const annotations = (await client.sendRequest("express/getAnnotations", {
        uri: doc.uri.toString(),
      })) as RemarkAnnotation[];
      if (Array.isArray(annotations) && annotations.length > 0) {
        index = new FrozenAnnotationView(annotations);
      } else {
        // Server returned empty — likely the server hasn't parsed this doc
        // yet (e.g. user just opened the file). Fall through to local parse.
        index = new AnnotationIndex(doc.getText());
      }
    } catch {
      index = new AnnotationIndex(doc.getText());
    }
  } else {
    index = new AnnotationIndex(doc.getText());
  }

  cache.set(key, { version: doc.version, index });
  return index;
}

/** Drop cached index for a document (call from onDidCloseTextDocument). */
export function invalidateAnnotationIndex(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}

/* ----- description resolution ------------------------------------------- */

/** A remark and the document it came from, as the server reports it. */
export interface RemarkHit {
  uri: string;
  annotation: RemarkAnnotation;
}

/** A description for the editor: the remarks under one tag path and the document they live in. */
export interface ResolvedDescription {
  path: string;
  annotations: RemarkAnnotation[];
  sourceUri: vscode.Uri;
}

const TAG_PATH_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

function fromHits(path: string, hits: RemarkHit[], fallback: vscode.Uri): ResolvedDescription | undefined {
  const matching = hits.filter((h) => h.annotation.tag === path || h.annotation.tag.startsWith(`${path}.__`));
  if (matching.length === 0) return undefined;
  const uri = matching[0].uri;
  return {
    path,
    annotations: matching.map((h) => h.annotation),
    sourceUri: typeof uri === "string" && uri.length > 0 ? vscode.Uri.parse(uri) : fallback,
  };
}

/**
 * The description of the word at `position`: first the remarks of the
 * declaration the language server bound the word to, through the schema's
 * USE and REFERENCE statements (ISO 10303-11:2004 clause 11), wherever those
 * remarks live; then the active document's remarks for that name; then any
 * document's. The last two are name-only matches for words the linker does
 * not bind.
 */
export async function resolveDescriptionAt(
  doc: vscode.TextDocument,
  position: vscode.Position,
  word: string,
  client?: LanguageClient,
): Promise<ResolvedDescription | undefined> {
  if (client) {
    try {
      const at = (await client.sendRequest("express/findAnnotationsAt", {
        uri: doc.uri.toString(),
        position: { line: position.line, character: position.character },
      })) as { path: string; annotations: RemarkHit[] } | null;
      if (at && typeof at.path === "string" && Array.isArray(at.annotations)) {
        const resolved = fromHits(at.path, at.annotations, doc.uri);
        if (resolved) return resolved;
      }
    } catch {
      /* server not ready; fall through */
    }
  }
  const idx = await getAnnotationIndex(doc, client);
  const local = idx.byEntityName(word)[0];
  if (local) {
    const path = `${local.parts[0]}.${local.parts[1]}`;
    return { path, annotations: idx.byPath(path), sourceUri: doc.uri };
  }
  if (client) {
    try {
      const remote = (await client.sendRequest("express/findAnnotationsForEntity", { entityName: word })) as RemarkHit[];
      const hit = Array.isArray(remote) ? remote.find((h) => h.annotation.parts.length >= 2 && h.annotation.parts[1] === word) : undefined;
      if (hit) return fromHits(`${hit.annotation.parts[0]}.${hit.annotation.parts[1]}`, remote, doc.uri);
    } catch {
      /* server not ready */
    }
  }
  return undefined;
}

/**
 * The description under a tag path (`schema.entity`), as a `<<express:...>>`
 * cross-reference names it: the active document's remarks first, then any
 * document's.
 */
export async function resolveDescriptionByPath(
  doc: vscode.TextDocument,
  path: string,
  client?: LanguageClient,
): Promise<ResolvedDescription | undefined> {
  if (!TAG_PATH_RE.test(path)) return undefined;
  const idx = await getAnnotationIndex(doc, client);
  const local = idx.byPath(path);
  if (local.length > 0) return { path, annotations: local, sourceUri: doc.uri };
  if (!client) return undefined;
  try {
    const remote = (await client.sendRequest("express/findAnnotationsByPath", { path })) as RemarkHit[];
    return Array.isArray(remote) ? fromHits(path, remote, doc.uri) : undefined;
  } catch {
    return undefined;
  }
}
