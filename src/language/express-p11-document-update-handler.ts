import { DefaultDocumentUpdateHandler } from "langium/lsp";
import type { LangiumSharedServices } from "langium/lsp";
import type { TextDocument } from "langium";
import type { TextDocumentChangeEvent } from "vscode-languageserver";
import { ExpressP11WorkspaceManager } from "./express-p11-workspace-manager.js";

export class ExpressP11DocumentUpdateHandler extends DefaultDocumentUpdateHandler {
  private readonly expressWorkspaceManager: ExpressP11WorkspaceManager;

  constructor(services: LangiumSharedServices) {
    super(services);
    this.expressWorkspaceManager = services.workspace.WorkspaceManager as ExpressP11WorkspaceManager;
  }

  override didChangeContent(change: TextDocumentChangeEvent<TextDocument>): void {
    // didChangeContent also fires when an editor is first opened. Fold those
    // notifications into the manager's post-index refresh instead of queuing a
    // second rebuild immediately after startup.
    if (this.expressWorkspaceManager.queueStartupDocumentChange(change.document.uri)) {
      return;
    }
    super.didChangeContent(change);
  }
}
