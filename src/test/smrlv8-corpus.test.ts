import { describe, expect, test } from "vitest";
import { census, defaultSettings, duplicateSites, expectBaseline, heapMb, loadCorpusWorkspace } from "./smrlv8-corpus-support.js";

/**
 * Regression census over the published ISO 10303 SMRL v8 EXPRESS schemas
 * (test-fixtures/smrlv8) loaded as a workspace with the extension's default
 * settings, so the result is what a user sees in VS Code with an unchanged
 * configuration: long forms and concatenated files are excluded by name,
 * business_object_models by folder (1,287 of the 1,410 files load).
 *
 * The baselines are not a claim that every diagnostic is right. They pin the
 * current behaviour on real schemas so that a change in the parser, linker or
 * a validator shows up as a reviewable diff. Known false positives are listed
 * where they are pinned (see test-fixtures/smrlv8-baseline/README.md).
 */
describe("SMRL v8 corpus, default settings", () => {
  test(
    "diagnostics match the baseline",
    async () => {
      const started = Date.now();
      const docs = await loadCorpusWorkspace(defaultSettings());
      const result = census(docs);
      console.log(`smrlv8 default settings: ${docs.length} documents, ${result.diagnostics} diagnostics, ${Date.now() - started} ms, heap ${heapMb()} MB`);
      expect(docs.length).toBe(1287);
      // The one file with parser errors is a stray fragment shipped in the distribution, not a schema.
      expect(Object.keys(result.parseErrors)).toEqual(["modules/solid_with_local_modification/Revisedent.exp"]);
      expectBaseline("default-diagnostics.json", result);
      expectBaseline("default-duplicate-declarations.json", duplicateSites(docs));
      // Short forms never get the long-form warning (WG11 N239 applies to long forms only).
      expect(result.byCode["redundant-declaration"]).toBeUndefined();
    },
    600_000
  );
});
