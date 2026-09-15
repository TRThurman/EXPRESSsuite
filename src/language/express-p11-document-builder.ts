import {
  BuildOptions,
  DefaultDocumentBuilder,
  DocumentState,
  LangiumDocument,
  ConfigurationProvider,
  interruptAndCheck,
  URI,
  stream,
} from "langium";
import type { LangiumSharedServices } from "langium/lsp";
import { CancellationToken, Connection, WorkDoneProgress } from "vscode-languageserver";
import { allowedDocuments } from "../utils/file-filter.js";
import { EXPRESSSUITE_TOKEN } from "../shared/notifications.js";
import { EXPRESSSUITE_CONFIGURATION_SECTION } from "../shared/commands.js";
import { Configuration } from "./express-p11-workspace-manager.js";
import { ExpressP11BuildStrategy } from "./express-p11-build-strategy.js";
export class ExpressP11DocumentBuilder extends DefaultDocumentBuilder {
  private isFirstLoad: boolean = true;
  private connection: Connection | undefined;
  private configurationProvider: ConfigurationProvider | undefined;
  private workspaceConfiguration: Configuration = {
    useOptimizedConfiguration: true,
    excludedFiles: [],
    excludedFolders: [],
  };
  constructor(services: LangiumSharedServices) {
    super(services);
    this.connection = services.lsp.Connection;
    this.configurationProvider = services.workspace.ConfigurationProvider;
    this.setupSaveHandler(services);
  }

  protected setupSaveHandler(services: LangiumSharedServices) {
    services.workspace.TextDocuments.onDidSave((save) => {
      services.workspace.WorkspaceLock.write((token) => this.saveDocuments([URI.parse(save.document.uri)], token));
    });
  }

  public async runFullBuild(cancelToken: CancellationToken = CancellationToken.None): Promise<void> {
    const allDocuments = this.langiumDocuments.all.toArray().map((doc) => doc.uri);
    await this.update(allDocuments, [], cancelToken, ExpressP11BuildStrategy.FullBuild);
  }

  private async saveDocuments(saved: URI[], cancelToken: CancellationToken = CancellationToken.None): Promise<void> {
    await this.update(saved, [], cancelToken, ExpressP11BuildStrategy.PartialBuildAfterSave);
  }

  public override async update(
    changed: URI[],
    deleted: URI[],
    cancelToken = CancellationToken.None,
    strategy: ExpressP11BuildStrategy = ExpressP11BuildStrategy.PartialBuildDuringEdition
  ): Promise<void> {
    // Remove all metadata of documents that are reported as deleted
    for (const deletedUri of deleted) {
      this.langiumDocuments.deleteDocument(deletedUri);
      this.buildState.delete(deletedUri.toString());
      this.indexManager.remove(deletedUri);
    }
    // Set the state of all changed documents to `Changed` so they are completely rebuilt
    for (const changedUri of changed) {
      const invalidated = this.langiumDocuments.invalidateDocument(changedUri);
      if (!invalidated) {
        await this.langiumDocuments.getOrCreateDocument(changedUri);
      }
      this.buildState.delete(changedUri.toString());
    }
    if (this.isFirstLoad || strategy !== ExpressP11BuildStrategy.PartialBuildDuringEdition) {
      // Set the state of all documents that should be relinked to `ComputedScopes` (if not already lower)
      const allChangedUris = stream(changed)
        .concat(deleted)
        .map((uri) => uri.toString())
        .toSet();
      this.langiumDocuments.all
        .filter((doc) => !allChangedUris.has(doc.uri.toString()) && this.shouldRelink(doc, allChangedUris))
        .forEach((doc) => {
          const linker = this.serviceRegistry.getServices(doc.uri).references.Linker;
          linker.unlink(doc);
          doc.state = Math.min(doc.state, DocumentState.ComputedScopes);
          doc.diagnostics = undefined;
        });
    }
    // Notify listeners of the update
    await this.emitUpdate(changed, deleted);
    // Only allow interrupting the execution after all state changes are done
    await interruptAndCheck(cancelToken);

    // Collect all documents that we should rebuild
    const rebuildDocuments = this.langiumDocuments.all
      .filter(
        (doc) =>
          // This includes those that were reported as changed and those that we selected for relinking
          doc.state < DocumentState.Linked ||
          // This includes those for which a previous build has been cancelled
          !this.buildState.get(doc.uri.toString())?.completed
      )
      .toArray();
    await this.buildDocuments(rebuildDocuments, this.updateBuildOptions, cancelToken, strategy);
  }

  private async executeBuildDocuments(
    validDocs: LangiumDocument[],
    options: BuildOptions,
    cancelToken: CancellationToken,
    buildStrategy: ExpressP11BuildStrategy = ExpressP11BuildStrategy.PartialBuildDuringEdition
  ): Promise<void> {
    this.prepareBuild(validDocs, options);
    // 0. Parse content
    // console.time("Total");

    // const needParsing = validDocs.filter((e) => e.state < DocumentState.Parsed);

    // console.log(`${needParsing.length} documents need parsing.`);
    await this.runCancelable(validDocs, DocumentState.Parsed, cancelToken, (doc) => {
      return this.langiumDocumentFactory.update(doc, cancelToken);
    });
    // console.log(`${validDocs.filter((e) => e.state === DocumentState.ComputedScopes).length} will need linking`);
    // 1. Index content
    // console.time("Indexing");
    // const needIndexing = validDocs.filter((e) => e.state < DocumentState.IndexedContent);
    // console.log(`${needIndexing.length} documents need indexing.`);
    // console.log("1");
    await this.runCancelable(validDocs, DocumentState.IndexedContent, cancelToken, async (doc) => {
      await this.indexManager.updateContent(doc, cancelToken);
    });
    // console.timeEnd("Indexing");

    // 2. Compute scopes
    // console.time("Computing");
    // const needComputing = documents.filter((e) => e.state < DocumentState.ComputedScopes);
    // console.log(`${needComputing.length} documents need computing.`);
    await this.runCancelable(validDocs, DocumentState.ComputedScopes, cancelToken, async (doc) => {
      const scopeComputation = this.serviceRegistry.getServices(doc.uri).references.ScopeComputation;
      doc.localSymbols = await scopeComputation.collectLocalSymbols(doc, cancelToken);
    });
    // console.timeEnd("Computing");

    // console.time("Linking");
    const documentsToLink = validDocs.filter((e) => e.state < DocumentState.Linked).length;
    // console.log(`${documentsToLink} documents need linking.`);
    let linked = 0;
    // console.profile();
    // 3. Linking
    await this.runCancelable(validDocs, DocumentState.Linked, cancelToken, async (doc) => {
      linked += 1;
      if (this.isFirstLoad || buildStrategy != ExpressP11BuildStrategy.PartialBuildDuringEdition)
        this.connection?.sendProgress(WorkDoneProgress.type, EXPRESSSUITE_TOKEN, {
          kind: "report",
          message: `EXPRESSsuite processing file ${linked} of ${documentsToLink}`,
        });

      const linker = this.serviceRegistry.getServices(doc.uri).references.Linker; //.link(doc, cancelToken);
      //   console.timeEnd(filename);
      return linker.link(doc, cancelToken);
    });
    // console.profileEnd();
    // console.timeEnd("Linking");

    // 4. Index references
    // console.time("Indexing2");
    await this.runCancelable(validDocs, DocumentState.IndexedReferences, cancelToken, (doc) =>
      this.indexManager.updateReferences(doc, cancelToken)
    );
    // console.timeEnd("Indexing2");

    // 5. Validation
    const toBeValidated = validDocs.filter((doc) => this.shouldValidate(doc));
    await this.runCancelable(toBeValidated, DocumentState.Validated, cancelToken, (doc) => this.validate(doc, cancelToken));

    // console.timeEnd("Total");

    for (const doc of validDocs) {
      const state = this.buildState.get(doc.uri.toString());
      if (state) {
        state.completed = true;
      }
    }
  }

  private async refreshConfiguration(): Promise<void> {
    if (!this.connection) {
      // No LSP connection (e.g. tests, CLI) -- use defaults
      return;
    }
    const useOptimizedConfiguration = await this.configurationProvider?.getConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION, "useOptimizedConfiguration");
    const excludedFolders = await this.configurationProvider?.getConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION, "excludedFolders");
    const excludedFiles = await this.configurationProvider?.getConfiguration(EXPRESSSUITE_CONFIGURATION_SECTION, "excludedFiles");
    this.workspaceConfiguration = { useOptimizedConfiguration, excludedFiles, excludedFolders };
  }
  protected override async buildDocuments(
    documents: LangiumDocument[],
    options: BuildOptions,
    cancelToken: CancellationToken,
    buildStrategy: ExpressP11BuildStrategy = ExpressP11BuildStrategy.PartialBuildDuringEdition
  ): Promise<void> {
    try {
      await this.refreshConfiguration();
      if (buildStrategy != ExpressP11BuildStrategy.PartialBuildDuringEdition) {
        this.connection?.sendProgress(WorkDoneProgress.type, EXPRESSSUITE_TOKEN, {
          kind: "begin",
          title: "initiated",
        });
      }
      const validDocs = allowedDocuments(documents, this.workspaceConfiguration);

      //   if (this.isFirstLoad || fullBuildRequired) {
      await this.executeBuildDocuments(validDocs, options, cancelToken, buildStrategy);
      //   } else {
      //     const documentsModified = validDocs.filter((d) => d.state < DocumentState.Parsed);
      //     await this.executeBuildDocuments(documentsModified, options, cancelToken);
      //   }

      await interruptAndCheck(cancelToken);
      if (buildStrategy != ExpressP11BuildStrategy.PartialBuildDuringEdition) {
        this.connection?.sendProgress(WorkDoneProgress.type, EXPRESSSUITE_TOKEN, { kind: "end" });
      }
      // The workspace manager's initial build uses the default (editing)
      // strategy. Mark it complete after the first successful pass so the first
      // editor request does not unnecessarily relink the entire workspace.
      this.isFirstLoad = false;
    } catch { /* build errors are handled per-document */ }
  }
}
