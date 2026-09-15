import {
  ConfigurationProvider,
  Deferred,
  DefaultWorkspaceManager,
  URI,
} from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import type { FileSystemNode } from "langium";
import { CancellationToken, Connection, WorkDoneProgress, WorkspaceFolder } from "vscode-languageserver";
import { isAllowedFile } from "../utils/file-filter.js";
import { EXPRESSSUITE_TOKEN } from "../shared/notifications.js";
import { EXPRESSSUITE_CONFIGURATION_SECTION } from "../shared/commands.js";

export type Configuration = {
  useOptimizedConfiguration: boolean;
  excludedFolders: string[];
  excludedFiles: string[];
};
export class ExpressP11WorkspaceManager extends DefaultWorkspaceManager {
  private readonly fullyReady = new Deferred<void>();
  private connection: Connection | undefined;
  private readonly textDocuments: LangiumSharedServices["workspace"]["TextDocuments"];
  private workspaceConfiguration: Configuration = {
    useOptimizedConfiguration: true,
    excludedFiles: [],
    excludedFolders: [],
  };
  private configurationProvider: ConfigurationProvider | undefined;
  constructor(services: LangiumSharedServices) {
    super(services);
    this.connection = services.lsp.Connection;
    this.textDocuments = services.workspace.TextDocuments;
    this.configurationProvider = services.workspace.ConfigurationProvider;
  }
  override get ready(): Promise<void> {
    return this.fullyReady.promise;
  }
  override async initializeWorkspace(folders: WorkspaceFolder[], cancelToken = CancellationToken.None): Promise<void> {
    this.connection?.sendProgress(WorkDoneProgress.type, EXPRESSSUITE_TOKEN, {
      kind: "begin",
      title: "EXPRESSsuite loading workspace",
    });
    try {
      const useOptimizedConfiguration = await this.configurationProvider?.getConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION, "useOptimizedConfiguration");
      const excludedFolders = await this.configurationProvider?.getConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION, "excludedFolders");
      const excludedFiles = await this.configurationProvider?.getConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION, "excludedFiles");
      this.workspaceConfiguration = { useOptimizedConfiguration, excludedFiles, excludedFolders };
      await super.initializeWorkspace(folders, cancelToken);
      await this.validateOpenDocuments(cancelToken);
      this.fullyReady.resolve();
    } catch (error) {
      this.fullyReady.reject(error);
      throw error;
    } finally {
      this.connection?.sendProgress(WorkDoneProgress.type, EXPRESSSUITE_TOKEN, { kind: "end" });
    }
  }
  private async validateOpenDocuments(cancelToken: CancellationToken): Promise<void> {
    const openDocuments = await Promise.all(
      this.textDocuments.keys().map((uri) => this.langiumDocuments.getOrCreateDocument(URI.parse(uri)))
    );
    if (openDocuments.length > 0) {
      // The initial workspace pass intentionally indexes without validating every
      // file. Validate open editors now so the client receives a fresh diagnostic
      // set as soon as indexing completes, without waiting for a later request
      // such as Peek Definition to touch the document.
      await this.documentBuilder.build(openDocuments, this.documentBuilder.updateBuildOptions, cancelToken);
    }
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
