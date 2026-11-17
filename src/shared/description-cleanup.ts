/* Offers clean-ups for text copied from a PDF, Word or an EXPRESS comment before
 * it becomes a description. Pure, no vscode imports.
 * Non-ASCII matters: the metanorma EXPRESS parser fails on a multi-byte
 * character in a remark.
 */

export type CleanupId = "comment-markers" | "hyphenation" | "hard-wraps" | "ascii";

export interface Cleanup {
  id: CleanupId;
  /** A short plain sentence naming the change and its count. */
  label: string;
  count: number;
}

const ORDER: readonly CleanupId[] = ["comment-markers", "hyphenation", "hard-wraps", "ascii"];

export const ASCII_REPLACEMENTS: ReadonlyMap<string, string> = new Map([
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201C", '"'],
  ["\u201D", '"'],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2026", "..."],
  ["\uFB01", "fi"],
  ["\uFB02", "fl"],
  ["\uFB00", "ff"],
  ["\uFB03", "ffi"],
  ["\uFB04", "ffl"],
  ["\u00A0", " "],
  ["\u2009", " "],
  ["\u202F", " "],
]);

const ASCII_RE = new RegExp(`[${[...ASCII_REPLACEMENTS.keys()].join("")}]`, "g");
const LINE_DASHES_RE = /^([ \t]*)--[ \t]?/gm;
const OPEN_RE = /^\s*\(\*[ \t]?/;
const CLOSE_RE = /[ \t]?\*\)\s*$/;
const HYPHEN_RE = /([A-Za-z])-\r?\n[ \t]*(?=[A-Za-z])/g;
const WRAP_RE = /([^\s])[ \t]*\r?\n[ \t]*(?=\S)/g;

function countMatches(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}

function stripMarkers(text: string): string {
  return text.replace(LINE_DASHES_RE, "$1").replace(OPEN_RE, "").replace(CLOSE_RE, "");
}

function count(text: string, id: CleanupId): number {
  switch (id) {
    case "comment-markers":
      return countMatches(text, LINE_DASHES_RE) + (OPEN_RE.test(text) ? 1 : 0) + (CLOSE_RE.test(text) ? 1 : 0);
    case "hyphenation":
      return countMatches(text, HYPHEN_RE);
    case "hard-wraps":
      return countMatches(text, WRAP_RE);
    case "ascii":
      return countMatches(text, ASCII_RE);
  }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function label(id: CleanupId, n: number): string {
  switch (id) {
    case "comment-markers":
      return `Remove ${n} comment ${plural(n, "marker", "markers")}`;
    case "hyphenation":
      return `Join ${n} ${plural(n, "word", "words")} split by a hyphen at a line end`;
    case "hard-wraps":
      return `Join ${n} hard-wrapped ${plural(n, "line", "lines")} into paragraphs`;
    case "ascii":
      return `Replace ${n} typographic ${plural(n, "character", "characters")} with ASCII`;
  }
}

/** The clean-ups that would change `text`, in application order. */
export function findCleanups(text: string): Cleanup[] {
  const found: Cleanup[] = [];
  for (const id of ORDER) {
    const n = count(text, id);
    if (n > 0) found.push({ id, label: label(id, n), count: n });
  }
  return found;
}

/** Applies the chosen clean-ups in the fixed order, whatever the set's order. */
export function applyCleanups(text: string, ids: ReadonlySet<CleanupId>): string {
  let out = text;
  if (ids.has("comment-markers")) out = stripMarkers(out);
  if (ids.has("hyphenation")) out = out.replace(HYPHEN_RE, "$1");
  if (ids.has("hard-wraps")) out = out.replace(WRAP_RE, "$1 ");
  if (ids.has("ascii")) out = out.replace(ASCII_RE, (c) => ASCII_REPLACEMENTS.get(c) ?? c);
  return out;
}
