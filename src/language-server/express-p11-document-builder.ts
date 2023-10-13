import { BuildOptions, DefaultDocumentBuilder, DocumentState, LangiumDocument, LangiumSharedServices } from "langium";
import { CancellationToken } from "vscode-languageserver";
import { ExpressP11Services } from "./express-p11-module";

export class ExpressP11DocumentBuilder extends DefaultDocumentBuilder {
  constructor(services: LangiumSharedServices) {
    super(services);
  }

  protected override async buildDocuments(
    documents: LangiumDocument[],
    options: BuildOptions,
    cancelToken: CancellationToken
  ): Promise<void> {
    // 0. Parse content
    //  parsing is done initially for each document, but
    //  re-parsing after changes reported by the client might have been canceled by subsequent changes, so re-parse now
    console.time("Total");
    console.time("Parsing");
    // const needParsing = documents.filter((e) => e.state < DocumentState.Parsed);
    // console.log(`${needParsing.length} documents need parsing.`);
    await this.runCancelable(documents, DocumentState.Parsed, cancelToken, (doc) =>
      this.langiumDocumentFactory.update(doc)
    );
    console.timeEnd("Parsing");
    // console.log(`${documents.filter((e) => e.state === DocumentState.ComputedScopes).length} will need linking`);
    // 1. Index content
    console.time("Indexing");
    // const needIndexing = documents.filter((e) => e.state < DocumentState.IndexedContent);
    // console.log(`${needIndexing.length} documents need indexing.`);
    // console.log("1");
    await this.runCancelable(documents, DocumentState.IndexedContent, cancelToken, (doc) =>
      this.indexManager.updateContent(doc, cancelToken)
    );
    console.timeEnd("Indexing");

    // 2. Compute scopes
    console.time("Computing");
    // const needComputing = documents.filter((e) => e.state < DocumentState.ComputedScopes);
    // console.log(`${needComputing.length} documents need computing.`);
    await this.runCancelable(documents, DocumentState.ComputedScopes, cancelToken, async (doc) => {
      await this.computeScopes(doc, cancelToken);
    });
    console.timeEnd("Computing");

    console.time("Linking");
    // const needLinking = documents.filter((e) => e.state < DocumentState.Linked);
    // console.log(`${needLinking.length} documents need linking.`);
    // console.profile();
    // 3. Linking
    await this.runCancelable(documents, DocumentState.Linked, cancelToken, async (doc) => {
      //const filename = doc.uri.toString().split("/").pop();
      //console.time(filename);

      await this.serviceRegistry.getServices(doc.uri).references.Linker.link(doc, cancelToken);
      //console.timeEnd(filename);
    });
    // console.profileEnd();
    console.timeEnd("Linking");
    // 4. Index references
    console.time("Indexing2");

    await this.runCancelable(documents, DocumentState.IndexedReferences, cancelToken, (doc) =>
      this.indexManager.updateReferences(doc, cancelToken)
    );
    console.timeEnd("Indexing2");

    // 5. Validation
    console.time("Validation");

    const validateDocs = documents.filter((doc) => this.shouldValidate(doc, options));
    // console.log(validateDocs.length);
    await this.runCancelable(validateDocs, DocumentState.Validated, cancelToken, (doc) =>
      this.validate(doc, cancelToken)
    );
    console.timeEnd("Validation");
    console.timeEnd("Total");

    (this.serviceRegistry.getServices(documents[0].uri) as ExpressP11Services).caching.CustomCache.logFinal();
  }
}
