import {
  BuildOptions,
  ConfigurationProvider,
  DefaultDocumentBuilder,
  DocumentState,
  LangiumDocument,
  LangiumSharedServices,
  interruptAndCheck,
} from "langium";
import { CancellationToken, Connection, ProtocolNotificationType0, WorkDoneProgress } from "vscode-languageserver";
import { ExpressP11Services } from "./express-p11-module";
import { allowedDocuments } from "../utils/file-filter";
import { EASYEXPRESS_TOKEN } from "../shared/notifications";
import { Configuration } from "./express-p11-workspace-manager";
export class ExpressP11DocumentBuilder extends DefaultDocumentBuilder {
  private timeout: NodeJS.Timeout | undefined;
  private isFirstLoad: boolean = true;
  private firstIndexingInitiated: boolean = false;
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
  }

  private async executeBuildDocuments(
    documents: LangiumDocument[],
    options: BuildOptions,
    cancelToken: CancellationToken
  ): Promise<void> {
    const validDocs = allowedDocuments(documents, this.workspaceConfiguration);
    // 0. Parse content
    //  parsing is done initially for each document, but
    //  re-parsing after changes reported by the client might have been canceled by subsequent changes, so re-parse now
    // console.time("Total");
    // console.log(`${validDocs.length} to parse`);
    // console.time("Parsing");
    // const needParsing = documents.filter((e) => e.state < DocumentState.Parsed);
    // console.log(`${needParsing.length} documents need parsing.`);
    await this.runCancelable(validDocs, DocumentState.Parsed, cancelToken, (doc) =>
      this.langiumDocumentFactory.update(doc)
    );
    // console.timeEnd("Parsing");
    // console.log(`${documents.filter((e) => e.state === DocumentState.ComputedScopes).length} will need linking`);
    // 1. Index content
    // console.time("Indexing");
    const needIndexing = validDocs.filter((e) => e.state < DocumentState.IndexedContent);
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
      await this.computeScopes(doc, cancelToken);
    });
    // console.timeEnd("Computing");

    // console.time("Linking");
    const documentsToLink = validDocs.filter((e) => e.state < DocumentState.Linked).length;
    // console.log(`${needLinking} documents need linking.`);
    let linked = 0;
    // console.profile();
    // 3. Linking
    await this.runCancelable(validDocs, DocumentState.Linked, cancelToken, async (doc) => {
      //   const filename = doc.uri.toString(); //.split("/").pop();
      //   console.time(filename);
      linked += 1;
      if (this.isFirstLoad)
        this.connection?.sendProgress(WorkDoneProgress.type, EASYEXPRESS_TOKEN, {
          kind: "report",
          message: `$(sync) easyEXPRESS processing file ${linked} of ${documentsToLink}`,
        });

      await this.serviceRegistry.getServices(doc.uri).references.Linker.link(doc, cancelToken);
      //   console.timeEnd(filename);
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
    // console.time("Validation");

    const validateDocs = validDocs.filter((doc) => this.shouldValidate(doc, options));
    // console.log(validateDocs.length);
    await this.runCancelable(validateDocs, DocumentState.Validated, cancelToken, (doc) =>
      this.validate(doc, cancelToken)
    );
    // console.timeEnd("Validation");
    // console.timeEnd("Total");

    //(this.serviceRegistry.getServices(documents[0].uri) as ExpressP11Services).caching.CustomCache.logFinal();
  }
  protected override async buildDocuments(
    documents: LangiumDocument[],
    options: BuildOptions,
    cancelToken: CancellationToken
  ): Promise<void> {
    try {
      const useOptimizedConfiguration = await this.configurationProvider?.getConfiguration(
        "express-p-11",
        "useOptimizedConfiguration"
      );
      const excludedFolders = await this.configurationProvider?.getConfiguration("express-p-11", "excludedFolders");
      const excludedFiles = await this.configurationProvider?.getConfiguration("express-p-11", "excludedFiles");
      this.workspaceConfiguration = { useOptimizedConfiguration, excludedFiles, excludedFolders };
      if (this.isFirstLoad && !this.firstIndexingInitiated) {
        this.connection?.sendProgress(WorkDoneProgress.type, EASYEXPRESS_TOKEN, {
          kind: "begin",
          title: "initiated",
        });
        this.firstIndexingInitiated = true;
      }
      await this.executeBuildDocuments(documents, options, cancelToken);
      await interruptAndCheck(cancelToken);
      if (this.isFirstLoad && this.firstIndexingInitiated) {
        this.connection?.sendProgress(WorkDoneProgress.type, EASYEXPRESS_TOKEN, { kind: "end" });

        this.isFirstLoad = false;
        this.firstIndexingInitiated = false;
      }
    } catch (e) {}
  }
}
