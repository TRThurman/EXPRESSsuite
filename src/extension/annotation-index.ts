/**
 * Annotation index for EXPRESS named remarks: (*"tag" body *)
 *
 * Per DESIGN-viewers-integration.md §1.2.4 the eventual home is a Langium
 * server-side service walking ML_COMMENT hidden CST leaves. For the Phase 2
 * POC this runs in the extension host with a regex over file contents — the
 * same regex shape the CST path would use on each leaf's text.
 */

export interface RemarkAnnotation {
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

export class AnnotationIndex {
  private readonly byTag = new Map<string, RemarkAnnotation[]>();
  private readonly all: RemarkAnnotation[] = [];

  constructor(text: string) {
    REMARK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REMARK_RE.exec(text)) !== null) {
      const tag = m[1].trim();
      const body = m[2].trim();
      const ann: RemarkAnnotation = {
        tag,
        parts: tag.split("."),
        body,
        startOffset: m.index,
        endOffset: m.index + m[0].length,
      };
      this.all.push(ann);
      const existing = this.byTag.get(tag);
      if (existing) existing.push(ann);
      else this.byTag.set(tag, [ann]);
    }
  }

  /** All annotations in document order. */
  allAnnotations(): readonly RemarkAnnotation[] {
    return this.all;
  }

  /** Exact-tag lookup. Multiple results possible (e.g. several `__note`s on one entity). */
  byExactTag(tag: string): readonly RemarkAnnotation[] {
    return this.byTag.get(tag) ?? [];
  }

  /**
   * Look up annotations attached to a path (`schema.entity`, `schema.entity.attribute`).
   * Returns the entity-level remark plus any subtype variants (`__note`, `__example`, …).
   */
  byPath(path: string): RemarkAnnotation[] {
    const subtypePrefix = `${path}.__`;
    const out: RemarkAnnotation[] = [];
    for (const ann of this.all) {
      if (ann.tag === path || ann.tag.startsWith(subtypePrefix)) {
        out.push(ann);
      }
    }
    return out;
  }

  /**
   * Look up by simple entity name across any schema: matches `*.entityName`
   * and `*.entityName.__*`.
   */
  byEntityName(entityName: string): RemarkAnnotation[] {
    const out: RemarkAnnotation[] = [];
    for (const ann of this.all) {
      const p = ann.parts;
      if (p.length >= 2 && p[1] === entityName) out.push(ann);
    }
    return out;
  }

  /** All distinct tag strings. */
  allTags(): string[] {
    return Array.from(this.byTag.keys());
  }

  size(): number {
    return this.all.length;
  }
}
