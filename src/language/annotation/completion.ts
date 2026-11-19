/* Type-ahead in description blocks: where the cursor stands in the text after `END_SCHEMA;`, and
 * what the text typed so far is. The text is read here; what is offered there comes from the
 * workspace (`express-p11-description-completion.ts`).
 */
import { isLongFormSchemaName } from "../express-p11-scope-index.js";
import type { AnnotationBlock, AnnotationContext } from "./blocks.js";

/**
 * A place in description text where names are offered. Offsets are in the document. `partEnd`:
 * where the part of the key or target under the cursor ends, so that an entry replaces all of it.
 */
export type CompletionSite =
  /** In the key of a block, the closing quote typed or not. `typed`: the key up to the cursor. */
  | { kind: "key"; schema: string; typed: string; start: number; partEnd: number }
  /**
   * In the target of an `<<express:...>>` cross-reference. `typed`: the target up to the cursor.
   * `partEnd`: where the part under the cursor ends; `end`: where the target ends.
   * `closed`: a `,` or `>>` already follows the target. `mapping`: the block is a `.__expressg`
   * one, whose lines end `>>; ` and an area number.
   */
  | { kind: "link"; block: AnnotationBlock; typed: string; start: number; partEnd: number; end: number; closed: boolean; mapping: boolean }
  /** After the `**` that opens a bold name. `closed`: the closing `**` already follows. */
  | { kind: "bold"; block: AnnotationBlock; typed: string; start: number; closed: boolean }
  /** Anywhere else in the text of a block. `typed`: the name being written, or nothing. */
  | { kind: "word"; block: AnnotationBlock; typed: string; start: number };

const KEY_OPEN = /\(\*[\t ]*"([^"\r\n]*)$/;
const LINK_OPEN = /<<express:([^,>\s]*)$/;
const BOLD_OPEN = /\*\*([A-Za-z0-9_]*)$/;
const WORD = /[A-Za-z_][A-Za-z0-9_]*$/;
/** The rest of one part of a key or of a target after the cursor: up to the dot, the quote or whatever ends the name. */
const NAME_PART = /^[A-Za-z0-9_:\\]*/;

/**
 * The site at `offset`, or `undefined` when nothing is offered there: inside a schema, in a long
 * form, in an unkeyed remark, or outside every remark.
 */
export function completionSiteAt(contexts: AnnotationContext[], text: string, offset: number): CompletionSite | undefined {
  const context = contexts.find((candidate) => offset >= candidate.start && offset <= candidate.end);
  if (!context || isLongFormSchemaName(context.schema)) return undefined;
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(lineStart, offset);

  const key = KEY_OPEN.exec(before);
  if (key) return { kind: "key", schema: context.schema, typed: key[1], start: offset - key[1].length, partEnd: offset + NAME_PART.exec(text.slice(offset))![0].length };

  const block = context.blocks.find((candidate) => offset > candidate.keyEnd && offset <= bodyEnd(candidate, text));
  if (!block) return undefined;

  const link = LINK_OPEN.exec(before);
  if (link) {
    // Only what a target is written with: a `*)` right after the cursor is not part of it.
    const rest = /^[A-Za-z0-9_.:\\]*/.exec(text.slice(offset))![0];
    const after = text.slice(offset + rest.length, offset + rest.length + 2);
    return {
      kind: "link",
      block,
      typed: link[1],
      start: offset - link[1].length,
      partEnd: offset + NAME_PART.exec(rest)![0].length,
      end: offset + rest.length,
      closed: after.startsWith(",") || after === ">>",
      mapping: /\.__expressg$/i.test(block.key),
    };
  }

  const bold = BOLD_OPEN.exec(before);
  // An even number of `**` before this one: it opens a bold name.
  if (bold && (before.slice(0, bold.index).split("**").length - 1) % 2 === 0) {
    const rest = /^[A-Za-z0-9_]*/.exec(text.slice(offset))![0];
    return { kind: "bold", block, typed: bold[1], start: offset - bold[1].length, closed: text.startsWith("**", offset + rest.length) };
  }

  const word = WORD.exec(before)?.[0] ?? "";
  return { kind: "word", block, typed: word, start: offset - word.length };
}

/** The offset where the text of `block` ends: before its closing `*)`, when it has one. */
function bodyEnd(block: AnnotationBlock, text: string): number {
  return text.startsWith("*)", block.end - 2) ? block.end - 2 : block.end;
}

/** The roles a schema-level key may end with, and those of a declaration or one of its members. */
export const SCHEMA_ROLES = ["__expressg", "__fund_cons", "__note", "__example", "__figure", "__table"] as const;
export const ITEM_ROLES = ["__note", "__example", "__figure", "__table"] as const;

/** The name written in words, as the display text of a cross-reference: `coating_rule` gives `coating rule`. */
export function inWords(name: string): string {
  return name.replace(/_+/g, " ").trim();
}
