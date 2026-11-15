/**
 * A line classifier for the AsciiDoc of a description block.
 *
 * The publication pipeline rewrites description text line by line, and several of its constructs mean
 * different things in different places (a `+` after a list item attaches a block, after a paragraph it is text;
 * a block macro in a cell works in an `a|` cell only). This module gives each line its kind and its
 * surroundings (the delimiter pairs, the table cell styles), so that a rule decides from the context and
 * never from the line alone.
 *
 * It classifies; it does not render. Known simplifications: a block attribute line is any `[...]` line; the
 * rowspans of a table are not tracked when counting the columns of a row.
 */

export type ListKind = "bullet" | "dash" | "ordered" | "number" | "alpha" | "roman" | "checklist" | "description";

export interface ListMarker {
  kind: ListKind;
  /** The marker as written (`**`, `1.`, `term::`). */
  marker: string;
  /** The nesting level the marker itself gives: its length for `*` and `.`, 1 otherwise; the colons minus one for `term:::`. */
  depth: number;
}

export type DelimiterKind = "listing" | "literal" | "example" | "sidebar" | "quote" | "open" | "passthrough" | "comment" | "table";

export interface Delimiter {
  kind: DelimiterKind;
  text: string;
  role: "open" | "close";
  /** Index of the line holding the other delimiter of the pair; -1 when the block is never closed (or closes nothing). */
  match: number;
}

export interface BlockMacro {
  name: string;
  /** Offsets in the line text. */
  start: number;
  end: number;
}

export interface CellSegment {
  /** Offsets in the original text; the part of the line that belongs to one cell. */
  start: number;
  end: number;
  /** The style the cell's specifier gives, as written (`a` in `2+a|`). */
  style?: string;
  /** True when the cell holds AsciiDoc: its specifier says `a`, or no specifier style and its column says `a`. */
  asciidoc: boolean;
  /** True when the segment starts with the cell's specifier and `|`, false when it continues a cell from an earlier line. */
  startsCell: boolean;
}

export type LineKind =
  | "blank"
  | "comment"
  | "list-item"
  | "continuation"
  | "block-macro"
  | "delimiter"
  | "verbatim"
  | "table-line"
  | "block-attribute"
  | "block-title"
  | "text";

export interface AsciiDocLine {
  index: number;
  /** Offsets of the line in the text, the line terminator excluded. */
  start: number;
  end: number;
  text: string;
  kind: LineKind;
  marker?: ListMarker;
  delimiter?: Delimiter;
  /** The block macro the line starts with. */
  macro?: BlockMacro;
  segments?: CellSegment[];
}

const BLOCK_MACRO_NAMES = "image|video|audio|toc|include|link";
const MACRO_AT_START = new RegExp(`^(${BLOCK_MACRO_NAMES})::([^\\[\\n]*)\\[([^\\]]*)\\]`);
const MACRO_ANYWHERE = new RegExp(`(?<![\\w:/.-])(${BLOCK_MACRO_NAMES})::([^\\[\\s]*)\\[([^\\]]*)\\]`, "g");

/** Every block macro written in a line, except inside a backtick span. */
export function findBlockMacros(text: string): BlockMacro[] {
  const found: BlockMacro[] = [];
  for (const m of text.matchAll(MACRO_ANYWHERE)) {
    const ticks = (text.slice(0, m.index).match(/`/g) ?? []).length;
    if (ticks % 2 === 1) continue;
    found.push({ name: m[1], start: m.index, end: m.index + m[0].length });
  }
  return found;
}

const BULLET_RE = /^\s*(\*{1,5})\s+(\[[ xX*]\]\s+)?\S/;
const DASH_RE = /^\s*(-)\s+\S/;
const ORDERED_RE = /^\s*(\.{1,5})\s+\S/;
const NUMBER_RE = /^\s*(\d+[.)])\s+\S/;
const ALPHA_RE = /^\s*([a-zA-Z]\.)\s+\S/;
const ROMAN_RE = /^\s*([ivxlcdm]+\)|[IVXLCDM]+\))\s+\S/;
const DESCRIPTION_RE = /^\s*\S.*?(:{2,4}|;;)(?:\s|$)/;

export function listMarkerOf(text: string): ListMarker | undefined {
  let m = BULLET_RE.exec(text);
  if (m) return { kind: m[2] ? "checklist" : "bullet", marker: m[1], depth: m[1].length };
  m = DASH_RE.exec(text);
  if (m) return { kind: "dash", marker: m[1], depth: 1 };
  m = ORDERED_RE.exec(text);
  if (m) return { kind: "ordered", marker: m[1], depth: m[1].length };
  m = NUMBER_RE.exec(text);
  if (m) return { kind: "number", marker: m[1], depth: 1 };
  m = ALPHA_RE.exec(text);
  if (m) return { kind: "alpha", marker: m[1], depth: 1 };
  m = ROMAN_RE.exec(text);
  if (m) return { kind: "roman", marker: m[1], depth: 1 };
  if (!MACRO_AT_START.test(text)) {
    m = DESCRIPTION_RE.exec(text);
    if (m) return { kind: "description", marker: m[1], depth: m[1] === ";;" ? 1 : m[1].length - 1 };
  }
  return undefined;
}

const DELIMITER_KINDS: [RegExp, DelimiterKind][] = [
  [/^-{4,}$/, "listing"],
  [/^\.{4,}$/, "literal"],
  [/^={4,}$/, "example"],
  [/^\*{4,}$/, "sidebar"],
  [/^_{4,}$/, "quote"],
  [/^--$/, "open"],
  [/^\+{4,}$/, "passthrough"],
  [/^\/{4,}$/, "comment"],
  [/^\|={3,}$/, "table"],
];

function delimiterKind(text: string): DelimiterKind | undefined {
  for (const [re, kind] of DELIMITER_KINDS) if (re.test(text)) return kind;
  return undefined;
}

const VERBATIM: DelimiterKind[] = ["listing", "literal", "passthrough", "comment"];

/** `[cols=...]` of a table: the style (or none) of each column, in order. */
function columnStyles(attributeLine: string | undefined): (string | undefined)[] {
  if (!attributeLine) return [];
  const m = /\bcols\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\]\s]+))/.exec(attributeLine);
  if (!m) return [];
  const value = m[1] ?? m[2] ?? m[3];
  if (/^\d+$/.test(value)) return Array.from({ length: Number(value) }, () => undefined);
  const styles: (string | undefined)[] = [];
  for (const token of value.split(/[,;]/)) {
    const t = /^\s*(?:(\d+)\*)?[<^>]?(?:\.[<^>])?(?:\d+%?|~)?([adehlmsv])?\s*$/.exec(token);
    if (!t) return [];
    for (let i = 0; i < Number(t[1] ?? 1); i++) styles.push(t[2]);
  }
  return styles;
}

const CELL_START_RE = /(^|(?<=\s))(?:(\d+)?(?:\.(\d+))?([+*]))?[<^>]?(?:\.[<^>])?([adehlmsv])?\|/g;

interface TableState {
  columns: (string | undefined)[];
  column: number;
  /** Whether the cell the last line ended in holds AsciiDoc, and its written style. */
  asciidoc: boolean;
  style?: string;
}

function tableSegments(text: string, lineStart: number, table: TableState): CellSegment[] {
  const segments: CellSegment[] = [];
  const starts = [...text.matchAll(CELL_START_RE)];
  let pos = 0;
  const push = (end: number, startsCell: boolean): void => {
    segments.push({ start: lineStart + pos, end: lineStart + end, style: table.style, asciidoc: table.asciidoc, startsCell });
  };
  if (starts.length === 0 || starts[0].index > 0) push(starts.length ? starts[0].index : text.length, false);
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i];
    const count = m[4] === "*" ? Number(m[2] ?? 1) : 1;
    const span = m[4] === "+" ? Number(m[2] ?? 1) : 1;
    const columnStyle = table.columns.length ? table.columns[table.column % table.columns.length] : undefined;
    table.style = m[5];
    table.asciidoc = (m[5] ?? columnStyle) === "a";
    table.column += span * count;
    pos = m.index;
    push(i + 1 < starts.length ? starts[i + 1].index : text.length, true);
  }
  return segments;
}

export function classifyLines(text: string): AsciiDocLine[] {
  const lines: AsciiDocLine[] = [];
  const open: { index: number; kind: DelimiterKind; text: string }[] = [];
  let table: TableState | undefined;
  let offset = 0;
  const rows = text.split("\n");
  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index];
    const lineText = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const line: AsciiDocLine = { index, start: offset, end: offset + lineText.length, text: lineText, kind: "text" };
    offset += raw.length + 1;
    lines.push(line);

    const top = open[open.length - 1];
    const closes = top && lineText === top.text ? top : undefined;
    if (top && VERBATIM.includes(top.kind) && !closes) {
      line.kind = "verbatim";
      continue;
    }
    const kind = delimiterKind(lineText);
    if (kind && (closes || !(top && VERBATIM.includes(top.kind)))) {
      // A delimiter closes the innermost open block of the same text; any other one opens a block.
      const target = closes ?? [...open].reverse().find((o) => o.text === lineText);
      line.kind = "delimiter";
      if (target) {
        while (open.length && open[open.length - 1] !== target) open.pop();
        open.pop();
        lines[target.index].delimiter!.match = index;
        line.delimiter = { kind, text: lineText, role: "close", match: target.index };
        if (kind === "table") table = undefined;
      } else {
        open.push({ index, kind, text: lineText });
        line.delimiter = { kind, text: lineText, role: "open", match: -1 };
        if (kind === "table") {
          let attributes = index - 1;
          while (attributes >= 0 && lines[attributes].kind === "block-title") attributes--;
          const attributeLine = attributes >= 0 && lines[attributes].kind === "block-attribute" ? lines[attributes].text : undefined;
          table = { columns: columnStyles(attributeLine), column: 0, asciidoc: false };
        }
      }
      continue;
    }
    if (table) {
      line.kind = "table-line";
      line.segments = tableSegments(lineText, line.start, table);
      const macro = MACRO_AT_START.exec(lineText);
      if (macro && line.segments[0]?.startsCell === false) line.macro = { name: macro[1], start: 0, end: macro[0].length };
      continue;
    }
    if (lineText.trim() === "") line.kind = "blank";
    else if (/^\/\/(?!\/)/.test(lineText)) line.kind = "comment";
    else if (/^\+\s*$/.test(lineText)) line.kind = "continuation";
    else if (/^\[.*\]\s*$/.test(lineText)) line.kind = "block-attribute";
    else if (/^\.[^\s.]/.test(lineText)) line.kind = "block-title";
    else {
      const macro = MACRO_AT_START.exec(lineText);
      if (macro) {
        line.kind = "block-macro";
        line.macro = { name: macro[1], start: 0, end: macro[0].length };
      } else {
        const marker = listMarkerOf(lineText);
        if (marker) {
          line.kind = "list-item";
          line.marker = marker;
        }
      }
    }
  }
  return lines;
}
