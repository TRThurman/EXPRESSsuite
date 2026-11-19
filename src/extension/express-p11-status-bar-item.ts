import { LanguageClient, WorkDoneProgress } from "vscode-languageclient/node";
import * as vscode from "vscode";

import { EXPRESSSUITE_TOKEN } from "../shared/notifications.js";
import { EXPRESSSUITE_COMMANDS, EXPRESSSUITE_CONFIGURATION_SECTION } from "../shared/commands.js";
import { excludedFileStatus } from "./excluded-file-status.js";

export class ExpressP11StatusBarItem {
  private statusBarItem: vscode.StatusBarItem;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Shown while the active editor holds an EXPRESS file that the settings leave out of the workspace. */
  private excludedItem: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[] = [];
  constructor(private client: LanguageClient) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.setProgressHandler();
    this.excludedItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this.excludedItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    this.excludedItem.command = { title: "Open the settings", command: "workbench.action.openSettings", arguments: ["@ext:TRThurman.expresssuite excluded"] };
    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.showExcluded()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.showExcluded()),
      vscode.workspace.onDidOpenTextDocument(() => this.showExcluded()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION)) this.showExcluded();
      })
    );
    this.showExcluded();
  }

  private showExcluded(): void {
    const document = vscode.window.activeTextEditor?.document;
    const settings = vscode.workspace.getConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION);
    const status =
      document && document.languageId === "express" && document.uri.scheme === "file"
        ? excludedFileStatus(document.uri.toString(), {
            useOptimizedConfiguration: settings.get<boolean>("useOptimizedConfiguration", true),
            excludedFolders: settings.get<string[]>("excludedFolders", []),
            excludedFiles: settings.get<string[]>("excludedFiles", []),
            workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()),
          })
        : undefined;
    if (!status) {
      this.excludedItem.hide();
      return;
    }
    this.excludedItem.text = status.text;
    this.excludedItem.tooltip = status.tooltip;
    this.excludedItem.show();
  }

  private setFullBuildHander() {
    this.statusBarItem.text = "$(play) Build";
    this.statusBarItem.tooltip = "Build your EXPRESS workspace";
    this.statusBarItem.command = EXPRESSSUITE_COMMANDS.buildWorkspace;
  }

  private removeFullFuildHandler() {
    this.statusBarItem.command = "";
  }

  private setProgressHandler() {
    this.client.onProgress(WorkDoneProgress.type, EXPRESSSUITE_TOKEN, (params) => {
      switch (params.kind) {
        case "begin":
          this.statusBarItem.show();
          this.statusBarItem.text = `$(sync~spin) EXPRESSsuite loading`;
          break;
        case "report":
          this.statusBarItem.show();
          this.statusBarItem.text = `$(sync~spin) EXPRESSsuite building`;

          this.statusBarItem.tooltip = `${params.message}`;

          break;
        case "end":
          // The status bar carries the state; no popup. A toast here fired at
          // startup, after every save and after the Build command.
          this.statusBarItem.show();
          this.statusBarItem.text = "$(check) EXPRESSsuite ready";
          this.statusBarItem.tooltip = "EXPRESSsuite has finished building your workspace";
          clearTimeout(this.readyTimer);
          this.readyTimer = setTimeout(() => this.setFullBuildHander(), 3000);
          break;
      }
    });
  }

  public dispose(): void {
    clearTimeout(this.readyTimer);
    this.statusBarItem.hide();
    this.statusBarItem.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    this.excludedItem.dispose();
  }
}
