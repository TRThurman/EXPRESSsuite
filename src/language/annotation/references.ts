/* Find All References and Rename in description blocks: the places of a file's description text
 * that name a given declaration. The text is read here; whether a path or a word names the
 * declaration is asked of the caller (`express-p11-description-references.ts`), which holds the
 * workspace.
 */
import type { AnnotationBlock, AnnotationContext } from "./blocks.js";
import { findExpressLinks } from "./blocks.js";
import { pathSegments } from "./definition.js";

/** A place in description text that names the declaration sought. Offsets are in the document. */
export interface DescriptionSite {
  /**
   * `key`: a part of a block's key. `link`: a part of the target of an `<<express:...>>`
   * cross-reference. `display`: the display text of a cross-reference whose target is the
   * declaration. `word`: the name written in the text of a block.
   */
  kind: "key" | "link" | "display" | "word";
  start: number;
  end: number;
  /** The text between the offsets. */
  text: string;
}

/** Asked of the caller for each candidate whose text equals the name sought. */
export interface NamesDeclaration {
  /** Whether `path`, a key or a cross-reference target up to one of its parts, names the declaration. */
  path(path: string): boolean;
  /** Whether `word`, written in the text of `block`, names the declaration. */
  word(word: string, block: AnnotationBlock): boolean;
}

const LINK_PREFIX = "<<express:";

/**
 * The parts of a key segment that are names, as offsets in the segment. `wr:label` and `ur:label`:
 * the label. `SELF\supertype.attribute`: the supertype (`entity: true`) and the attribute. A role
 * suffix (`__note`) has none.
 */
export function nameParts(segment: string): Array<{ start: number; end: number; entity?: boolean }> {
  if (segment.startsWith("__")) return [];
  if (/^(?:wr|ur):/i.test(segment)) return [{ start: 3, end: segment.length }];
  const backslash = segment.indexOf("\\");
  if (backslash < 0) return [{ start: 0, end: segment.length }];
  const dot = segment.indexOf(".", backslash);
  if (dot < 0) return [{ start: backslash + 1, end: segment.length, entity: true }];
  return [
    { start: backslash + 1, end: dot, entity: true },
    { start: dot + 1, end: segment.length },
  ];
}

/** The sites of one path (a key or a cross-reference target) that starts at `pathStart` in the document. */
function pathSites(path: string, pathStart: number, kind: "key" | "link", name: string, names: NamesDeclaration): { sites: DescriptionSite[]; whole: boolean } {
  const sites: DescriptionSite[] = [];
  const segments = pathSegments(path);
  let whole = false;
  let lastNamed = segments.length - 1;
  while (lastNamed > 0 && segments[lastNamed].text.startsWith("__")) lastNamed--;
  segments.forEach((segment, index) => {
    for (const part of nameParts(segment.text)) {
      const text = segment.text.slice(part.start, part.end);
      if (text.toLowerCase() !== name) continue;
      // The supertype of `SELF\supertype.attribute` is read in the schema of the path.
      const asked = part.entity ? `${segments[0].text}.${text}` : segments.slice(0, index + 1).map((s) => s.text).join(".");
      if (!names.path(asked)) continue;
      sites.push({ kind, start: pathStart + segment.start + part.start, end: pathStart + segment.start + part.end, text });
      if (index === lastNamed && !part.entity) whole = true;
    }
  });
  return { sites, whole };
}

/**
 * Every place in the description blocks of `contexts` that names the declaration called `name`
 * (compared without regard to case). `text` is the text of the document.
 */
export function descriptionSites(contexts: AnnotationContext[], text: string, name: string, names: NamesDeclaration): DescriptionSite[] {
  const lower = name.toLowerCase();
  const word = new RegExp(`(?<![A-Za-z0-9_])${lower.replace(/[^a-z0-9_]/g, "\\$&")}(?![A-Za-z0-9_])`, "gi");
  const sites: DescriptionSite[] = [];
  for (const context of contexts) {
    for (const block of context.blocks) {
      sites.push(...pathSites(block.key, block.keyStart, "key", lower, names).sites);

      const links = findExpressLinks(block.body);
      for (const link of links) {
        const targetStart = block.bodyStart + link.start + LINK_PREFIX.length;
        const found = pathSites(link.target, targetStart, "link", lower, names);
        sites.push(...found.sites);
        if (found.whole && link.display !== undefined) {
          // The display text follows the comma after the target.
          const start = targetStart + link.target.length + 1;
          sites.push({ kind: "display", start, end: start + link.display.length, text: link.display });
        }
      }

      let asked: boolean | undefined;
      for (const match of block.body.matchAll(word)) {
        if (links.some((link) => match.index >= link.start && match.index < link.end)) continue;
        asked ??= names.word(match[0], block);
        if (!asked) break;
        const start = block.bodyStart + match.index;
        sites.push({ kind: "word", start, end: start + match[0].length, text: text.slice(start, start + match[0].length) });
      }
    }
  }
  return sites.sort((a, b) => a.start - b.start);
}
