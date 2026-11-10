import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

/**
 * Local census of annotation findings. Runs only when EXPRESSSUITE_ANNOTATION_CENSUS
 * names a directory of .exp files. Prints counts per code and the shapes of the
 * orphan keys; it prints no names and no text, and asserts nothing about counts.
 */
const root = process.env.EXPRESSSUITE_ANNOTATION_CENSUS;

function expFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...expFiles(path));
    else if (/\.exp$/i.test(entry.name) && !/_lf\.exp$/i.test(entry.name) && !/concatenated/i.test(entry.name)) found.push(path);
  }
  return found.sort();
}

function keyShape(key: string): string {
  const stripped = key.replace(/\.__[^.]*$/, "");
  if (stripped !== key) return "s.d.__x";
  const parts = key.split(".");
  if (parts.length === 2) return "s.d";
  if (parts.length === 3) {
    if (/^wr:/i.test(parts[2])) return "s.d.wr:X";
    if (/^ur:/i.test(parts[2])) return "s.d.ur:X";
    return "s.d.m";
  }
  return "other";
}

describe.skipIf(!root)("annotation census", () => {
  test("counts findings per code", async () => {
    const files = expFiles(resolve(root!));
    expect(files.length).toBeGreaterThan(0);

    const { shared } = createExpressP11Services(NodeFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    const documents = await Promise.all(files.map((file) => shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(file))));
    await shared.workspace.DocumentBuilder.build(documents, { validation: true });
    expect(documents.length).toBeGreaterThan(0);

    const byCode = new Map<string, number>();
    const shapes = new Map<string, number>();
    for (const doc of documents) {
      for (const d of doc.diagnostics ?? []) {
        const code = String(d.code ?? (d.data as { code?: string } | undefined)?.code ?? "");
        if (!code.startsWith("annotation-")) continue;
        byCode.set(code, (byCode.get(code) ?? 0) + 1);
        if (code === "annotation-orphan-key") {
          const key = doc.textDocument.getText(d.range);
          const shape = keyShape(key);
          shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
        }
      }
    }
    const lines = [`files built: ${documents.length}`, "code\tcount"];
    for (const [code, count] of [...byCode].sort()) lines.push(`${code}\t${count}`);
    lines.push("orphan key shape\tcount");
    for (const [shape, count] of [...shapes].sort()) lines.push(`${shape}\t${count}`);
    console.log(lines.join("\n"));
  }, 3_600_000);
});
