import {
  ConfigurationProvider,
  DefaultWorkspaceManager,
} from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import type { FileSystemNode } from "langium";
import { CancellationToken, Connection, WorkDoneProgress, WorkspaceFolder } from "vscode-languageserver";
import { isAllowedFile } from "../utils/file-filter.js";
import { EASYEXPRESS_TOKEN } from "../shared/notifications.js";

export type Configuration = {
  useOptimizedConfiguration: boolean;
  excludedFolders: string[];
  excludedFiles: string[];
};
export class ExpressP11WorkspaceManager extends DefaultWorkspaceManager {
  private connection: Connection | undefined;
  private workspaceConfiguration: Configuration = {
    useOptimizedConfiguration: true,
    excludedFiles: [],
    excludedFolders: [],
  };
  private configurationProvider: ConfigurationProvider | undefined;
  constructor(services: LangiumSharedServices) {
    super(services);
    this.connection = services.lsp.Connection;
    this.configurationProvider = services.workspace.ConfigurationProvider;
  }
  override async initializeWorkspace(folders: WorkspaceFolder[], cancelToken = CancellationToken.None): Promise<void> {
    this.connection?.sendProgress(WorkDoneProgress.type, EASYEXPRESS_TOKEN, {
      kind: "report",
      message: "$(sync~spin) easyEXPRESS loading workspace",
    });
    const useOptimizedConfiguration = await this.configurationProvider?.getConfiguration("express", "useOptimizedConfiguration");
    const excludedFolders = await this.configurationProvider?.getConfiguration("express", "excludedFolders");
    const excludedFiles = await this.configurationProvider?.getConfiguration("express", "excludedFiles");
    this.workspaceConfiguration = { useOptimizedConfiguration, excludedFiles, excludedFolders };
    await super.initializeWorkspace(folders, cancelToken);
  }
  override shouldIncludeEntry(entry: FileSystemNode): boolean {
    if (!super.shouldIncludeEntry(entry)) {
      return false;
    }
    if (entry.isFile) {
      return isAllowedFile(entry.uri, this.workspaceConfiguration);
    }
    return true;
  }
}
