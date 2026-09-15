import { LanguageClient, WorkDoneProgress } from "vscode-languageclient/node";
import * as vscode from "vscode";

import { EXPRESSSUITE_TOKEN } from "../shared/notifications.js";
import { EXPRESSSUITE_COMMANDS } from "../shared/commands.js";

export class ExpressP11StatusBarItem {
  private statusBarItem: vscode.StatusBarItem;
  constructor(private client: LanguageClient) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.setProgressHandler();
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
          vscode.window.showInformationMessage("EXPRESSsuite has finished loading your workspace.");
          this.setFullBuildHander();
          break;
      }
    });
  }

  public dispose(): void {
    this.statusBarItem.hide();
    this.statusBarItem.dispose();
  }
}
