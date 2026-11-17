import type { ExpressFile } from "../generated/ast.js";

export interface AnnotationBlock {
  key: string;
  /** Text between the key and the closing `*)`, trimmed. */
  body: string;
  /** Offsets of the whole `(* ... *)` remark. */
  start: number;
  end: number;
  /** Offsets of the key text, without its quotes. */
  keyStart: number;
  keyEnd: number;
  /** Offset of the first character of `body` (the end of the key's quote when the body is empty). */
  bodyStart: number;
  schema: string;
}

export interface UnkeyedRemark {
  start: number;
  end: number;
  schema: string;
}

/** The text after one schema's `END_SCHEMA;` up to the next `SCHEMA` (or the end of the file). */
export interface AnnotationContext {
  schema: string;
  start: number;
  end: number;
  blocks: AnnotationBlock[];
  unkeyed: UnkeyedRemark[];
}

export interface ExpressLink {
  target: string;
  display?: string;
  /** Offsets in the body. */
  start: number;
  end: number;
}

/** Offset just past the `*)` closing the remark that opens at `open`; `limit` when it never closes. */
function remarkEnd(text: string, open: number, limit: number): number {
  let depth = 0;
  let i = open;
  while (i < limit) {
    if (text.startsWith("(*", i)) {
      depth++;
      i += 2;
    } else if (text.startsWith("*)", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return limit;
}

function scanContext(schema: string, text: string, start: number, end: number): AnnotationContext {
  const context: AnnotationContext = { schema, start, end, blocks: [], unkeyed: [] };
  let i = start;
  while (i < end) {
    if (text.startsWith("--", i)) {
      while (i < end && text[i] !== "\n") i++;
    } else if (text[i] === "'") {
      i++;
      while (i < end && text[i] !== "\n") {
        if (text[i] === "'") {
          if (text[i + 1] === "'") i++;
          else break;
        }
        i++;
      }
      i++;
    } else if (text.startsWith("(*", i)) {
      const close = remarkEnd(text, i, end);
      const inner = text.slice(i + 2, close);
      const keyed = /^\s*"([^"\r\n]+)"/.exec(inner);
      if (keyed) {
        const keyStart = i + 2 + keyed[0].length - 1 - keyed[1].length;
        const afterKey = i + 2 + keyed[0].length;
        const bodyEnd = text.startsWith("*)", close - 2) ? close - 2 : close;
        const raw = text.slice(afterKey, bodyEnd);
        const lead = raw.length - raw.trimStart().length;
        const body = raw.trim();
        context.blocks.push({
          key: keyed[1],
          body,
          start: i,
          end: close,
          keyStart,
          keyEnd: keyStart + keyed[1].length,
          bodyStart: body ? afterKey + lead : afterKey,
          schema,
        });
      } else {
        context.unkeyed.push({ start: i, end: close, schema });
      }
      i = close;
    } else {
      i++;
    }
  }
  return context;
}

export function annotationContexts(root: ExpressFile, text: string): AnnotationContext[] {
  const schemas = root.schemas.filter((s) => s.$cstNode);
  return schemas.map((schema, index) => {
    const end = index + 1 < schemas.length ? schemas[index + 1].$cstNode!.offset : text.length;
    return scanContext(schema.name, text, schema.$cstNode!.end, end);
  });
}

const LINK_RE = /<<express:([^,>\s]+)(?:,([^>]*))?>>/g;

export function findExpressLinks(body: string): ExpressLink[] {
  const links: ExpressLink[] = [];
  for (const m of body.matchAll(LINK_RE)) {
    links.push({ target: m[1], display: m[2], start: m.index, end: m.index + m[0].length });
  }
  return links;
}

/** Offset just past the first sentence of `body`; `body.length` when no sentence ends. */
export function firstSentenceEnd(body: string): number {
  const links = findExpressLinks(body);
  let i = 0;
  while (i < body.length) {
    const link = links.find((l) => l.start === i);
    if (link) {
      i = link.end;
      continue;
    }
    if (body[i] === "." && (i + 1 === body.length || /\s/.test(body[i + 1])) && !/(?:^|[^A-Za-z])(?:e\.g|i\.e)$/i.test(body.slice(0, i))) {
      return i + 1;
    }
    i++;
  }
  return body.length;
}
