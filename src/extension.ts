import * as vscode from "vscode";
import * as path from "path";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  WorkDoneProgress,
} from "vscode-languageclient/node";
import { EASYEXPRESS_FIRST_DONE, EASYEXPRESS_TOKEN } from "./shared/notifications";

let client: LanguageClient;

// This function is called when the extension is activated.
export function activate(context: vscode.ExtensionContext): void {
  try {
    client = startLanguageClient(context);
  } catch (error) {
    console.log("ERROR after activation");
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
  const serverModule = context.asAbsolutePath(path.join("out", "language-server", "main"));
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
    documentSelector: [{ scheme: "file", language: "express-p-11" }],
    synchronize: {
      // Notify the server about file changes to files contained in the workspace
      fileEvents: fileSystemWatcher,
    },
  };

  // Create the language client and start the client.
  const client = new LanguageClient("express-p-11", "easyEXPRESS", serverOptions, clientOptions);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  // Start the client. This will also launch the server
  client.start();

  client.onProgress(WorkDoneProgress.type, EASYEXPRESS_TOKEN, (params) => {
    switch (params.kind) {
      case "begin":
        status.text = `$(sync~spin) easyEXPRESS loading`;
        status.show();
        break;
      case "report":
        status.show();
        status.text = `${params.message}`;

        break;
      case "end":
        vscode.window.showInformationMessage("easyEXPRESS has finished loading your workspace.");

        status.hide();
        break;
    }
  });
  return client;
}
