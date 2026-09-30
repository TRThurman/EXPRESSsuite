import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Differential test against eengine (p21eval), an independent ISO 10303-11
 * implementation.
 *
 * Diagnostic counts are a weak oracle: a count can fall because a reference now
 * resolves to the wrong target, or because text is silently mis-tokenised. This
 * test uses an external oracle instead — if eengine accepts a schema, then that
 * schema is valid EXPRESS, so EXPRESSsuite must be able to parse it.
 *
 * Regenerate the fixture with:
 *   node scripts/build-eengine-oracle.mjs --corpus <stepmod>/schemas/resources \
 *        --stepmod <stepmod>
 *
 * The fixture holds only file names and verdicts — never schema text, which is
 * ISO copyright and must not be vendored into this repository.
 */
const ORACLE = join(process.cwd(), "test-fixtures/eengine-oracle.json");

type Oracle = {
  tool: string;
  verdicts: Record<string, { exit: number; nil: number | null; valid: boolean }>;
};

const oracle: Oracle | undefined = existsSync(ORACLE) ? JSON.parse(readFileSync(ORACLE, "utf8")) : undefined;
// The corpus is ISO schema text that cannot be vendored here, so its location is
// supplied by the environment. Without it this suite skips.
const corpus = process.env.EXPRESS_CORPUS;
const runnable = Boolean(oracle && corpus && existsSync(corpus));

/**
 * Schemas eengine accepts but EXPRESSsuite cannot yet parse. Every entry is an
 * open EXPRESSsuite defect; delete an entry when it is fixed. The assertion is
 * an equality, so a new failure and a silently-fixed entry both break the test.
 */
const KNOWN_PARSE_FAILURES = new Set<string>([
  // A string literal holding a backslash (`'\'`) is mis-lexed, so the rest of the
  // file is tokenised as code. 23 parse errors.
  "parameterization_schema/parameterization_schema.exp",
  // The NUM terminal rejects the real literal `0.` at line 673. 2 parse errors.
  "presentation_organization_schema/presentation_organization_schema.exp",
]);

/**
 * Schemas the oracle does not judge, and why. Recorded so that a later change in
 * eengine's verdict is a visible decision rather than a silent shift in scope:
 *
 *   quantities_and_units_schema  eengine exits 255 (it cannot process the file);
 *                                deliberately ignored, not a schema verdict.
 *   screw_thread_schema          eengine exits 0 but the .flat carries 3 `nil`
 *                                markers, i.e. unresolved references, so it does
 *                                not meet the documented pass signal.
 */

describe.skipIf(!runnable)("differential: eengine-valid schemas must parse", () => {
  test("no eengine-valid schema fails to parse, beyond the known list", async () => {
    const { shared } = createExpressP11Services(NodeFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(corpus!).toString(), name: "corpus" }]);
    await shared.workspace.WorkspaceManager.ready;

    const docs = shared.workspace.LangiumDocuments.all.toArray();
    const failures: string[] = [];
    let checked = 0;

    for (const doc of docs) {
      const rel = doc.uri.path.startsWith(corpus!) ? doc.uri.path.slice(corpus!.length + 1) : doc.uri.path;
      const verdict = oracle!.verdicts[rel];
      if (!verdict?.valid) continue; // eengine rejects it too; not our oracle's business
      checked++;
      const parseErrors = doc.parseResult?.parserErrors?.length ?? 0;
      const lexerErrors = (doc.parseResult as unknown as { lexerErrors?: unknown[] })?.lexerErrors?.length ?? 0;
      if (parseErrors + lexerErrors > 0) failures.push(rel);
    }

    expect(checked).toBeGreaterThan(0);
    expect(new Set(failures)).toEqual(KNOWN_PARSE_FAILURES);
  }, 900000);
});
