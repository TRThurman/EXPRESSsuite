import { classifyLines, findBlockMacros } from "./asciidoc-lines.js";
import type { AsciiDocLine } from "./asciidoc-lines.js";

/**
 * Checks of the AsciiDoc of one description block for constructs the ISO 10303 publication pipeline mishandles.
 * Class A (warning): wrong AsciiDoc whatever the pipeline does. Class B (information, behind a setting):
 * valid AsciiDoc that the current toolchain mishandles; each message names the upstream issue and versions.
 * The rules read the lines through `asciidoc-lines.ts`; none decides from one line alone where the context decides.
 */

export type PublicationCode =
  | "annotation-continuation-without-list"
  | "annotation-glued-continuation"
  | "annotation-block-macro-inline"
  | "annotation-open-block-delimiter"
  | "annotation-list-chain-macro";

export interface PublicationFinding {
  code: PublicationCode;
  /** Offsets in the body. */
  start: number;
  end: number;
  message: string;
  severity: "warning" | "information";
  /** An unambiguous correction: replace `start`..`end` (offsets in the body) with `newText`. */
  fix?: { title: string; start: number; end: number; newText: string };
}

export interface PublicationOptions {
  /** Class B rules (the setting `expresssuite.annotations.publicationHazards`). */
  hazards: boolean;
  /** The 1-based line of the file on which the body starts; messages that name lines count from it (from 1 when absent). */
  firstLine?: number;
}

/**
 * `LIST_ITEM_REGEXP` of metanorma-plugin-lutaml 0.7.68 and later (`express_remarks_decorator.rb`), as reported in
 * metanorma/iso-10303 issue 862. The plugin applies it to a line without its terminator, so the `\s` needs a character.
 */
const PLUGIN_LIST_ITEM = /^(?:[-*]|\d+[.)]|[A-Za-z][.)])\s|\w[\p{L}\p{N} _-]*::\s/u;
/** The next line the plugin treats as a macro. */
const PLUGIN_MACRO = /^(?:link|image|video|audio|include)::/;
const BLOCK_MACRO_RULE_NAMES = new Set(["image", "video", "audio", "toc"]);

interface ChainOwner {
  /** Index of the line the chain starts at. */
  start: number;
  listItem: boolean;
}

const TRANSPARENT = new Set(["block-attribute", "block-title"]);

/** The line that starts the continuation chain the `+` line `plus` belongs to, followed back through the blocks the `+` lines attach. */
function chainOwner(lines: AsciiDocLine[], plus: number, memo: Map<number, ChainOwner>): ChainOwner {
  const known = memo.get(plus);
  if (known) return known;
  const result = ((): ChainOwner => {
    let j = plus - 1;
    while (j >= 0 && lines[j].kind === "blank") j--;
    if (j < 0) return { start: plus, listItem: false };
    const prev = lines[j];
    if (prev.kind === "delimiter" && prev.delimiter?.role === "close") {
      // The block the + attaches runs from its opening delimiter, with the attribute and title lines above it.
      let top = prev.delimiter.match;
      while (top - 1 >= 0 && TRANSPARENT.has(lines[top - 1].kind)) top--;
      if (top - 1 >= 0 && lines[top - 1].kind === "continuation") return chainOwner(lines, top - 1, memo);
      // A delimited block written directly under a list item's text, with no blank line, is part of the item.
      for (let i = top - 1; i >= 0; i--) {
        if (lines[i].kind === "list-item") return { start: i, listItem: true };
        if (lines[i].kind === "blank" || lines[i].kind === "delimiter" || lines[i].kind === "verbatim" || lines[i].kind === "continuation") break;
      }
      return { start: top, listItem: false };
    }
    for (let i = j; i >= 0; i--) {
      const line = lines[i];
      if (line.kind === "list-item") return { start: i, listItem: true };
      if (line.kind === "continuation") return chainOwner(lines, i, memo);
      if (line.kind === "blank" || line.kind === "delimiter" || line.kind === "verbatim") return { start: i + 1, listItem: false };
    }
    return { start: 0, listItem: false };
  })();
  memo.set(plus, result);
  return result;
}

function lineNumbers(indexes: number[], firstLine: number): string {
  const numbers = indexes.map((i) => String(firstLine + i));
  return `${numbers.length === 1 ? "line" : "lines"} ${numbers.join(", ")}`;
}

export function publicationFindings(body: string, options: PublicationOptions): PublicationFinding[] {
  const lines = classifyLines(body);
  const findings: PublicationFinding[] = [];
  const firstLine = options.firstLine ?? 1;
  const memo = new Map<number, ChainOwner>();
  const chains = new Map<number, number[]>();

  for (const line of lines) {
    if (line.kind === "continuation") {
      const owner = chainOwner(lines, line.index, memo);
      if (!owner.listItem) {
        findings.push({
          code: "annotation-continuation-without-list",
          start: line.start,
          end: line.start + 1,
          message: 'A "+" line attaches a block to a list item only; the lines before this one do not start at a list item, so Asciidoctor prints the "+" as text.',
          severity: "warning",
          fix: { title: 'Replace the "+" with a blank line', start: line.start, end: line.start + 1, newText: "" },
        });
      } else {
        const list = chains.get(owner.start) ?? [];
        list.push(line.index);
        chains.set(owner.start, list);
      }
    }

    if (line.kind === "block-macro" && line.macro) {
      const after = line.text.slice(line.macro.end);
      const glued = /^\+\s*$/.exec(after);
      if (glued) {
        const at = line.start + line.macro.end;
        let before = line.index - 1;
        while (before >= 0 && lines[before].kind === "blank") before--;
        const inChain = before >= 0 && lines[before].kind === "continuation" && chainOwner(lines, before, memo).listItem;
        findings.push({
          code: "annotation-glued-continuation",
          start: at,
          end: at + 1,
          message: `The "+" glued to the closing "]" of the ${line.macro.name}:: macro is printed as text; a continuation is a line of its own.`,
          severity: "warning",
          fix: inChain
            ? { title: 'Put the "+" on a line of its own', start: at, end: at + 1, newText: "\n+" }
            : { title: 'Remove the "+"', start: at, end: at + 1, newText: "" },
        });
      }
    }

    // Block macros that Asciidoctor prints as text: not at the start of a line, or in a cell that is not AsciiDoc.
    if (line.kind === "table-line") {
      for (const segment of line.segments ?? []) {
        const text = body.slice(segment.start, segment.end);
        const content = segment.startsCell ? text.indexOf("|") + 1 : 0;
        const first = content + (/^\s*/.exec(text.slice(content))?.[0].length ?? 0);
        for (const macro of findBlockMacros(text)) {
          if (!BLOCK_MACRO_RULE_NAMES.has(macro.name)) continue;
          if (segment.asciidoc && macro.start === first) continue;
          const why = segment.asciidoc ? "does not start its line or cell content" : 'is in a table cell without the AsciiDoc style ("a|")';
          findings.push(inlineMacro(segment.start + macro.start, segment.start + macro.end, macro.name, why));
        }
      }
    } else if (line.kind !== "verbatim" && line.kind !== "delimiter" && line.kind !== "comment" && line.kind !== "block-attribute" && line.kind !== "block-title") {
      for (const macro of findBlockMacros(line.text)) {
        if (!BLOCK_MACRO_RULE_NAMES.has(macro.name)) continue;
        if (macro.start === 0 && line.kind === "block-macro") continue;
        findings.push(inlineMacro(line.start + macro.start, line.start + macro.end, macro.name, "does not start its line"));
      }
    }

    if (options.hazards && line.text === "--") {
      findings.push({
        code: "annotation-open-block-delimiter",
        start: line.start,
        end: line.end,
        message:
          'A line "--" closes the "[source]" block that the schema page wraps around the schema listing (suma 0.5.42 schema template, metanorma/iso-10303 issue 857); the rest of the page is then rendered as AsciiDoc.',
        severity: "information",
      });
    }
  }

  if (options.hazards) {
    for (const [itemIndex, pluses] of chains) {
      const blanked = pluses.filter((i) => {
        const next = lines[i + 1];
        const prev = lines[i - 1];
        return next !== undefined && PLUGIN_MACRO.test(next.text) && !(prev !== undefined && PLUGIN_LIST_ITEM.test(prev.text));
      });
      if (blanked.length === 0) continue;
      const item = lines[itemIndex];
      findings.push({
        code: "annotation-list-chain-macro",
        start: item.start,
        end: item.end,
        message: `This list item's continuation chain attaches a macro; metanorma-plugin-lutaml 0.7.68 and later blanks the "+" at ${lineNumbers(blanked, firstLine)} (metanorma/iso-10303 issue 862), because the line before it is not a "*", "-", numbered, lettered or "term::" item, and the macro is then detached from the item.`,
        severity: "information",
      });
    }
  }
  return findings.sort((a, b) => a.start - b.start);
}

function inlineMacro(start: number, end: number, name: string, why: string): PublicationFinding {
  return {
    code: "annotation-block-macro-inline",
    start,
    end,
    message: `The block macro "${name}::" ${why}; Asciidoctor prints it as text.`,
    severity: "warning",
  };
}
