import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Headless diagnostics census over a workspace folder, for differential work
 * against external checkers such as eengine. Not a test of EXPRESSsuite by
 * itself: it only runs when the environment names a workspace, and it writes
 * what the language server would publish for every document in it.
 *
 *   EXPRESS_DIAGNOSE_ROOT=<folder> EXPRESS_DIAGNOSE_OUT=<file.json> \
 *       npx vitest run src/test/workspace-diagnostics.test.ts
 *
 * The workspace is loaded with the extension's default settings read from
 * package.json (optimized configuration, excluded folders and files), so the
 * census matches what a user sees in VS Code with an unchanged configuration.
 * The output holds file names, positions, codes and messages only.
 */
const root = process.env.EXPRESS_DIAGNOSE_ROOT ? resolve(process.env.EXPRESS_DIAGNOSE_ROOT) : undefined;
const out = process.env.EXPRESS_DIAGNOSE_OUT ? resolve(process.env.EXPRESS_DIAGNOSE_OUT) : undefined;

describe.skipIf(!root || !out)("workspace diagnostics census", () => {
  test("collect every published diagnostic", async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const props = pkg.contributes.configuration.properties;
    const settings = {
      expresssuite: {
        useOptimizedConfiguration: props["expresssuite.useOptimizedConfiguration"].default,
        excludedFolders: props["expresssuite.excludedFolders"].default,
        excludedFiles: props["expresssuite.excludedFiles"].default,
      },
    };
    const { shared } = createExpressP11Services(NodeFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    shared.workspace.ConfigurationProvider.updateConfiguration({ settings });
    // The initial workspace build does not validate; ask for diagnostics up front.
    (shared.workspace.WorkspaceManager as unknown as { initialBuildOptions: { validation: boolean } }).initialBuildOptions = { validation: true };
    const started = Date.now();
    await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(root!).toString(), name: "corpus" }]);
    await shared.workspace.WorkspaceManager.ready;

    const files: unknown[] = [];
    let diagnosticCount = 0;
    for (const doc of shared.workspace.LangiumDocuments.all.toArray()) {
      const path = doc.uri.path;
      if (!path.startsWith(root!)) continue;
      const rel = path.slice(root!.length + 1);
      const diagnostics = (doc.diagnostics ?? []).map((d) => ({
        line: d.range.start.line + 1,
        col: d.range.start.character + 1,
        endLine: d.range.end.line + 1,
        endCol: d.range.end.character + 1,
        severity: d.severity,
        code: (d.code ?? (d.data as { code?: string } | undefined)?.code) ?? null,
        message: d.message,
      }));
      diagnosticCount += diagnostics.length;
      files.push({
        file: rel,
        state: doc.state,
        lexerErrors: doc.parseResult?.lexerErrors?.length ?? 0,
        parserErrors: doc.parseResult?.parserErrors?.length ?? 0,
        diagnostics,
      });
    }
    (files as { file: string }[]).sort((a, b) => a.file.localeCompare(b.file));
    writeFileSync(
      out!,
      `${JSON.stringify({ tool: "expresssuite", version: pkg.version, settings, elapsedMs: Date.now() - started, fileCount: files.length, diagnosticCount, files }, null, 1)}\n`
    );
    console.log(`census: ${files.length} documents, ${diagnosticCount} diagnostics, ${Math.round((Date.now() - started) / 1000)} s -> ${out}`);
  }, 3600000);
});
