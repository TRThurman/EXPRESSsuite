// import { BuildOptions, DefaultDocumentBuilder, DocumentState, LangiumDocument, LangiumSharedServices } from "langium";
// import { ExpressP11Services } from "./express-p-11-module";
// import { CancellationToken } from "vscode-languageserver";
// import { ExpressFile, isExpressFile } from "./generated/ast";

// export class ExpressP11DocumentBuilder extends DefaultDocumentBuilder {
//   constructor(services: LangiumSharedServices) {
//     super(services);
//   }

//   protected override async buildDocuments(
//     documents: LangiumDocument[],
//     options: BuildOptions,
//     cancelToken: CancellationToken
//   ): Promise<void> {
//     // 0. Parse content
//     //  parsing is done initially for each document, but
//     //  re-parsing after changes reported by the client might have been canceled by subsequent changes, so re-parse now
//     await this.runCancelable(documents, DocumentState.Parsed, cancelToken, (doc) =>
//       this.langiumDocumentFactory.update(doc)
//     );
//     // 1. Index content
//     await this.runCancelable(documents, DocumentState.IndexedContent, cancelToken, (doc) =>
//       this.indexManager.updateContent(doc, cancelToken)
//     );
//     // 2. Compute scopes
//     await this.runCancelable(documents, DocumentState.ComputedScopes, cancelToken, (doc) =>
//       this.computeScopes(doc, cancelToken)
//     );
//     // 3. Linking
//     await this.runCancelable(documents, DocumentState.Linked, cancelToken, (doc) =>
//       this.serviceRegistry.getServices(doc.uri).references.Linker.link(doc, cancelToken)
//     );
//     // 4. Index references
//     await this.runCancelable(documents, DocumentState.IndexedReferences, cancelToken, (doc) => {
//       this.indexManager.updateReferences(doc, cancelToken);
//     });

//     // 5. Run resource manager
//     try {
//       const expressDocuments = documents.filter((d) => isExpressFile(d.parseResult.value));
//       if (expressDocuments.length > 0) {
//         console.log(`CUSTOM BUILDER with ${expressDocuments.length} vs ${documents.length}`);
//         const manager = (this.serviceRegistry.getServices(expressDocuments[0].uri) as ExpressP11Services).resources
//           .ResourceManager;
//         //manager.reset();
//         expressDocuments.forEach((d) => manager.loadDocument(d as LangiumDocument<ExpressFile>));
//         expressDocuments.forEach((d) => manager.loadImportedResources(d as LangiumDocument<ExpressFile>));
//       }
//     } catch (e) {
//       console.log(`ERROR in builder`);
//     }

//     //this.resourceManager.loadImportedResources();
//     // 5. Validation
//     const validateDocs = documents.filter((doc) => this.shouldValidate(doc, options));
//     await this.runCancelable(validateDocs, DocumentState.Validated, cancelToken, (doc) =>
//       this.validate(doc, cancelToken)
//     );
//   }
// }
