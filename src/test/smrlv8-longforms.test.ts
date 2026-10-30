import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CensusBuilder, corpusRoot, defaultSettings, duplicateSites, expectBaseline, forEachCorpusFileAlone, heapMb, type DuplicateSite } from "./smrlv8-corpus-support.js";

/**
 * The published long forms (modules/<name>/arm_lf.exp and mim_lf.exp) are the
 * schemas the WG11 N239 rules apply to: identifiers are unique regardless of
 * case and an identical repeated definition is a warning, not an error. The
 * default settings exclude them by name, so this test builds them directly
 * with the excludes cleared, each alone in services of its own: a long form is
 * self-contained, and built together they would see each other's copies of
 * every common declaration.
 */
function longFormPaths(): string[] {
  const modules = join(corpusRoot, "modules");
  const paths: string[] = [];
  for (const module of readdirSync(modules).sort()) {
    for (const name of ["arm_lf.exp", "mim_lf.exp"]) {
      const file = join(modules, module, name);
      if (statSync(file, { throwIfNoEntry: false })?.isFile()) paths.push(`modules/${module}/${name}`);
    }
  }
  return paths;
}

describe("SMRL v8 long forms", () => {
  test(
    "every published long form is free of duplicate declarations and matches the baseline",
    async () => {
      const paths = longFormPaths();
      expect(paths.length).toBe(103);
      const started = Date.now();
      const builder = new CensusBuilder(false);
      const duplicates: DuplicateSite[] = [];
      let peakHeap = 0;
      await forEachCorpusFileAlone({ ...defaultSettings(), excludedFiles: [], excludedFolders: [] }, paths, (doc) => {
        builder.add(doc);
        duplicates.push(...duplicateSites([doc]));
        peakHeap = Math.max(peakHeap, heapMb());
      });
      const result = builder.finish();
      console.log(`smrlv8 long forms: ${result.documents} documents, ${result.diagnostics} diagnostics, ${Date.now() - started} ms, peak heap ${peakHeap} MB`);
      expect(result.documents).toBe(103);
      expect(result.parseErrors).toEqual({});
      expect(duplicates).toEqual([]);
      expectBaseline("longform-diagnostics.json", result);
    },
    900_000
  );
});
