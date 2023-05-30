// import { AstNode, LangiumDocument, LangiumServices, MultiMap, NameProvider, getDocument } from "langium";
// import {
//   Attribute_decl,
//   Entity_decl,
//   ExpressFile,
//   Function_decl,
//   Reference_clause,
//   Schema_decl,
//   Type_decl,
// } from "../generated/ast";
// import { DocumentSymbol, SymbolKind } from "vscode-languageserver";
// import { ExpressKind } from "../../utils/general";
// import { getReferenceDeclarations } from "../../utils/reference-helpers";

// const removeNulls = <T>(value: T | undefined): value is T => value != null;
// type SchemaName = string;
// type ResourceName = string;

// enum ExpressResourceType {
//   Attribute = "attribute",
//   Entity = "entity",
//   Function = "function",
//   Schema = "schema",
//   Type = "type",
//   Imported = "imported",
// }
// type ExpressResource = {
//   name: ResourceName;
//   node: AstNode;
//   type: ExpressResourceType;
// };
// type ExpressSchema = ExpressResource;
// type ExpressEntity = ExpressResource & {
//   attributes: ExpressAttribute[];
// };
// type ExpressAttribute = ExpressResource;
// type ExpressType = ExpressResource;
// type ExpressFunction = ExpressResource;
// type ImportedExpressResource = ExpressResource & {
//   source: ExpressResource;
//   from: SchemaName;
// };

// export class ExpressP11ResourceManager {
//   private readonly resources = new MultiMap<SchemaName, ExpressResource>();
//   private readonly schemas = new Map<SchemaName, ExpressSchema>();

//   private readonly nameProvider: NameProvider;
//   //private importIndexed: boolean = false;
//   constructor(services: LangiumServices) {
//     this.nameProvider = services.references.NameProvider;
//   }

//   reset() {
//     this.resources.clear();
//     this.schemas.clear();
//   }
//   getImportedResource(schema: SchemaName): ImportedExpressResource[] {
//     return this.resources
//       .get(schema)
//       .filter((r) => r.type === ExpressResourceType.Imported) as ImportedExpressResource[];
//   }
//   getDocumentSymbolTree(document: LangiumDocument<ExpressFile>): DocumentSymbol | undefined {
//     if (!document.parseResult.value.schema.name) return;
//     return this.getSymbols(document.parseResult.value.schema.name);
//   }
//   getSymbols(schema: SchemaName): DocumentSymbol | undefined {
//     const schemaSymbols: DocumentSymbol[] = [];

//     const schemaResource = this.schemas.get(schema);
//     if (!schemaResource) return;

//     let schemaSymbol: DocumentSymbol | undefined = this.getResourceSymbol(schemaResource);
//     if (!schemaSymbol) return;

//     this.resources.get(schema).forEach((resource) => {
//       const symbol = this.getResourceSymbol(resource);
//       if (symbol) schemaSymbols.push(symbol);
//     });
//     schemaSymbol.children = schemaSymbols;
//     return schemaSymbol;
//   }

//   getResourceSymbol(resource: ExpressResource): DocumentSymbol | undefined {
//     if (!resource.node.$cstNode) return;
//     let kind: SymbolKind;
//     let children: DocumentSymbol[] = [];
//     switch (resource.type) {
//       case ExpressResourceType.Attribute:
//         kind = ExpressKind.Property;
//         break;
//       case ExpressResourceType.Entity:
//         kind = ExpressKind.Entity;
//         children = (resource as ExpressEntity).attributes
//           .map((attribute) => this.getResourceSymbol(attribute))
//           .filter(removeNulls);
//         break;
//       case ExpressResourceType.Schema:
//         kind = ExpressKind.Module;
//         break;
//       case ExpressResourceType.Function:
//         kind = ExpressKind.Method;
//         break;
//       case ExpressResourceType.Type:
//         kind = ExpressKind.Type;
//         break;
//       default:
//         return;
//     }
//     let symbol: DocumentSymbol = {
//       kind,
//       name: resource.name,
//       range: resource.node.$cstNode.range,
//       selectionRange: resource.node.$cstNode.range,
//       children,
//     };
//     return symbol;
//   }
//   loadDocument(document: LangiumDocument<ExpressFile>): void {
//     if (!document.parseResult.value.schema) return;
//     const schema = document.parseResult.value.schema;
//     const schemaName = this.nameProvider.getName(schema);
//     if (!schemaName) return;
//     console.log(`loading ${schemaName}`);
//     this.schemas.forEach((value, key) => {
//       console.log(`remove ${getDocument(value.node).uri} and ${document.uri}`);

//       if (getDocument(value.node).uri === document.uri) {
//         this.schemas.delete(key);
//         this.resources.delete(key);
//       }
//     });
//     // this.schemas.delete(schemaName);
//     // this.resources.delete(schemaName);
//     this.schemas.set(schemaName, { name: schemaName, node: schema, type: ExpressResourceType.Schema });
//     schema.body.declarations.forEach((declaration) => {
//       switch (declaration.$type) {
//         case Entity_decl:
//           this.addEntity(declaration as Entity_decl, schemaName);
//           break;
//         case Type_decl:
//           this.addType(declaration as Type_decl, schemaName);
//           break;
//         case Function_decl:
//           this.addFunction(declaration as Function_decl, schemaName);
//           break;
//       }
//     });
//   }

//   addEntity(entity: Entity_decl, schema: SchemaName): void {
//     const expressEntity = this.asExpressEntity(entity);
//     if (expressEntity) this.resources.add(schema, expressEntity);
//   }
//   addType(type: Type_decl, schema: SchemaName): void {
//     const expressType = this.asExpressType(type);
//     if (expressType) this.resources.add(schema, expressType);
//   }
//   addFunction(func: Function_decl, schema: SchemaName): void {
//     const expressFunction = this.asExpressFunction(func);
//     if (expressFunction) this.resources.add(schema, expressFunction);
//   }

//   addReferenceClause(referenceClause: Reference_clause, schema: SchemaName): void {}
//   asExpressEntity(entity: Entity_decl): ExpressEntity | undefined {
//     const entityName = this.nameProvider.getName(entity.head);
//     if (!entityName) return;
//     const attributes: ExpressAttribute[] = [];
//     entity.body?.attributes.forEach((explicitAttribute) => {
//       explicitAttribute.attributes.forEach((attribute) => {
//         const expressAttribute = this.asExpressAttribute(attribute);
//         if (expressAttribute) attributes.push(expressAttribute);
//       });
//     });
//     return { name: entityName, node: entity, attributes, type: ExpressResourceType.Entity };
//   }

//   asExpressAttribute(attribute: Attribute_decl): ExpressAttribute | undefined {
//     const attributeName = this.nameProvider.getName(attribute);
//     if (!attributeName) return;
//     return { name: attributeName, node: attribute, type: ExpressResourceType.Attribute };
//   }

//   asExpressType(type: Type_decl): ExpressType | undefined {
//     const typeName = this.nameProvider.getName(type);
//     if (!typeName) return;
//     return { name: typeName, node: type, type: ExpressResourceType.Type };
//   }

//   asExpressFunction(func: Function_decl): ExpressFunction | undefined {
//     const functionName = this.nameProvider.getName(func.head);
//     if (!functionName) return;
//     return { name: functionName, node: func, type: ExpressResourceType.Function };
//   }

//   loadImportedResources(document: LangiumDocument<ExpressFile>): void {
//     const documentSchema = document.parseResult.value.schema;
//     if (!documentSchema.name) return;
//     const schema = this.schemas.get(documentSchema.name);
//     if (!schema) return;
//     //if (this.importIndexed) return;

//     getReferenceDeclarations(schema.node as Schema_decl).forEach((referenceFrom) => {
//       console.log(`processing import for  ${schema.name}`);

//       referenceFrom.resources.forEach((resourceDeclaration) => {
//         console.log("reached 0");

//         //console.log(resourceDeclaration.resource);
//         if (!resourceDeclaration.resource.ref) return;

//         const originalName = resourceDeclaration.resource.$refText;
//         const resourceName = resourceDeclaration.isRenamed
//           ? resourceDeclaration.name
//           : resourceDeclaration.resource.$refText;
//         const schemaFrom = referenceFrom.schema.$refText;
//         console.log(`${originalName} - ${resourceName} - ${schemaFrom}`);
//         if (!resourceName || !schemaFrom || !originalName) return;
//         console.log("reached");
//         const expressResource = this.resources.get(schemaFrom).find((r) => r.name === originalName);
//         if (!expressResource) return;

//         const importedResource: ImportedExpressResource = {
//           name: resourceName,
//           type: ExpressResourceType.Imported,
//           node: resourceDeclaration.resource.ref,
//           source: expressResource,
//           from: schemaFrom,
//         };
//         console.log(`adding an import for  ${schema.name}`);
//         this.resources.add(schema.name, importedResource);
//         // importedResources.add(referenceFrom.schema.$refText, {
//         //   name: resourceName,
//         //   node: resourceDeclaration.resource.ref,
//         // });
//       });
//     });

//     //this.importIndexed = true;
//   }
// }
