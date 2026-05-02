import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node.js";
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { LanguageClient, TransportKind } from "vscode-languageclient/node.js";
import { ExpressP11StatusBarItem } from "./express-p11-status-bar-item.js";
import { registerHoverProvider } from "./hover-provider.js";
import { AnnotationIndex } from "./annotation-index.js";
import { showDescriptionPreview, showExpressGPreview, openMathPlayground } from "./webviews.js";

let client: LanguageClient;

// This function is called when the extension is activated.
export function activate(context: vscode.ExtensionContext): void {
  client = startLanguageClient(context);
  registerHoverProvider(context);
  registerViewerCommands(context);
}

function registerViewerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("express.showDescription", async (arg?: { path?: string }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "express") {
        vscode.window.showInformationMessage("Place the cursor in an EXPRESS file first.");
        return;
      }
      const idx = new AnnotationIndex(editor.document.getText());
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
    }),

    vscode.commands.registerCommand("express.showExpressG", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "express") {
        vscode.window.showInformationMessage("Place the cursor in an EXPRESS file first.");
        return;
      }
      const dir = path.dirname(editor.document.uri.fsPath);
      const baseName = path.basename(editor.document.uri.fsPath, ".exp");
      const candidates = await findExpressGSvgs(dir, baseName);
      if (candidates.length === 0) {
        vscode.window.showInformationMessage(`No EXPRESS-G SVG (${baseName}expg*.svg) found next to ${baseName}.exp.`);
        return;
      }
      const pick =
        candidates.length === 1
          ? candidates[0]
          : await vscode.window.showQuickPick(
              candidates.map((u) => ({ label: path.basename(u.fsPath), uri: u })),
              { placeHolder: "Select EXPRESS-G diagram" },
            ).then((p) => p?.uri);
      if (!pick) return;

      await showExpressGPreview(context, pick, editor.document.uri, async (name) => {
        // POC xref resolver: search the workspace's IndexManager-equivalent
        // by scanning .exp files for "ENTITY name" or "TYPE name" declarations.
        const matches = await vscode.workspace.findFiles("**/*.exp", "**/node_modules/**", 50);
        for (const fileUri of matches) {
          const content = await fs.readFile(fileUri.fsPath, "utf8");
          const re = new RegExp(`^\\s*(ENTITY|TYPE|FUNCTION|RULE|PROCEDURE)\\s+${name}\\b`, "im");
          const m = re.exec(content);
          if (m) {
            const before = content.slice(0, m.index);
            const line = before.split("\n").length - 1;
            const col = m.index - before.lastIndexOf("\n") - 1 + m[0].indexOf(name);
            const range = new vscode.Range(line, col, line, col + name.length);
            return { uri: fileUri, range };
          }
        }
        return undefined;
      });
    }),

    vscode.commands.registerCommand("express.openMathPlayground", () => {
      openMathPlayground(context);
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
  if (client) {
    return client.stop();
  }
  return undefined;
}

function startLanguageClient(context: vscode.ExtensionContext): LanguageClient {
  const serverModule = context.asAbsolutePath(path.join("out", "language", "main.cjs"));
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
