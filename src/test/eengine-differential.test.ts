import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Differential test against eengine (p21eval), an independent ISO 10303-11
 * implementation.
 *
 * Diagnostic counts are a weak oracle: a count can fall because a reference now
 * resolves to the wrong target, or because text is silently mis-tokenised. This
 * test uses an external oracle instead — wherever eengine accepts a schema, that
 * schema is valid EXPRESS, so EXPRESSsuite must be able to parse it.
 *
 * Two fixtures, both regenerable:
 *
 *   test-fixtures/eengine-oracle.json          eengine's verdict per schema
 *     node scripts/build-eengine-oracle.mjs --corpus <stepmod>/schemas \
 *          --stepmod <stepmod>
 *
 *   test-fixtures/parse-failure-baseline.json  schemas eengine accepts that this
 *                                             extension still cannot parse
 *     EXPRESS_CORPUS=<stepmod>/schemas UPDATE_PARSE_BASELINE=1 \
 *          npx vitest run src/test/eengine-differential.test.ts
 *
 * Both hold file names and verdicts only. ISO schema text is not vendored here,
 * and no local paths are stored.
 *
 * Every entry in the baseline is an open EXPRESSsuite defect. Shrinking it is the
 * point; the assertion is an equality, so a new failure and a silently fixed
 * entry both break the test.
 */
const ORACLE = join(process.cwd(), "test-fixtures/eengine-oracle.json");
const BASELINE = join(process.cwd(), "test-fixtures/parse-failure-baseline.json");

type Verdict = { mode?: string; exit?: number; nil?: number | null; valid: boolean; skipped?: boolean; reason?: string };
type Provenance = { commit: string | null; dirty: boolean | null; describedAt?: string };
type Oracle = { tool: string; corpus?: Provenance; verdicts: Record<string, Verdict> };
type Baseline = { corpus?: Provenance; failures: string[] };

/**
 * The corpus is a live repository. Recording which commit a fixture was measured
 * against means a later mismatch can be explained — the tool changed, or the
 * schemas did — instead of being indistinguishable.
 */
const liveProvenance = (root: string): Provenance => {
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    return { commit: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain").length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
};

const oracle: Oracle | undefined = existsSync(ORACLE) ? JSON.parse(readFileSync(ORACLE, "utf8")) : undefined;
// The corpus is ISO schema text that cannot be vendored here, so its location is
// supplied by the environment. Without it this suite skips.
const corpus = process.env.EXPRESS_CORPUS ? resolve(process.env.EXPRESS_CORPUS) : undefined;
const runnable = Boolean(oracle && corpus && existsSync(corpus));
const updating = process.env.UPDATE_PARSE_BASELINE === "1";

describe.skipIf(!runnable)("differential: eengine-valid schemas must parse", () => {
  test("every schema eengine accepts parses, except the recorded baseline", async () => {
    const { shared } = createExpressP11Services(NodeFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(corpus!).toString(), name: "corpus" }]);
    await shared.workspace.WorkspaceManager.ready;

    const failures: string[] = [];
    let checked = 0;

    for (const doc of shared.workspace.LangiumDocuments.all.toArray()) {
      const path = doc.uri.path;
      if (!path.startsWith(corpus!)) continue;
      const rel = path.slice(corpus!.length + 1);
      // Schemas eengine rejects, or whose file kind has no documented -mode, are
      // not the oracle's business; the fixture records the reason for each.
      if (!oracle!.verdicts[rel]?.valid) continue;
      checked++;
      const parseErrors = doc.parseResult?.parserErrors?.length ?? 0;
      const lexerErrors = (doc.parseResult as unknown as { lexerErrors?: unknown[] })?.lexerErrors?.length ?? 0;
      if (parseErrors + lexerErrors > 0) failures.push(rel);
    }

    failures.sort();

    if (updating) {
      const written: Baseline = { corpus: liveProvenance(corpus!), failures };
      writeFileSync(BASELINE, `${JSON.stringify(written, null, 2)}\n`);
      console.log(`baseline updated: ${failures.length} known parse failures of ${checked} eengine-valid schemas at corpus ${written.corpus?.commit?.slice(0, 9)}`);
      return;
    }

    // Guards against silent narrowing: pointing EXPRESS_CORPUS at a subdirectory
    // would otherwise skip most schemas for want of a verdict and still pass.
    const expectedChecked = Object.values(oracle!.verdicts).filter((v) => v.valid).length;
    expect(checked).toBe(expectedChecked);

    const stored: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : { failures: [] };
    const live = liveProvenance(corpus!);
    // Reported rather than asserted: the corpus moving is normal, but if the
    // comparison below fails it is the first thing worth knowing.
    if (stored.corpus?.commit && stored.corpus.commit !== live.commit) {
      console.log(
        `note: corpus has moved since this baseline was measured ` +
          `(fixture ${stored.corpus.commit.slice(0, 9)}${stored.corpus.dirty ? "+dirty" : ""} -> ` +
          `live ${live.commit?.slice(0, 9)}${live.dirty ? "+dirty" : ""}). ` +
          `Regenerate with UPDATE_PARSE_BASELINE=1 if the change is expected.`
      );
    }
    expect(failures).toEqual(stored.failures);
  }, 1800000);
});
