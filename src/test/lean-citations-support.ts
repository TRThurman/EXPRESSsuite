import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import ts from "typescript";

/**
 * Citations of the Lean proofs (lean/ExpressSuite/*.lean) in comments and
 * documents, checked against the Lean source (issue #97: a theorem named
 * notIndexable_sound was cited in four places as "neverAgg_sound", and
 * nothing noticed).
 *
 * A citation context is a TypeScript comment (a block comment, or a run of
 * line comments), a Markdown paragraph, list item or table row, or a LaTeX
 * paragraph or table row, that names a `.lean` file or `lean/`; every unit of
 * lean/README.md is one. In a context, every code span (`name` in Markdown and
 * TypeScript, \code{name} in LaTeX) that is a single identifier, possibly
 * dotted, is checked:
 *
 * - a `.lean` file it names must exist in lean/ExpressSuite/ (or be the
 *   library root lean/ExpressSuite.lean);
 * - a name that occurs in Lean code (comments and strings left out) passes:
 *   declarations, constructors and bound variables (`acc`, `orig`) alike,
 *   and so does a dotted name each of whose parts does
 *   (`notIndexable.notIndexableAll`, a `where` function);
 * - a name equal to a Lean declaration up to letter case is reported as
 *   miscased, since Lean names are case-sensitive;
 * - a name that occurs in the TypeScript code under src/ passes, as a
 *   TypeScript name (`ExpressP11Entity.getVisibleLevels`);
 * - every other name is reported.
 *
 * All-uppercase spans (EXPRESS keywords such as `ENTITY` or `REAL`), file
 * names (`Meta.lean`, checked as files above, `check.sh`), affixes beginning with an underscore
 * (`_lf`), and the axiom and keyword names `sorry`, `propext`, `Quot.sound`
 * and `Classical.choice` are not names to check.
 */

export type Source = { path: string; text: string };
export type Finding = { path: string; line: number; citation: string; problem: string };

const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*`;
const IDENT_RE = new RegExp(`^${IDENT}$`);
const DECLARATION = new RegExp(
  String.raw`^\s*(?:@\[[^\]]*\]\s*)?(?:(?:private|protected|noncomputable|partial|unsafe)\s+)*(?:theorem|lemma|def|abbrev|inductive|structure|instance|opaque|axiom|class)\s+(${IDENT})`,
  "gm"
);
const LEAN_FILE = /(?<![\w/])(?:lean\/)?(?:ExpressSuite\/)?([A-Z][A-Za-z0-9]*)\.lean\b/g;
const SPAN = /`([^`\n]+)`|\\code\{((?:[^{}]|\{[^{}]*\})*)\}/g;
const NOT_NAMES = new Set(["sorry", "propext", "Quot.sound", "Classical.choice"]);
const FILE_NAME = /\.(?:lean|sh|ts|js|mjs|json|md|exp|ya?ml|py|tex|toml)$/;

/** Lean source with comments (`--`, nested `/- -/`, `/-- -/`) and string literals blanked. */
export function leanCode(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith("/-", i)) {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text.startsWith("/-", i)) {
          depth++;
          i += 2;
        } else if (text.startsWith("-/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      out += " ";
    } else if (text.startsWith("--", i)) {
      const j = text.indexOf("\n", i);
      i = j < 0 ? n : j;
    } else if (text[i] === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += " ";
      i = j + 1;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

/** What the Lean files provide: every identifier in their code, and their declarations. */
export type LeanIndex = { files: Set<string>; occurring: Set<string>; declared: Set<string> };

export function leanIndex(files: Source[]): LeanIndex {
  const index: LeanIndex = { files: new Set(["ExpressSuite"]), occurring: new Set(), declared: new Set() };
  for (const file of files) {
    index.files.add(basename(file.path, ".lean"));
    const code = leanCode(file.text);
    for (const [name] of code.matchAll(new RegExp(IDENT, "g"))) {
      index.occurring.add(name);
      for (const segment of name.split(".")) index.occurring.add(segment);
    }
    for (const match of code.matchAll(DECLARATION)) {
      index.declared.add(match[1]);
      index.declared.add(match[1].split(".").pop()!);
    }
    for (const match of code.matchAll(/^\s*where\s+([A-Za-z_][A-Za-z0-9_']*)/gm)) index.declared.add(match[1]);
  }
  return index;
}

/** Identifiers in TypeScript code (from the TypeScript parser: comments and string literals are not code). */
export function typescriptNames(sources: Source[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) names.add(node.text.replace(/^#/, ""));
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, false));
  }
  return names;
}

type Unit = { text: string; offset: number };

/**
 * The comments of a TypeScript source, from the TypeScript parser; a run of
 * line comments separated by nothing but white space is one unit.
 */
function typescriptComments(source: Source): Unit[] {
  const { text } = source;
  const ranges = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node) => {
    for (const range of [...(ts.getLeadingCommentRanges(text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(text, node.end) ?? [])]) ranges.set(range.pos, range);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(source.path, text, ts.ScriptTarget.Latest, false));
  const result: Unit[] = [];
  let previous: ts.CommentRange | undefined;
  for (const range of [...ranges.values()].sort((a, b) => a.pos - b.pos)) {
    const line = range.kind === ts.SyntaxKind.SingleLineCommentTrivia;
    const last = result[result.length - 1];
    if (line && previous?.kind === ts.SyntaxKind.SingleLineCommentTrivia && /^\s*$/.test(text.slice(previous.end, range.pos)) && last) {
      last.text = text.slice(last.offset, range.end);
    } else result.push({ text: text.slice(range.pos, range.end), offset: range.pos });
    previous = range;
  }
  return result;
}

/** The citation units of a source, with their offsets. */
function units(source: Source): Unit[] {
  const { path, text } = source;
  const result: Unit[] = [];
  if (path.endsWith(".ts")) return typescriptComments(source);
  // Markdown and LaTeX: paragraphs, then table rows (Markdown `|` rows, LaTeX `\\` rows) and list items.
  const blocks = /(?:[^\n]|\n(?![ \t]*\n))+/g;
  for (const block of text.matchAll(blocks)) {
    const pieces = block[0].trimStart().startsWith("|")
      ? /[^\n]+/g
      : path.endsWith(".tex")
        ? /(?:(?!\\\\)[\s\S])+/g
        : /(?:^|\n)(?:(?!\n[ \t]*(?:[-*]|\d+\.)[ \t])[\s\S])+/g;
    for (const piece of block[0].matchAll(pieces)) result.push({ text: piece[0], offset: block.index! + piece.index! });
  }
  return result;
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

export function checkLeanCitations(sources: Source[], lean: LeanIndex, typescript: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const declaredFolded = new Map<string, string>();
  for (const name of lean.declared) declaredFolded.set(name.toLowerCase(), name);
  for (const source of sources) {
    const everyUnit = source.path === "lean/README.md";
    for (const unit of units(source)) {
      const files = [...unit.text.matchAll(LEAN_FILE)];
      if (!everyUnit && files.length === 0 && !unit.text.includes("lean/")) continue;
      const report = (at: number, citation: string, problem: string) =>
        findings.push({ path: source.path, line: lineAt(source.text, unit.offset + at), citation, problem });
      for (const file of files) {
        if (!lean.files.has(file[1])) report(file.index!, `${file[1]}.lean`, "no such file in lean/ExpressSuite");
      }
      for (const span of unit.text.matchAll(SPAN)) {
        const name = (span[1] ?? span[2]).replace(/\\_/g, "_").trim();
        if (!IDENT_RE.test(name) || /^[A-Z0-9_]+$/.test(name) || FILE_NAME.test(name) || name.startsWith("_") || NOT_NAMES.has(name)) continue;
        if (lean.occurring.has(name)) continue;
        const folded = declaredFolded.get(name.toLowerCase());
        if (folded) {
          report(span.index!, name, `miscased: Lean declares ${folded}`);
          continue;
        }
        if (name.split(".").every((segment) => lean.occurring.has(segment) || typescript.has(segment))) continue;
        report(span.index!, name, "occurs in no Lean code under lean/ExpressSuite");
      }
    }
  }
  return findings;
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "node_modules" && entry !== "generated" && entry !== ".lake") paths.push(...walk(path, keep));
    } else if (keep(path)) paths.push(path);
  }
  return paths;
}

/** The repository's citing sources (src/, docs/, lean/README.md), Lean files and TypeScript code. */
export function repository(root: string): { sources: Source[]; lean: LeanIndex; typescript: Set<string> } {
  // CRLF (a Windows checkout) is read as LF: paragraphs are split at blank lines.
  const read = (path: string): Source => ({ path: relative(root, path).split(sep).join("/"), text: readFileSync(path, "utf8").replace(/\r\n/g, "\n") });
  const ts = walk(join(root, "src"), (path) => path.endsWith(".ts")).map(read);
  const docs = walk(join(root, "docs"), (path) => path.endsWith(".md") || path.endsWith(".tex")).map(read);
  const leanFiles = walk(join(root, "lean", "ExpressSuite"), (path) => path.endsWith(".lean")).map(read);
  return {
    sources: [...ts, ...docs, read(join(root, "lean", "README.md"))],
    lean: leanIndex(leanFiles),
    typescript: typescriptNames(ts),
  };
}
