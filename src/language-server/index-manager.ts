// import {
//   AstNode,
//   AstNodeDescription,
//   AstReflection,
//   DefaultIndexManager,
//   LangiumDocument,
//   LangiumSharedServices,
// } from "langium";
// import { CancellationToken } from "vscode-languageclient";
// import { getSchemaDeclaration } from "../utils/schema-helpers";
// import { ExpressFile } from "./generated/ast";
// import { getReferenceDeclarations } from "../utils/reference-helpers";

// export class ExpressP11IndexManager extends DefaultIndexManager {
//   //protected readonly reflection: AstReflection;
//   //protected readonly descriptions: AstNodeDescriptionProvider;
//   private readonly resourceManager: resourceManager;
//   constructor(services: LangiumSharedServices) {
//     super(services);

//     //this.reflection = services.shared.AstReflection;
//     //this.descriptions = services.workspace.AstNodeDescriptionProvider;
//   }

// }

// // export class ExpressP11IndexManager extends DefaultIndexManager {
// //   protected readonly importedScopes: Map<string, AstNodeDescription[]> = new Map<string, AstNodeDescription[]>();
// //   //protected readonly reflection: AstReflection;
// //   //protected readonly descriptions: AstNodeDescriptionProvider;

// //   constructor(services: LangiumSharedServices) {
// //     super(services);
// //     //this.reflection = services.shared.AstReflection;
// //     //this.descriptions = services.workspace.AstNodeDescriptionProvider;
// //   }

// //   override async updateReferences(
// //     document: LangiumDocument<AstNode>,
// //     cancelToken?: CancellationToken | undefined
// //   ): Promise<void> {
// //     const services = this.serviceRegistry.getServices(document.uri);
// //     console.log(`${document.uri.toString()} in state ${document.state}`);
// //     const schema = getSchemaDeclaration(document as LangiumDocument<ExpressFile>);
// //     if (!schema) return;
// //     const imports = getReferenceDeclarations(schema);
// //     const importedElements: AstNodeDescription[] = [];
// //     imports.forEach((i) => {
// //       i.resources.forEach((resource) => {
// //         if (!resource.resource.$nodeDescription) return;

// //         if (!resource.isRenamed) {
// //           if (resource.resource.$nodeDescription?.node) importedElements.push(resource.resource.$nodeDescription);
// //         }

// //         if (resource.isRenamed) {
// //           importedElements.push(
// //             services.workspace.AstNodeDescriptionProvider.createDescription(
// //               resource.resource.$nodeDescription?.node!,
// //               resource.name
// //             )
// //           );
// //         }
// //       });
// //     });
// //     console.log(`updates references for ${schema.name} with ${importedElements.length}`);
// //     this.importedScopes.set(schema.name, importedElements);
// //     await super.updateReferences(document, cancelToken);
// //   }

// //   getAllImportOf(reflection: AstReflection, schema: string, referenceType: string): AstNodeDescription[] {
// //     const imports: AstNodeDescription[] = [];

// //     this.importedScopes.get(schema)?.forEach((element) => {
// //       if (reflection.isSubtype(element.type, referenceType)) imports.push(element);
// //     });
// //     return imports;
// //   }
// // }
