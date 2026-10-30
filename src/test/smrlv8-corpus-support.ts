import { URI, type LangiumDocument } from "langium";
import { NodeFileSystem } from "langium/node";
import { expect } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Shared support for the SMRL v8 corpus tests.
 *
 * test-fixtures/smrlv8 holds every EXPRESS schema file of the published ISO
 * 10303 SMRL v8 distribution (1,410 .exp files, byte-identical, mostly CRLF).
 * Nothing else from the distribution is kept. The baselines under
 * test-fixtures/smrlv8-baseline pin what the language server publishes for the
 * corpus; a behaviour change shows as a diff in a baseline. Regenerate with
 *
 *   EXPRESS_UPDATE_SMRLV8_BASELINE=1 npx vitest run src/test/smrlv8-*.test.ts
 *
 * and review the diff before committing it.
 */
export const corpusRoot = resolve(process.cwd(), "test-fixtures", "smrlv8");
export const baselineRoot = resolve(process.cwd(), "test-fixtures", "smrlv8-baseline");
const updateBaselines = process.env.EXPRESS_UPDATE_SMRLV8_BASELINE === "1";

export type Settings = { useOptimizedConfiguration: boolean; excludedFolders: string[]; excludedFiles: string[] };

/** The extension's defaults from package.json: what a user sees with an unchanged configuration. */
export function defaultSettings(): Settings {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  const props = pkg.contributes.configuration.properties;
  return {
    useOptimizedConfiguration: props["expresssuite.useOptimizedConfiguration"].default,
    excludedFolders: props["expresssuite.excludedFolders"].default,
    excludedFiles: props["expresssuite.excludedFiles"].default,
  };
}

export async function sharedServices(settings: Settings) {
  const { shared } = createExpressP11Services(NodeFileSystem);
  await shared.workspace.ConfigurationProvider.initialized({});
  shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { expresssuite: settings } });
  return shared;
}

/** Loads the corpus folder as a workspace, validating every document the settings admit. */
export async function loadCorpusWorkspace(settings: Settings): Promise<LangiumDocument[]> {
  const shared = await sharedServices(settings);
  // The initial workspace build does not validate; ask for diagnostics up front.
  (shared.workspace.WorkspaceManager as unknown as { initialBuildOptions: { validation: boolean } }).initialBuildOptions = { validation: true };
  await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(corpusRoot).toString(), name: "smrlv8" }]);
  await shared.workspace.WorkspaceManager.ready;
  return shared.workspace.LangiumDocuments.all.toArray().filter((doc) => corpusPath(doc) !== undefined);
}

/**
 * Builds each given corpus file alone, in services of its own, outside the
 * workspace traversal, and hands it to `visit` before dropping it. Built
 * together, a hundred long forms would see each other's copies of every common
 * declaration through the global index and the type container, which is not
 * what any of them means; retained together, they exceed a 6 GB heap.
 * The parser's ambiguity notices, printed once per services instance, are
 * silenced for the duration.
 */
export async function forEachCorpusFileAlone(settings: Settings, relativePaths: string[], visit: (doc: LangiumDocument) => void): Promise<void> {
  const silenced = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    for (const rel of relativePaths) {
      const shared = await sharedServices(settings);
      const doc = await shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(join(corpusRoot, ...rel.split("/"))));
      await shared.workspace.DocumentBuilder.build([doc], { validation: true });
      visit(doc);
    }
  } finally {
    Object.assign(console, silenced);
  }
}

/** Corpus-relative path with forward slashes, or undefined for a document outside the corpus. */
export function corpusPath(doc: LangiumDocument): string | undefined {
  const rel = relative(corpusRoot, doc.uri.fsPath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return rel.split(sep).join("/");
}

export type Census = {
  documents: number;
  diagnostics: number;
  bySeverity: Record<string, number>;
  byCode: Record<string, number>;
  parseErrors: Record<string, { lexer: number; parser: number }>;
  /** file -> diagnostic code -> start lines (1-based, ascending, one per diagnostic), or the count when `lines` is false */
  files: Record<string, Record<string, number[] | number>>;
};

const severityName: Record<number, string> = { 1: "error", 2: "warning", 3: "information", 4: "hint" };

function codeOf(d: { code?: string | number; data?: unknown }): string {
  const code = d.code ?? (d.data as { code?: string } | undefined)?.code;
  return code === undefined || code === null ? "(none)" : String(code);
}

/** Accumulates a `Census` one document at a time, so the documents need not be held together. */
export class CensusBuilder {
  private readonly result: Census = { documents: 0, diagnostics: 0, bySeverity: {}, byCode: {}, parseErrors: {}, files: {} };
  constructor(private readonly lines: boolean) {}

  add(doc: LangiumDocument): void {
    const file = corpusPath(doc)!;
    this.result.documents++;
    const lexer = doc.parseResult.lexerErrors.length;
    const parser = doc.parseResult.parserErrors.length;
    if (lexer || parser) this.result.parseErrors[file] = { lexer, parser };
    const perCode: Record<string, number[]> = {};
    for (const d of doc.diagnostics ?? []) {
      this.result.diagnostics++;
      const sev = severityName[d.severity ?? 0] ?? String(d.severity);
      this.result.bySeverity[sev] = (this.result.bySeverity[sev] ?? 0) + 1;
      const code = codeOf(d);
      this.result.byCode[code] = (this.result.byCode[code] ?? 0) + 1;
      (perCode[code] ??= []).push(d.range.start.line + 1);
    }
    if (Object.keys(perCode).length === 0) return;
    this.result.files[file] = Object.fromEntries(
      Object.keys(perCode)
        .sort()
        .map((code) => [code, this.lines ? perCode[code].sort((a, b) => a - b) : perCode[code].length])
    );
  }

  finish(): Census {
    const files = Object.keys(this.result.files).sort();
    return {
      ...this.result,
      bySeverity: sortedRecord(this.result.bySeverity),
      byCode: sortedRecord(this.result.byCode),
      parseErrors: Object.fromEntries(Object.keys(this.result.parseErrors).sort().map((f) => [f, this.result.parseErrors[f]])),
      files: Object.fromEntries(files.map((f) => [f, this.result.files[f]])),
    };
  }
}

export function census(docs: LangiumDocument[], options: { lines: boolean } = { lines: true }): Census {
  const builder = new CensusBuilder(options.lines);
  for (const doc of sortedByPath(docs)) builder.add(doc);
  return builder.finish();
}

export type DuplicateSite = {
  file: string;
  line: number;
  col: number;
  severity: string;
  code: string;
  identifier: string;
  schemas: string[];
  related: number;
  message: string;
};

/** Every duplicate-interfaced-declaration and redundant-declaration site, in file and position order. */
export function duplicateSites(docs: LangiumDocument[]): DuplicateSite[] {
  const sites: DuplicateSite[] = [];
  for (const doc of sortedByPath(docs)) {
    const file = corpusPath(doc)!;
    for (const d of doc.diagnostics ?? []) {
      const code = codeOf(d);
      if (code !== "duplicate-interfaced-declaration" && code !== "redundant-declaration") continue;
      const data = (d.data ?? {}) as { identifier?: string; schemas?: string[] };
      sites.push({
        file,
        line: d.range.start.line + 1,
        col: d.range.start.character + 1,
        severity: severityName[d.severity ?? 0] ?? String(d.severity),
        code,
        identifier: data.identifier ?? "",
        schemas: data.schemas ?? [],
        related: d.relatedInformation?.length ?? 0,
        message: typeof d.message === "string" ? d.message : d.message.value,
      });
    }
  }
  return sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
}

/** Compares against (or, when EXPRESS_UPDATE_SMRLV8_BASELINE=1, rewrites) a baseline file. */
export function expectBaseline(name: string, actual: unknown): void {
  const file = join(baselineRoot, name);
  if (updateBaselines) {
    mkdirSync(baselineRoot, { recursive: true });
    writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
  }
  expect(existsSync(file), `baseline ${name} is missing; run with EXPRESS_UPDATE_SMRLV8_BASELINE=1 to create it`).toBe(true);
  expect(actual).toEqual(JSON.parse(readFileSync(file, "utf8")));
}

function sortedByPath(docs: LangiumDocument[]): LangiumDocument[] {
  return [...docs].sort((a, b) => corpusPath(a)!.localeCompare(corpusPath(b)!));
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.keys(record).sort().map((k) => [k, record[k]]));
}

export function heapMb(): number {
  return Math.round(process.memoryUsage().heapUsed / 1e6);
}
