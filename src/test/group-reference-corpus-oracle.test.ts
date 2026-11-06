import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { URI } from "langium";
import { describe, expect, test } from "vitest";
import { isAllowedFile } from "../utils/file-filter.js";
import { baselineRoot, corpusRoot, defaultSettings } from "./smrlv8-corpus-support.js";

/**
 * An oracle for `unqualified-group-reference` that does not use the parser:
 * a lexer that skips remarks and string literals, then, for every `\e` that
 * is not followed by `.`, accepts it only when `||` stands directly after it
 * or directly before its one-token operand head (`SELF\e`, `x\e`). Everything
 * else counts as a site. That is a heuristic, not the rule: it knows nothing
 * of `=`, parentheses or longer operands. On the pinned SMRL v8 corpus it
 * agrees with the language server's check site for site (default workspace,
 * by line) and count for count (each long form), which is what this test
 * asserts against the committed baselines. A change to the check that moves a
 * site moves the baseline, and this test then says whether the independent
 * oracle agrees. The oracle's own cases come first.
 */
type Token = { text: string; offset: number };

const TOKEN = /\|\||:=:|:<>:|<>|<=|>=|:=|<\*|\*\*|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\S/y;

/** Tokens of EXPRESS text with remarks (`--`, nested `(* *)`) and string literals left out. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "'") {
      let j = i + 1;
      while (j < n && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1;
      i = j + 1;
    } else if (c === '"') {
      const j = text.indexOf('"', i + 1);
      i = j < 0 ? n : j + 1;
    } else if (text.startsWith("--", i)) {
      const j = text.indexOf("\n", i);
      i = j < 0 ? n : j;
    } else if (text.startsWith("(*", i)) {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text.startsWith("(*", i)) {
          depth++;
          i += 2;
        } else if (text.startsWith("*)", i)) {
          depth--;
          i += 2;
        } else i++;
      }
    } else if (/\s/.test(c)) {
      i++;
    } else {
      TOKEN.lastIndex = i;
      const match = TOKEN.exec(text)!;
      tokens.push({ text: match[0], offset: i });
      i += match[0].length;
    }
  }
  return tokens;
}

/** 1-based lines of the group references the oracle counts as sites. */
function oracleSites(text: string): number[] {
  const tokens = tokenize(text);
  let lastEndSchema = -1;
  tokens.forEach((token, index) => {
    if (token.text.toUpperCase() === "END_SCHEMA") lastEndSchema = index;
  });
  const lineStarts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const sites: number[] = [];
  tokens.forEach((token, index) => {
    if (token.text !== "\\" || !/^[A-Za-z_]/.test(tokens[index + 1]?.text ?? "")) return;
    if (lastEndSchema >= 0 && index > lastEndSchema) return;
    const next = tokens[index + 2]?.text ?? "";
    if (next === ".") return;
    if (next === "||" || tokens[index - 2]?.text === "||") return;
    sites.push(lineOf(token.offset));
  });
  return sites;
}

type Baseline = { files: Record<string, Record<string, number[] | number>> };
const CODE = "unqualified-group-reference";
const readBaseline = (name: string): Baseline => JSON.parse(readFileSync(join(baselineRoot, name), "utf8"));

function corpusFiles(dir = corpusRoot): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...corpusFiles(path));
    else if (entry.endsWith(".exp")) files.push(path);
  }
  return files;
}

const corpusPath = (path: string) => relative(corpusRoot, path).split(sep).join("/");

describe("the oracle itself", () => {
  test("counts a final group reference, an actual parameter and a chained one, not || operands or attribute-qualified ones", () => {
    const text = [
      "SCHEMA s;",
      "-- the_datum : datum := x\\datum; in a remark is not counted",
      "(* nor (* nested *) x\\datum *)",
      "the_datum : datum := datum_basis_relationship[1]\\shape_aspect_relationship.related_shape_aspect\\datum;",
      "WR1: TYPEOF(SELF\\a) <> TYPEOF(SELF);",
      "WR2: SIZEOF(TYPEOF(SELF) - TYPEOF(SELF\\a || SELF\\b || SELF\\c)) = 0;",
      "WR3: 'x\\y' IN TYPEOF(SELF\\a.b);",
      "RETURN (coca\\circle\\conic.position);",
      "END_SCHEMA;",
      "x\\after_the_schema;",
    ].join("\n");
    expect(oracleSites(text)).toEqual([4, 5, 8]);
  });
});

describe("unqualified-group-reference agrees with the token oracle on the SMRL v8 corpus", () => {
  const files = corpusFiles();

  test("default workspace: the same sites, by line", () => {
    const baseline = readBaseline("default-diagnostics.json");
    const settings = defaultSettings();
    let total = 0;
    const disagreements: string[] = [];
    for (const file of files) {
      if (!isAllowedFile(URI.file(file), settings)) continue;
      const path = corpusPath(file);
      const oracle = oracleSites(readFileSync(file, "utf8")).sort((a, b) => a - b);
      const reported = [...((baseline.files[path]?.[CODE] as number[] | undefined) ?? [])].sort((a, b) => a - b);
      total += reported.length;
      if (JSON.stringify(oracle) !== JSON.stringify(reported)) disagreements.push(`${path}: oracle ${oracle} reported ${reported}`);
    }
    expect(disagreements).toEqual([]);
    expect(total).toBe(30);
  });

  test("long forms: the same number of sites in each", () => {
    const baseline = readBaseline("longform-diagnostics.json");
    const longForms = files.filter((file) => /^modules\/[^/]+\/(arm|mim)_lf\.exp$/.test(corpusPath(file)));
    expect(longForms).toHaveLength(103);
    let total = 0;
    const disagreements: string[] = [];
    for (const file of longForms) {
      const path = corpusPath(file);
      const oracle = oracleSites(readFileSync(file, "utf8")).length;
      const reported = (baseline.files[path]?.[CODE] as number | undefined) ?? 0;
      total += reported;
      if (oracle !== reported) disagreements.push(`${path}: oracle ${oracle} reported ${reported}`);
    }
    expect(disagreements).toEqual([]);
    expect(total).toBe(406);
  });
});
