import { LanguageClient, WorkDoneProgress } from "vscode-languageclient/node.js";
import * as vscode from "vscode";

import { EASYEXPRESS_TOKEN } from "../shared/notifications.js";

export class ExpressP11StatusBarItem {
  private statusBarItem: vscode.StatusBarItem;
  constructor(private client: LanguageClient) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.setProgressHandler();
  }

  private setFullBuildHander() {
    this.statusBarItem.text = "$(play) Build";
    this.statusBarItem.tooltip = "Build your EXPRESS workspace";
    this.statusBarItem.command = "express.buildWorkspace";
  }

  private removeFullFuildHandler() {
    this.statusBarItem.command = "";
  }

  private setProgressHandler() {
    this.client.onProgress(WorkDoneProgress.type, EASYEXPRESS_TOKEN, (params) => {
      switch (params.kind) {
        case "begin":
          this.statusBarItem.show();
          this.statusBarItem.text = `$(sync~spin) easyEXPRESS loading`;
          break;
        case "report":
          this.statusBarItem.show();
          this.statusBarItem.text = `$(sync~spin) easyEXPRESS building`;

          this.statusBarItem.tooltip = `${params.message}`;

          break;
        case "end":
          vscode.window.showInformationMessage("easyEXPRESS has finished loading your workspace.");
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
