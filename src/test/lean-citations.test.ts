import { describe, expect, test } from "vitest";
import { checkLeanCitations, leanCode, leanIndex, repository, typescriptNames, type Source } from "./lean-citations-support.js";

/**
 * Every Lean name cited in src/, docs/ and lean/README.md occurs in the Lean
 * proofs (issue #97). The rules are in lean-citations-support.ts; the cases
 * below pin each of them, and the last test runs them over the repository.
 */
const lean = leanIndex([
  {
    path: "lean/ExpressSuite/IndexOperand.lean",
    text: [
      "/-- `true` when no value of `t` can be indexed. -/",
      "def notIndexable : Ty → Bool",
      "  | _ => true",
      "where notIndexableAll : List Ty → Bool",
      "  | _ => true",
      "-- neverAgg_sound was the old name",
      "/- a block comment naming neverAggregateClosed -/",
      'def label : String := "Clashing"',
      "theorem notIndexable_sound (t : Ty) (v : Val) : True := trivial",
    ].join("\n"),
  },
  {
    path: "lean/ExpressSuite/Interfaces.lean",
    text: "def Clash (ws : Workspace) (acc : Bool) : Prop := True\ndef clashesIn : List String := []",
  },
]);
const typescript = typescriptNames([
  { path: "src/a.ts", text: 'export class ExpressP11Entity { getVisibleLevels() { return "neverAgg"; } }\nconst exportOf = 1; // notIndexableClosed' },
]);
const check = (path: string, text: string) => checkLeanCitations([{ path, text } as Source], lean, typescript);

describe("Lean source reading", () => {
  test("comments and string literals are not Lean code", () => {
    const code = leanCode("/-- doc -/ def a := 1 -- b\n/- x /- nested -/ y -/ def c := \"d\"");
    expect(code).not.toMatch(/doc|\bb\b|nested|\bd\b/);
    expect(code).toMatch(/def a := 1/);
    expect(code).toMatch(/def c :=/);
  });

  test("declarations, where-functions and bound variables are indexed; comment-only names are not", () => {
    expect(lean.declared.has("notIndexable")).toBe(true);
    expect(lean.declared.has("notIndexableAll")).toBe(true);
    expect(lean.declared.has("notIndexable_sound")).toBe(true);
    expect(lean.occurring.has("acc")).toBe(true);
    expect(lean.occurring.has("neverAgg_sound")).toBe(false);
    expect(lean.occurring.has("neverAggregateClosed")).toBe(false);
    expect(lean.occurring.has("Clashing")).toBe(false);
  });

  test("TypeScript names come from code, not from comments or strings", () => {
    expect(typescript.has("getVisibleLevels")).toBe(true);
    expect(typescript.has("exportOf")).toBe(true);
    expect(typescript.has("neverAgg")).toBe(false);
    expect(typescript.has("notIndexableClosed")).toBe(false);
  });
});

describe("citation rules", () => {
  test("the #97 case: a renamed theorem cited in a TypeScript comment", () => {
    const findings = check("src/m.ts", "/**\n * Mirror of lean/ExpressSuite/IndexOperand.lean (`neverAgg`, `neverAgg_sound`).\n */\nconst x = 1;");
    expect(findings.map((f) => [f.citation, f.line, f.problem])).toEqual([
      ["neverAgg", 2, "occurs in no Lean code under lean/ExpressSuite"],
      ["neverAgg_sound", 2, "occurs in no Lean code under lean/ExpressSuite"],
    ]);
  });

  test("a name that survives only in a Lean comment is still reported", () => {
    const findings = check("src/m.ts", "// IndexOperand.lean: see `neverAggregateClosed`.\nconst x = 1;");
    expect(findings.map((f) => f.citation)).toEqual(["neverAggregateClosed"]);
  });

  test("a name equal to a Lean declaration up to case is miscased, even when TypeScript uses it", () => {
    const findings = checkLeanCitations(
      [{ path: "src/m.ts", text: "/** As decided by `lean/ExpressSuite/Interfaces.lean`:\n * - `clashesIn` is `clash`.\n */" }],
      lean,
      typescriptNames([{ path: "src/b.ts", text: "for (const clash of clashes) {}" }])
    );
    expect(findings.map((f) => [f.citation, f.line, f.problem])).toEqual([["clash", 2, "miscased: Lean declares Clash"]]);
  });

  test("a cited Lean file must exist", () => {
    const findings = check("docs/a.md", "The proof is in `lean/ExpressSuite/IndexOperands.lean`.");
    expect(findings.map((f) => [f.citation, f.problem])).toEqual([["IndexOperands.lean", "no such file in lean/ExpressSuite"]]);
  });

  test("declarations, where-functions, bound variables, TypeScript names, EXPRESS keywords and axioms pass", () => {
    const text = [
      "/**",
      " * IndexOperand.lean `notIndexable`, `notIndexable.notIndexableAll`, `notIndexableAll`, `notIndexable_sound`;",
      " * `acc` of `Clash` in lean/ExpressSuite/Interfaces.lean; the TypeScript walk is",
      " * `ExpressP11Entity.getVisibleLevels` and `exportOf`; `ENTITY`, `REAL`; no `sorry`, only `propext`,",
      " * `Quot.sound` and `Classical.choice`; file names `Interfaces.lean`, `check.sh`; and code that is no name: `notIndexable t`, `x\\e.a`.",
      " */",
    ].join("\n");
    expect(check("src/m.ts", text)).toEqual([]);
  });

  test("only units that name a Lean file or lean/ are read, except in lean/README.md", () => {
    expect(check("src/m.ts", "/** `neverAgg` with no Lean file in sight */")).toEqual([]);
    expect(check("docs/a.md", "A paragraph with `neverAgg`.\n\nAnother naming `lean/` and `notIndexable`.")).toEqual([]);
    expect(check("lean/README.md", "Prose with `neverAgg`.").map((f) => f.citation)).toEqual(["neverAgg"]);
  });

  test("Markdown table rows and list items are units of their own", () => {
    const text = ["| `ExpressSuite/IndexOperand.lean` | `notIndexable` |", "| other | `neverAgg` |", "", "- `neverAgg` alone", "- `notIndexable_sound` in IndexOperand.lean"].join("\n");
    expect(check("docs/a.md", text)).toEqual([]);
  });

  test("LaTeX \\code{} spans with escaped underscores", () => {
    const text = "proved & \\code{notIndexable\\_sound} in \\code{lean/} \\\\\nstale & \\code{neverAgg\\_sound} in \\code{lean/} \\\\";
    expect(check("docs/deck.tex", text).map((f) => [f.citation, f.line])).toEqual([["neverAgg_sound", 2]]);
  });
});

describe("the repository", () => {
  test("every Lean citation in src/, docs/ and lean/README.md resolves", () => {
    const repo = repository(process.cwd());
    expect(repo.lean.declared.size).toBeGreaterThan(100);
    const findings = checkLeanCitations(repo.sources, repo.lean, repo.typescript);
    expect(findings.map((f) => `${f.path}:${f.line}: \`${f.citation}\` ${f.problem}`)).toEqual([]);
  });
});
