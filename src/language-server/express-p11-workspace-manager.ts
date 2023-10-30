import {
  ConfigurationProvider,
  DefaultConfigurationProvider,
  DefaultWorkspaceManager,
  LangiumDocument,
  LangiumSharedServices,
  interruptAndCheck,
} from "langium";
import { CancellationToken, Connection, WorkDoneProgress, WorkspaceFolder } from "vscode-languageserver";
import { URI } from "vscode-uri";
import { isAllowedFile, isAllowedFolder } from "../utils/file-filter";
import { EASYEXPRESS_TOKEN } from "../shared/notifications";

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
    const useOptimizedConfiguration = await this.configurationProvider?.getConfiguration(
      "express-p-11",
      "useOptimizedConfiguration"
    );
    const excludedFolders = await this.configurationProvider?.getConfiguration("express-p-11", "excludedFolders");
    const excludedFiles = await this.configurationProvider?.getConfiguration("express-p-11", "excludedFiles");
    this.workspaceConfiguration = { useOptimizedConfiguration, excludedFiles, excludedFolders };
    await super.initializeWorkspace(folders, cancelToken);
  }
  protected override async traverseFolder(
    workspaceFolder: WorkspaceFolder,
    folderPath: URI,
    fileExtensions: string[],
    collector: (document: LangiumDocument) => void
  ): Promise<void> {
    const content = await this.fileSystemProvider.readDirectory(folderPath);
    await Promise.all(
      content.map(async (entry) => {
        if (this.includeEntry(workspaceFolder, entry, fileExtensions)) {
          if (entry.isDirectory) {
            await this.traverseFolder(workspaceFolder, entry.uri, fileExtensions, collector);
          } else if (entry.isFile) {
            if (isAllowedFile(entry.uri, this.workspaceConfiguration)) {
              const document = this.langiumDocuments.getOrCreateDocument(entry.uri);
              collector(document);
            }
          }
        }
      })
    );
  }
}
