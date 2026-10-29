import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { SchemaClosureDuplicateAnalyzer } from "../language/schema-closure-duplicates.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Headless run of "Detect Duplicate Declarations in Schema Closure" over named
 * documents of a workspace, for differential work against external checkers.
 * Runs only when the environment names a workspace:
 *
 *   EXPRESS_CLOSURE_ROOT=<folder> EXPRESS_CLOSURE_FILES=<rel,rel,...> \
 *   EXPRESS_CLOSURE_OUT=<file.json> npx vitest run src/test/workspace-closure-duplicates.test.ts
 *
 * Every SCHEMA in each named document is analysed from the position of its
 * SCHEMA keyword. Output holds schema names, declaration names and locations only.
 */
const root = process.env.EXPRESS_CLOSURE_ROOT ? resolve(process.env.EXPRESS_CLOSURE_ROOT) : undefined;
const files = process.env.EXPRESS_CLOSURE_FILES?.split(",").map((f) => f.trim()).filter(Boolean) ?? [];
const out = process.env.EXPRESS_CLOSURE_OUT ? resolve(process.env.EXPRESS_CLOSURE_OUT) : undefined;

describe.skipIf(!root || !out || files.length === 0)("workspace closure duplicates", () => {
  test("analyse each schema of the named documents", async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const props = pkg.contributes.configuration.properties;
    const settings = {
      expresssuite: {
        useOptimizedConfiguration: props["expresssuite.useOptimizedConfiguration"].default,
        excludedFolders: props["expresssuite.excludedFolders"].default,
        excludedFiles: props["expresssuite.excludedFiles"].default,
      },
    };
    const { shared, ExpressP11 } = createExpressP11Services(NodeFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    shared.workspace.ConfigurationProvider.updateConfiguration({ settings });
    await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(root!).toString(), name: "corpus" }]);
    await shared.workspace.WorkspaceManager.ready;
    const analyzer = new SchemaClosureDuplicateAnalyzer(ExpressP11);
    const results: unknown[] = [];
    for (const rel of files) {
      const uri = URI.file(join(root!, rel));
      const doc = shared.workspace.LangiumDocuments.getDocument(uri);
      if (!doc) { results.push({ file: rel, error: "not in workspace" }); continue; }
      const text = doc.textDocument.getText();
      const schemaOffsets: number[] = [];
      const re = /\bSCHEMA\s+[A-Za-z_][A-Za-z0-9_]*/g;
      for (let m = re.exec(text); m; m = re.exec(text)) schemaOffsets.push(m.index + 7);
      for (const offset of schemaOffsets) {
        const result = analyzer.analyze(doc.uri.toString(), doc.textDocument.positionAt(offset));
        results.push({ file: rel, schema: result.schema, conflicts: result.conflicts });
      }
    }
    writeFileSync(out!, `${JSON.stringify({ tool: "expresssuite-closure-duplicates", version: pkg.version, results }, null, 1)}\n`);
    console.log(`closure duplicates: ${results.length} schema analyses -> ${out}`);
  }, 3600000);
});
