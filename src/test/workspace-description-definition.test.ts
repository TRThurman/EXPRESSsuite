import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { annotationContexts, findExpressLinks } from "../language/annotation/blocks.js";
import { pathSegments } from "../language/annotation/definition.js";
import { createExpressP11Services } from "../language/express-module.js";
import type { ExpressP11DefinitionProvider } from "../language/express-p11-definition-provider.js";
import { isLongFormSchemaName } from "../language/express-p11-scope-index.js";
import { isExpressFile } from "../language/generated/ast.js";

/**
 * Headless census of Go to Definition from description blocks over a workspace folder: for the
 * key of every block and the target of every `<<express:...>>` cross-reference, whether the
 * provider finds the declaration named, by the shape of the key. Not a test by itself: it runs
 * only when the environment names a workspace, and writes shapes and counts only.
 *
 *   EXPRESS_DEFINITION_ROOT=<folder> EXPRESS_DEFINITION_OUT=<file.json> \
 *       npx vitest run src/test/workspace-description-definition.test.ts
 *
 * The workspace is loaded with the extension's default settings read from package.json.
 * Outcomes are the routes of `DescriptionRoute` (`exact`, `proposition`, `interface`, `elsewhere`,
 * `nearest`), and `none` when nothing is found.
 */
const root = process.env.EXPRESS_DEFINITION_ROOT ? resolve(process.env.EXPRESS_DEFINITION_ROOT) : undefined;
const out = process.env.EXPRESS_DEFINITION_OUT ? resolve(process.env.EXPRESS_DEFINITION_OUT) : undefined;

/** `schema.name.wr:label.__role`: each part of a key replaced by what kind of part it is. */
function shapeOf(path: string): string {
  return pathSegments(path)
    .map((segment, index) => {
      const text = segment.text.toLowerCase();
      if (index === 0) return "schema";
      if (text.startsWith("__")) return "__role";
      if (/^wr:ip\d+$/.test(text)) return "wr:IPn";
      if (/^ip\d+$/.test(text)) return "IPn";
      if (text.startsWith("wr:")) return "wr:label";
      if (text.startsWith("ur:")) return "ur:label";
      if (text.includes("\\")) return "SELF\\supertype.attribute";
      if (/^[a-z_][a-z0-9_]*$/.test(text)) return "name";
      return "other";
    })
    .join(".");
}

describe.skipIf(!root || !out)("workspace census of Go to Definition from descriptions", () => {
  test("count, by shape, the keys and cross-references the provider resolves", async () => {
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

    const provider = ExpressP11.lsp.DefinitionProvider as ExpressP11DefinitionProvider;
    const documents = shared.workspace.LangiumDocuments.all.toArray();

    type Tally = Record<string, Record<string, number>>;
    const keys: Tally = {};
    const links: Tally = {};
    const count = (tally: Tally, shape: string, outcome: string): void => {
      (tally[shape] ??= {})[outcome] = (tally[shape][outcome] ?? 0) + 1;
    };
    // A few paths for each outcome other than `exact`, to read what the counts stand for.
    const samples: Record<string, string[]> = {};
    const outcomeOf = (document: (typeof documents)[number], offset: number, kind: string, path: string): string => {
      const targets = provider.descriptionTargets(document, offset)?.targets ?? [];
      const outcome = targets.length === 0 ? "none" : targets.length > 1 ? `${targets[0].via} (several)` : targets[0].via;
      if (outcome !== "exact") {
        const list = (samples[`${kind} ${outcome}`] ??= []);
        if (list.length < 400 && !list.includes(path)) list.push(path);
      }
      return outcome;
    };

    let files = 0;
    for (const document of documents) {
      const file = document.parseResult.value;
      if (!isExpressFile(file) || !file.schemas?.length) continue;
      const text = document.textDocument.getText();
      const contexts = annotationContexts(file, text).filter((context) => !isLongFormSchemaName(context.schema));
      if (contexts.every((context) => context.blocks.length === 0)) continue;
      files++;
      for (const context of contexts) {
        for (const block of context.blocks) {
          count(keys, shapeOf(block.key), outcomeOf(document, block.keyEnd, "key", block.key));
          for (const link of findExpressLinks(block.body)) {
            const end = block.bodyStart + link.start + "<<express:".length + link.target.length;
            count(links, shapeOf(link.target), outcomeOf(document, end, "link", link.target));
          }
        }
      }
    }
    const total = (tally: Tally): Record<string, number> => {
      const sum: Record<string, number> = {};
      for (const outcomes of Object.values(tally)) for (const [outcome, n] of Object.entries(outcomes)) sum[outcome] = (sum[outcome] ?? 0) + n;
      return sum;
    };
    const report = { root, files, keys, keyTotals: total(keys), links, linkTotals: total(links), samples };
    writeFileSync(out!, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ files, keyTotals: report.keyTotals, linkTotals: report.linkTotals }));
  }, 1_800_000);
});
