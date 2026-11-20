import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Headless diagnostics census, one workspace per folder, for differential work
 * against external checkers that read one file at a time. Not a test of
 * EXPRESSsuite by itself: it runs only when the environment names a list of
 * folders.
 *
 *   EQUIV_DIRS=<file listing one folder per line> EQUIV_OUT=<file.json> \
 *       npx vitest run src/test/equivalence-census.test.ts
 *
 * Each folder is loaded alone with fresh services, the extension's default
 * settings except that nothing is excluded (long forms and concatenated files
 * are the usual inputs here), so the result is what VS Code shows for that
 * folder opened as the workspace with empty exclusion lists. The output holds
 * file names, positions, codes and messages only.
 */
const list = process.env.EQUIV_DIRS ? resolve(process.env.EQUIV_DIRS) : undefined;
const out = process.env.EQUIV_OUT ? resolve(process.env.EQUIV_OUT) : undefined;

describe.skipIf(!list || !out)("per-folder diagnostics census", () => {
  test("collect every published diagnostic, folder by folder", async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const props = pkg.contributes.configuration.properties;
    const settings = {
      expresssuite: {
        useOptimizedConfiguration: props["expresssuite.useOptimizedConfiguration"].default,
        excludedFolders: [] as string[],
        excludedFiles: [] as string[],
      },
    };
    const dirs = readFileSync(list!, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    const started = Date.now();
    const results: unknown[] = [];
    for (const dir of dirs) {
      const root = resolve(dir);
      const t0 = Date.now();
      const { shared } = createExpressP11Services(NodeFileSystem);
      await shared.workspace.ConfigurationProvider.initialized({});
      shared.workspace.ConfigurationProvider.updateConfiguration({ settings });
      (shared.workspace.WorkspaceManager as unknown as { initialBuildOptions: { validation: boolean } }).initialBuildOptions = { validation: true };
      let error: string | null = null;
      try {
        await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(root).toString(), name: "equiv" }]);
        await shared.workspace.WorkspaceManager.ready;
      } catch (e) {
        error = String(e);
      }
      const files = [];
      for (const doc of shared.workspace.LangiumDocuments.all.toArray()) {
        const path = doc.uri.path;
        if (!path.startsWith(root)) continue;
        files.push({
          file: path.slice(root.length + 1),
          lexerErrors: doc.parseResult?.lexerErrors?.length ?? 0,
          parserErrors: doc.parseResult?.parserErrors?.length ?? 0,
          diagnostics: (doc.diagnostics ?? []).map((d) => ({
            line: d.range.start.line + 1,
            col: d.range.start.character + 1,
            endLine: d.range.end.line + 1,
            endCol: d.range.end.character + 1,
            severity: d.severity,
            code: (d.code ?? (d.data as { code?: string } | undefined)?.code) ?? null,
            message: d.message,
          })),
        });
      }
      results.push({ dir: root, error, elapsedMs: Date.now() - t0, files });
    }
    writeFileSync(out!, `${JSON.stringify({ tool: "expresssuite", version: pkg.version, settings, elapsedMs: Date.now() - started, results }, null, 1)}\n`);
    console.log(`equivalence census: ${dirs.length} folders, ${Math.round((Date.now() - started) / 1000)} s -> ${out}`);
  }, 7200000);
});
