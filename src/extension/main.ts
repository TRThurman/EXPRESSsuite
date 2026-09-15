import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { ExpressP11StatusBarItem } from "./express-p11-status-bar-item.js";
import { registerHoverProvider } from "./hover-provider.js";
import { getAnnotationIndex } from "./annotation-client.js";
import { showDescriptionPreview, showExpressGPreview, openMathPlayground } from "./webviews.js";
import { initPlurimathPool, shutdownPlurimathPool } from "./plurimath-pool.js";
import { time } from "./perf.js";
import {
  DETECT_SCHEMA_CLOSURE_DUPLICATES_REQUEST,
  DetectSchemaClosureDuplicatesResult,
} from "../shared/schema-closure-duplicates.js";

let client: LanguageClient;
let schemaClosureDiagnostics: vscode.DiagnosticCollection;

// This function is called when the extension is activated.
export function activate(context: vscode.ExtensionContext): void {
  const stop = time("activate");
  client = startLanguageClient(context);
  schemaClosureDiagnostics = vscode.languages.createDiagnosticCollection("EXPRESSsuite schema closure");
  context.subscriptions.push(schemaClosureDiagnostics);
  initPlurimathPool(context);
  registerHoverProvider(context, client);
  registerViewerCommands(context);
  stop(/* threshold */ 1500);
}

function registerViewerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("express.showDescription", async (arg?: { path?: string }) => {
      const stop = time("command.showDescription");
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "express") {
        vscode.window.showInformationMessage("Place the cursor in an EXPRESS file first.");
        return;
      }
      const idx = await getAnnotationIndex(editor.document, client);
      let pathArg = arg?.path;
      if (!pathArg) {
        const wordRange = editor.document.getWordRangeAtPosition(
          editor.selection.active,
          /[A-Za-z_][A-Za-z0-9_]*/,
        );
        if (!wordRange) return;
        const word = editor.document.getText(wordRange);
        const matches = idx.byEntityName(word);
        if (matches.length === 0) {
          vscode.window.showInformationMessage(`No description found for "${word}".`);
          return;
        }
        pathArg = `${matches[0].parts[0]}.${matches[0].parts[1]}`;
      }
      const anns = idx.byPath(pathArg);
      const primary =
        anns.find((a) => a.tag === pathArg) ??
        anns.find((a) => a.tag === `${pathArg}.__note`) ??
        anns[0];
      if (!primary) {
        vscode.window.showInformationMessage(`No description found for "${pathArg}".`);
        return;
      }
      await showDescriptionPreview(context, primary, editor.document.uri);
      stop(/* threshold */ 1000);
    }),

    vscode.commands.registerCommand("express.showExpressG", async () => {
      const stop = time("command.showExpressG");
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "express") {
        vscode.window.showInformationMessage("Place the cursor in an EXPRESS file first.");
        return;
      }
      const dir = path.dirname(editor.document.uri.fsPath);
      const baseName = path.basename(editor.document.uri.fsPath, ".exp");
      const allCandidates = await findExpressGSvgs(dir, baseName);
      if (allCandidates.length === 0) {
        vscode.window.showInformationMessage(`No EXPRESS-G SVG (${baseName}expg*.svg) found next to ${baseName}.exp.`);
        return;
      }

      // Narrow to diagrams referencing the cursor word, if any.
      let candidates = allCandidates;
      let cursorWord: string | undefined;
      const wordRange = editor.document.getWordRangeAtPosition(
        editor.selection.active,
        /[A-Za-z_][A-Za-z0-9_]*/,
      );
      if (wordRange) {
        cursorWord = editor.document.getText(wordRange);
        const idx = await getAnnotationIndex(editor.document, client);
        const matchedFiles = new Set(idx.expressGForEntity(cursorWord));
        if (matchedFiles.size > 0) {
          const filtered = allCandidates.filter((u) => matchedFiles.has(path.basename(u.fsPath)));
          if (filtered.length > 0) candidates = filtered;
        }
      }

      const placeHolder = cursorWord && candidates !== allCandidates
        ? `Diagrams containing "${cursorWord}"`
        : "Select EXPRESS-G diagram";
      const pick =
        candidates.length === 1
          ? candidates[0]
          : await vscode.window.showQuickPick(
              candidates.map((u) => ({ label: path.basename(u.fsPath), uri: u })),
              { placeHolder },
            ).then((p) => p?.uri);
      if (!pick) return;

      // Build the hotspot index→entity-tag map from the schema's
      // __expressg remarks for the chosen SVG.
      const idx2 = await getAnnotationIndex(editor.document, client);
      const diagram = idx2.expressGDiagrams().find((d) => d.svgFile === path.basename(pick.fsPath));
      const hotspotMap = diagram?.hotspotMap ?? {};

      await showExpressGPreview(context, pick, editor.document.uri, hotspotMap, async (name) => {
        // Accept either bare entity name ("point") or schema.entity ("geometry_schema.point").
        // Defense-in-depth: the message validator already restricts characters,
        // but reject empty, ".", ".." segments here too before any path.join.
        const parts = name.split(".").map((s) => s.trim());
        if (parts.some((p) => p.length === 0 || p === "." || p === ".." || p.includes("/") || p.includes("\\"))) {
          return undefined;
        }
        const schemaHint = parts.length >= 2 ? parts[0] : undefined;
        const bareName = parts[parts.length - 1];

        // First: ask the language server's IndexManager (DESIGN §3.2.3).
        try {
          const lspResult = await client.sendRequest("express/resolveEntity", {
            name: bareName,
            schemaHint,
          }) as { uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } | null } | null;
          if (lspResult && lspResult.uri && lspResult.range) {
            const { start, end } = lspResult.range;
            return {
              uri: vscode.Uri.parse(lspResult.uri),
              range: new vscode.Range(start.line, start.character, end.line, end.character),
            };
          }
        } catch {
          // LSP not ready or request failed; fall through to fs-scan.
        }

        // Fallback: filesystem scan. Useful for files the language server has
        // not yet indexed (single-file dev-host mode without a workspace).
        const re = new RegExp(`^\\s*(ENTITY|TYPE|FUNCTION|RULE|PROCEDURE|SCHEMA)\\s+${bareName}\\b`, "im");

        const tryFile = async (fileUri: vscode.Uri): Promise<{ uri: vscode.Uri; range: vscode.Range } | undefined> => {
          let content: string;
          try {
            content = await fs.readFile(fileUri.fsPath, "utf8");
          } catch {
            return undefined;
          }
          const m = re.exec(content);
          if (!m) return undefined;
          const before = content.slice(0, m.index);
          const line = before.split("\n").length - 1;
          const col = m.index - before.lastIndexOf("\n") - 1 + m[0].indexOf(bareName);
          const range = new vscode.Range(line, col, line, col + bareName.length);
          return { uri: fileUri, range };
        };

        // Strategy:
        //  1. Same file as the active editor (most common: same-schema xrefs).
        //  2. Sibling .exp file matching the schema name (cross-schema, dotted-tag case).
        //  3. Two-level walk up the directory looking for sibling schema dirs.
        //  4. Workspace findFiles fallback.

        const activeFile = editor.document.uri;
        const activeDir = path.dirname(activeFile.fsPath);
        const grandparent = path.dirname(activeDir);

        const candidatePaths: string[] = [activeFile.fsPath];
        if (schemaHint) {
          // sibling schema directory pattern: ../<schemaHint>/<schemaHint>.exp
          candidatePaths.push(path.join(grandparent, schemaHint, `${schemaHint}.exp`));
          // and the same dir, just in case
          candidatePaths.push(path.join(activeDir, `${schemaHint}.exp`));
        }
        for (const p of candidatePaths) {
          const result = await tryFile(vscode.Uri.file(p));
          if (result) return result;
        }

        // Walk grandparent recursively (up to 200 .exp files) — covers the
        // wg12-step layout where schemas are sibling directories under
        // schemas/resources/.
        try {
          const entries = await fs.readdir(grandparent, { withFileTypes: true });
          let scanned = 0;
          for (const e of entries) {
            if (!e.isDirectory()) continue;
            const subdir = path.join(grandparent, e.name);
            const expFile = path.join(subdir, `${e.name}.exp`);
            const result = await tryFile(vscode.Uri.file(expFile));
            if (result) return result;
            if (++scanned > 200) break;
          }
        } catch { /* ignore */ }

        // Last resort: workspace findFiles (nothing if no workspace).
        const matches = await vscode.workspace.findFiles("**/*.exp", "**/node_modules/**", 200);
        for (const fileUri of matches) {
          const result = await tryFile(fileUri);
          if (result) return result;
        }
        return undefined;
      });
      stop(/* threshold */ 800);
    }),

    vscode.commands.registerCommand("express.openMathPlayground", () => {
      const stop = time("command.openMathPlayground");
      openMathPlayground(context);
      stop(/* threshold */ 500);
    }),

    vscode.commands.registerCommand("express.sendSelectionToMathPlayground", () => {
      const stop = time("command.sendSelectionToMathPlayground");
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "express") {
        vscode.window.showInformationMessage("Place the cursor in an EXPRESS file first.");
        return;
      }
      const sel = editor.document.getText(editor.selection);
      if (sel.length === 0) {
        vscode.window.showInformationMessage("Select some text first (the math expression or surrounding prose).");
        return;
      }
      openMathPlayground(context, sel);
      stop(/* threshold */ 500);
    }),

    vscode.commands.registerCommand("express.detectDuplicateDeclarationsInClosure", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "express") {
        vscode.window.showInformationMessage("Place the cursor in an EXPRESS schema first.");
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "EXPRESSsuite: Detecting duplicate declarations",
          cancellable: true,
        },
        async (_progress, token) => {
          try {
            const result = await client.sendRequest<DetectSchemaClosureDuplicatesResult>(
              DETECT_SCHEMA_CLOSURE_DUPLICATES_REQUEST,
              {
                uri: editor.document.uri.toString(),
                position: editor.selection.active,
              },
              token,
            );
            if (token.isCancellationRequested) return;
            if (!result.schema) {
              vscode.window.showInformationMessage("Place the cursor inside an EXPRESS schema first.");
              return;
            }

            schemaClosureDiagnostics.clear();
            const diagnosticsByUri = new Map<string, vscode.Diagnostic[]>();
            for (const conflict of result.conflicts) {
              const schemas = [...new Set(conflict.locations.map((location) => location.schema))].sort();
              const message = `${conflict.category} '${conflict.name}' is declared in multiple schemas in the closure of '${result.schema}': ${schemas.join(", ")}.`;
              for (const location of conflict.locations) {
                const diagnostic = new vscode.Diagnostic(
                  new vscode.Range(
                    location.range.start.line,
                    location.range.start.character,
                    location.range.end.line,
                    location.range.end.character,
                  ),
                  message,
                  vscode.DiagnosticSeverity.Error,
                );
                diagnostic.source = "EXPRESSsuite";
                diagnostic.code = "duplicate-schema-closure-declaration";
                diagnostic.relatedInformation = conflict.locations
                  .filter((candidate) => candidate !== location)
                  .map((candidate) => new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(
                      vscode.Uri.parse(candidate.uri),
                      new vscode.Range(
                        candidate.range.start.line,
                        candidate.range.start.character,
                        candidate.range.end.line,
                        candidate.range.end.character,
                      ),
                    ),
                    `${conflict.category} '${conflict.name}' is also declared in schema '${candidate.schema}'.`,
                  ));
                const diagnostics = diagnosticsByUri.get(location.uri) ?? [];
                diagnostics.push(diagnostic);
                diagnosticsByUri.set(location.uri, diagnostics);
              }
            }
            for (const [uri, diagnostics] of diagnosticsByUri) {
              schemaClosureDiagnostics.set(vscode.Uri.parse(uri), diagnostics);
            }

            const count = result.conflicts.length;
            vscode.window.showInformationMessage(
              count === 0
                ? `No duplicate declarations found in the closure of '${result.schema}'.`
                : `Found ${count} duplicate declaration ${count === 1 ? "name" : "names"} in the closure of '${result.schema}'.`,
            );
          } catch (error) {
            if (token.isCancellationRequested) return;
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Could not detect duplicate declarations: ${message}`);
          }
        },
      );
    }),
  );
}

async function findExpressGSvgs(dir: string, baseName: string): Promise<vscode.Uri[]> {
  try {
    const entries = await fs.readdir(dir);
    const re = new RegExp(`^${baseName}expg\\d*\\.svg$`, "i");
    return entries
      .filter((e) => re.test(e))
      .sort()
      .map((e) => vscode.Uri.file(path.join(dir, e)));
  } catch {
    return [];
  }
}

// This function is called when the extension is deactivated.
export function deactivate(): Thenable<void> | undefined {
  shutdownPlurimathPool();
  if (client) {
    return client.stop();
  }
  return undefined;
}

function startLanguageClient(context: vscode.ExtensionContext): LanguageClient {
  const serverModule = context.asAbsolutePath(path.join("out", "language", "main.js"));
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging.
  // By setting `process.env.DEBUG_BREAK` to a truthy value, the language server will wait until a debugger is attached.
  const debugOptions = {
    execArgv: ["--nolazy", `--inspect${process.env.DEBUG_BREAK ? "-brk" : ""}=${process.env.DEBUG_SOCKET || "6009"}`],
  };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
  };

  const fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/*.exp");
  context.subscriptions.push(fileSystemWatcher);

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "express" }],
    synchronize: {
      // Notify the server about file changes to files contained in the workspace
      fileEvents: fileSystemWatcher,
    },
  };

  // Create the language client and start the client.
  const client = new LanguageClient("express", "express", serverOptions, clientOptions);

  const statusBarItem = new ExpressP11StatusBarItem(client);
  context.subscriptions.push(statusBarItem);

  // Start the client. This will also launch the server
  client.start();

  return client;
}
