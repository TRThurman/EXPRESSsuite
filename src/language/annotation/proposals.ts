import type { SchemaDefinition } from "../generated/ast.js";
import type { LinkResolver } from "./link-resolver.js";
import type { DescribeTarget } from "./keys.js";

export interface LinkProposal {
  /** Span in the author's text. */
  start: number;
  end: number;
  text: string;
  /** Identifier the link names; for a reachable declaration, its declared name, also when imported under another (R15). */
  name: string;
  status: "auto" | "proposed" | "ambiguous" | "subject";
  schema?: string;
  schemas?: string[];
}

const MAX_WORDS = 6;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;
const PROTECTED = /<<express:[^>]*>>|\*\*[^*]+\*\*/g;

interface Word {
  start: number;
  end: number;
  text: string;
}

function wordsOutsideProtected(text: string): Word[] {
  const blocked: Array<[number, number]> = [];
  for (const match of text.matchAll(PROTECTED)) blocked.push([match.index, match.index + match[0].length]);
  const words: Word[] = [];
  for (const match of text.matchAll(WORD)) {
    const start = match.index;
    const end = start + match[0].length;
    if (blocked.some(([from, to]) => start < to && end > from)) continue;
    words.push({ start, end, text: match[0] });
  }
  return words;
}

/** Candidate declared-name forms of a run: as joined, then with a plural `ies`/`s` reduced. */
function forms(joined: string, singleExact: boolean): string[] {
  const result = [joined];
  if (singleExact) return result;
  if (joined.endsWith("ies") && joined.length > 3) result.push(`${joined.slice(0, -3)}y`);
  if (joined.endsWith("s") && joined.length > 1) result.push(joined.slice(0, -1));
  return result;
}

/**
 * Where `text` names a declaration of the schema: the subject (marked), underscore identifiers
 * (automatic when reachable), other words and phrases (proposed). Longest run first, no overlaps.
 */
export function linkProposals(
  text: string,
  target: DescribeTarget,
  from: SchemaDefinition,
  resolver: LinkResolver,
  visibleNames: ReadonlyArray<string>
): LinkProposal[] {
  const subject = (target.owner ?? target.name).toLowerCase();
  const declared = new Map<string, string>();
  for (const name of visibleNames) declared.set(name.toLowerCase(), name);
  const words = wordsOutsideProtected(text);
  const proposals: LinkProposal[] = [];

  let i = 0;
  while (i < words.length) {
    let matched = false;
    for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1 && !matched; n--) {
      const run = words.slice(i, i + n);
      let contiguous = true;
      for (let k = 1; k < n; k++) {
        if (!/^\s+$/.test(text.slice(run[k - 1].end, run[k].start))) contiguous = false;
      }
      if (!contiguous) continue;
      const start = run[0].start;
      const end = run[n - 1].end;
      const span = text.slice(start, end);
      const joined = run.map((word) => word.text.toLowerCase()).join("_");

      let proposal: LinkProposal | undefined;
      if (joined === subject) {
        proposal = { start, end, text: span, name: target.owner ?? target.name, status: "subject", schema: target.schema };
      } else {
        const hasUnderscore = n === 1 && joined.includes("_");
        for (const form of forms(joined, hasUnderscore)) {
          if (n > 1 && !declared.has(form)) continue;
          const name = declared.get(form) ?? form;
          const resolution = resolver.resolve(from, form);
          if (resolution.kind === "none") continue;
          if (resolution.kind === "ambiguous") {
            proposal = { start, end, text: span, name, status: "ambiguous", schemas: resolution.schemas };
          } else {
            const status = hasUnderscore && resolution.kind === "reachable" ? "auto" : "proposed";
            // A renamed import links under its declared name (ruling R15).
            const linked = resolution.kind === "reachable" ? resolution.name : name;
            proposal = { start, end, text: span, name: linked, status, schema: resolution.schema };
          }
          break;
        }
      }
      if (proposal) {
        proposals.push(proposal);
        i += n;
        matched = true;
      }
    }
    if (!matched) i++;
  }
  return proposals;
}

/** Writes `<<express:schema.name,text>>` for each linkable span and `**text**` for the subject; ambiguous spans stay as written. */
export function applyLinks(text: string, accepted: ReadonlyArray<LinkProposal>): string {
  let result = text;
  const spans = [...accepted].filter((span) => span.status !== "ambiguous").sort((a, b) => b.start - a.start);
  for (const span of spans) {
    const replacement = span.status === "subject" ? `**${span.text}**` : `<<express:${span.schema}.${span.name},${span.text}>>`;
    result = result.slice(0, span.start) + replacement + result.slice(span.end);
  }
  return result;
}
