import {
  AstNode,
  ConfigurationProvider,
  DocumentState,
  LangiumDocument,
  LangiumDocuments,
  MultiMap,
  NameProvider,
  getContainerOfType,
  interruptAndCheck,
  streamAllContents,
} from "langium";
import { ExpressP11Services } from "./express-module.js";
import {
  Attribute_decl,
  Derived_attr,
  EntityDefinition,
  Explicit_attr,
  ExpressFile,
  Inverse_attr,
  isAttribute_decl,
  isEntityDefinition,
  isExpressFile,
  isReference_clause,
  isSchemaDefinition,
  isTypeDefinition,
  isUse_clause,
} from "./generated/ast.js";
import { CancellationToken } from "vscode-languageserver";
import { allowedDocuments } from "../utils/file-filter.js";
import { Configuration } from "./express-p11-workspace-manager.js";
import {
  DefinitionType,
  ExpressConflict,
  ExpressP11ConflictManager,
  ExpressP11Entity,
  ExpressP11OptimizedAttributeList,
  ExpressP11OptimizedResourceList,
  ExpressP11ParameterTypeResolution,
  ExpressP11ParameterTypeResolver,
  ExpressP11Schema,
  ExpressP11TypeFactory,
  InterfaceType,
} from "./express-p11-type-utilities.js";
import { ExpressP11MemoPool } from "./express-p11-memo-pool.js";
import { NIL } from "uuid";

type ConcreteType = {
  name: string;
  subtypes: SubSuperTypeDefinition[];
  supertypes: SubSuperTypeDefinition[];
  local: boolean;
  node: EntityDefinition;
  foreignSchema?: string;
};

type ConcreteAttribute = {
  name: string;
  node: Attribute_decl;
  types: SubSuperTypeDefinition[];
  unresolvedType: string;
};

type SubSuperTypeDefinition = {
  name: string;
  schema: string;
};

type ExpressSink = {
  localTypes: MultiMap<string, ConcreteType>;
  imports: MultiMap<string, SubSuperTypeDefinition>;
};

export class ExpressP11TypeContainer {
  protected conflictManager: ExpressP11ConflictManager = new ExpressP11ConflictManager();
  protected memoPool: ExpressP11MemoPool = new ExpressP11MemoPool();
  protected schemas: Map<string, ExpressP11Schema> = new Map();
  protected readonly langiumDocuments: LangiumDocuments;
  protected readonly nameProvider: NameProvider;
  protected localEntities = new MultiMap<string, ConcreteType>();
  protected localPartialUseFrom = new MultiMap<string, SubSuperTypeDefinition>();
  protected localPartialReferenceFrom = new MultiMap<string, SubSuperTypeDefinition>();

  protected localFullUseFrom = new MultiMap<string, string>();
  protected localFullReferenceFrom = new MultiMap<string, string>();

  protected readonly memoizedSupertypesCall = new Map<string, EntityDefinition[]>();
  protected readonly memoizedSubtypesCall = new Map<string, EntityDefinition[]>();
  protected readonly memoizedAllResourcesFromCall = new Map<string, EntityDefinition[]>();
  protected readonly memoizedAllDefinitionsFromCall = new Map<string, SubSuperTypeDefinition[]>();

  protected readonly memoizedAttributesCall = new ExpressP11OptimizedAttributeList();
  protected resolveAttributeTypeCall: number = 0;

  private workspaceConfiguration: Configuration = {
    useOptimizedConfiguration: true,
    excludedFiles: [],
    excludedFolders: [],
  };
  private configurationProvider: ConfigurationProvider | undefined;
  constructor(services: ExpressP11Services) {
    this.langiumDocuments = services.shared.workspace.LangiumDocuments;
    this.nameProvider = services.references.NameProvider;
    services.shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.ComputedScopes, (docs, cancelToken) =>
      this.build(docs, cancelToken)
    );
  }

  public getSchemas(): Map<string, ExpressP11Schema> {
    return this.schemas;
  }

  public getConflicts(): ExpressConflict[] {
    return this.conflictManager.getConflicts();
  }
  protected async build(documents: LangiumDocument[], cancelToken: CancellationToken): Promise<void> {
    this.reset();
    await this.configureWorkspace();
    const sink: ExpressSink = {
      imports: new MultiMap<string, SubSuperTypeDefinition>(),
      localTypes: new MultiMap<string, ConcreteType>(),
    };
    const validDocs = allowedDocuments(this.langiumDocuments.all.toArray(), this.workspaceConfiguration);

    await this.loadSchemas(validDocs, cancelToken, sink);

    for (const document of validDocs) {
      await interruptAndCheck(cancelToken);
      const value = document.parseResult.value;
      if (isExpressFile(value)) {
        await this.resolveSpecifications(value, sink, cancelToken);
      }
    }
    for (const document of validDocs) {
      await interruptAndCheck(cancelToken);
      const value = document.parseResult.value;
      if (isExpressFile(value)) {
        await this.resolveSuperTypes(value, sink, cancelToken);
      }
    }

    await this.resolveSuperTypesV2(cancelToken);

    await this.resolveSubTypes(cancelToken);
  }

  private async loadSchemas(validDocs: LangiumDocument<AstNode>[], cancelToken: CancellationToken, sink: ExpressSink) {
    for (const document of validDocs) {
      await interruptAndCheck(cancelToken);
      const value = document.parseResult.value;
      if (isExpressFile(value)) {
        await this.extractEntities(value, sink, cancelToken);
      }
    }
  }

  private async configureWorkspace() {
    const useOptimizedConfiguration = await this.configurationProvider?.getConfiguration("express", "useOptimizedConfiguration");
    const excludedFolders = await this.configurationProvider?.getConfiguration("express", "excludedFolders");
    const excludedFiles = await this.configurationProvider?.getConfiguration("express", "excludedFiles");
    this.workspaceConfiguration = { useOptimizedConfiguration, excludedFiles, excludedFolders };
  }

  private reset() {
    this.localEntities.clear();
    this.localFullReferenceFrom.clear();
    this.localFullUseFrom.clear();
    this.localPartialReferenceFrom.clear();
    this.localPartialUseFrom.clear();
    this.memoizedSupertypesCall.clear();
    this.memoizedSubtypesCall.clear();
    this.memoizedAllResourcesFromCall.clear();
    this.memoizedAllDefinitionsFromCall.clear();
    this.memoizedAttributesCall.clear();
    this.schemas.clear();
    this.memoPool.reset();
    this.conflictManager.reset();
  }

  protected async resolveSuperTypes(file: ExpressFile, sink: ExpressSink, cancelToken: CancellationToken): Promise<void> {
    if (!file.schemas) return;
    for (const schema of file.schemas) {
      await interruptAndCheck(cancelToken);
      const localTypes = sink.localTypes.get(schema.name);
      const imports = sink.imports.get(schema.name);
      const allAvailable = this.getAllResourceDefinitionFrom(sink, schema.name);
      for (const eType of localTypes) {
        await interruptAndCheck(cancelToken);
        if (this.hasSuperTypes(eType.node)) {
          for (const supertype of eType.node.types.supertypes?.entities!) {
            const supertypeName = supertype.entity.$refText;
            // let supertypeObject = localTypes.find((t) => t.name === supertypeName);
            // let source: string | undefined = undefined;
            // if (supertypeObject) {
            //   source = schema.name;
            // }
            // if (!supertypeObject) {
            //   const importedObject = imports.find((i) => i.name === supertypeName);
            //   if (importedObject) source = importedObject.schema;
            // }
            // if (!source) continue;

            // eType.supertypes.push({
            //   name: supertypeName,
            //   schema: source,
            // });
            const supertypeObject = allAvailable.find((def) => def.name === supertypeName);
            if (supertypeObject) eType.supertypes.push(supertypeObject);
          }
        }
        this.localEntities.add(schema.name, eType);
      }
    }
  }

  protected async resolveSuperTypesV2(cancelToken: CancellationToken): Promise<void> {
    // console.time("v2");

    for (const schema of this.schemas.values()) {
      await interruptAndCheck(cancelToken);
      if (schema.isResolved()) continue;

      const allAvailable = schema.getAllResources(this.memoPool);

      for (const entity of schema.getEntities().values()) {
        if (this.hasSuperTypes(entity.getNode())) {
          for (const supertype of entity.getNode().types.supertypes?.entities!) {
            const supertypeName = supertype.entity.$refText;

            const supertypeDefinition = allAvailable.resources.get(DefinitionType.Entity)?.get(supertypeName);
            if (supertypeDefinition) entity.addSuperType(supertypeDefinition.resource as ExpressP11Entity);
          }
        }
      }

      schema.resolveTypes(this.memoPool);
      schema.markAsResolved();
    }
    // console.timeEnd("v2");
  }

  protected async resolveSubTypes(cancelToken: CancellationToken): Promise<void> {
    const tempoSubTypes = new MultiMap<string, SubSuperTypeDefinition>();
    const tempSystem = new MultiMap<string, ConcreteType>();
    for (const schema of this.localEntities.keys()) {
      await interruptAndCheck(cancelToken);
      for (const eType of this.localEntities.get(schema)) {
        const subtypeDefinition = this.getDefinition(eType, schema);
        for (const supertype of eType.supertypes) {
          this.addSubType(subtypeDefinition, supertype);
        }
      }
    }
  }

  public resolveAttribute(attribute: Explicit_attr | Derived_attr | Inverse_attr): ExpressP11ParameterTypeResolution {
    this.resolveAttributeTypeCall += 1;
    // console.log(`${this.resolveAttributeTypeCall}`);
    return ExpressP11ParameterTypeResolver.resolve(attribute, this.schemas, this.memoPool);
  }

  private getDefinition(type: ConcreteType, schema: string): SubSuperTypeDefinition {
    return { name: type.name, schema };
  }

  private addSubType(subtype: SubSuperTypeDefinition, supertype: SubSuperTypeDefinition): void {
    const concreteSupertype = this.findType(supertype.name, supertype.schema);
    if (!concreteSupertype) return;
    concreteSupertype.subtypes.push(subtype);
  }

  /**
   * We need to store the imported resources (at least their name).
   */
  protected async resolveSpecifications(file: ExpressFile, sink: ExpressSink, cancelToken: CancellationToken): Promise<void> {
    if (!file.schemas) return;
    for (const schema of file.schemas) {
      await interruptAndCheck(cancelToken);
      if (!schema.body) continue;
      const expressSchema = this.schemas.get(schema.name);
      if (!expressSchema) continue;
      for (const specification of schema.body.specifications) {
        await interruptAndCheck(cancelToken);

        const interfacedSchema = this.schemas.get(specification.schema.$refText);
        if (isReference_clause(specification)) {
          if (specification.resources.length < 1) {
            //import all from schema
            const imports: SubSuperTypeDefinition[] = [];
            sink.localTypes.get(specification.schema.$refText).forEach((t) => {
              imports.push({ name: t.name, schema: specification.schema.$refText });
            });
            sink.imports.addAll(schema.name, imports);
            this.localFullReferenceFrom.add(schema.name, specification.schema.$refText);
            //new
            if (interfacedSchema) expressSchema.fullyInterfaceWith(interfacedSchema, InterfaceType.ReferenceFrom);
          }
          if (specification.resources.length >= 1) {
            for (const resource of specification.resources) {
              const imp0rt = sink.localTypes.get(specification.schema.$refText).find((t) => t.name === resource.resource.$refText);
              if (imp0rt) {
                sink.imports.add(schema.name, { name: imp0rt.name, schema: specification.schema.$refText });
                this.localPartialReferenceFrom.add(schema.name, {
                  name: imp0rt.name,
                  schema: specification.schema.$refText,
                });
              }
              //new
              const def = interfacedSchema?.getLocalDefinition(resource.resource.$refText);
              if (def) expressSchema.partiallyInterfaceWith({ interface: InterfaceType.ReferenceFrom, ...def });
            }
          }
        }

        if (isUse_clause(specification)) {
          if (specification.resources.length < 1) {
            //import all from schema
            const imports: SubSuperTypeDefinition[] = [];
            sink.localTypes.get(specification.schema.$refText).forEach((t) => {
              imports.push({ name: t.name, schema: specification.schema.$refText });
            });
            sink.imports.addAll(schema.name, imports);
            this.localFullUseFrom.add(schema.name, specification.schema.$refText);
            //new
            if (interfacedSchema) expressSchema.fullyInterfaceWith(interfacedSchema, InterfaceType.UseFrom);
          }
          if (specification.resources.length >= 1) {
            for (const resource of specification.resources) {
              const imp0rt = sink.localTypes.get(specification.schema.$refText).find((t) => t.name === resource.resource.$refText);
              if (imp0rt) {
                sink.imports.add(schema.name, { name: imp0rt.name, schema: specification.schema.$refText });
                this.localPartialUseFrom.add(schema.name, {
                  name: imp0rt.name,
                  schema: specification.schema.$refText,
                });
              }
              //new
              const def = interfacedSchema?.getLocalDefinition(resource.resource.$refText);
              if (def) expressSchema.partiallyInterfaceWith({ interface: InterfaceType.UseFrom, ...def });
            }
          }
        }
      }
    }
  }

  /**
   * We extract all the entity definitions from the schema
   */
  protected async extractEntities(file: ExpressFile, sink: ExpressSink, cancelToken: CancellationToken): Promise<void> {
    //
    if (!file.schemas) return;
    for (const schema of file.schemas) {
      await interruptAndCheck(cancelToken);
      const temporaryTypes: ConcreteType[] = [];
      if (!schema.body) continue;
      const newSchema = new ExpressP11Schema(schema.name, this.conflictManager);
      for (const decl of schema.body.declarations) {
        if (isEntityDefinition(decl)) {
          newSchema.addEntity(new ExpressP11Entity(decl.name, decl));
          const concreteType: ConcreteType = { name: decl.name, subtypes: [], supertypes: [], local: true, node: decl };
          temporaryTypes.push(concreteType);
        }
        if (isTypeDefinition(decl)) {
          const type = ExpressP11TypeFactory.getType(decl);
          if (type) newSchema.addType(type);
        }
      }
      this.schemas.set(schema.name, newSchema);
      sink.localTypes.addAll(schema.name, temporaryTypes);
      //   this.localTypes.addAll(schema.name, temporaryTypes);
    }
  }

  public getAllAttributes(entity: EntityDefinition, filter: string = ""): Attribute_decl[] {
    const expressEntity = this.getExpressP11EntityFrom(entity);
    if (!expressEntity) return [];

    const memoKey = expressEntity.graphKey;
    const hasBeenComputed = this.memoizedAttributesCall.resources.has(memoKey.toString());
    if (hasBeenComputed && memoKey !== NIL) {
      return this.memoizedAttributesCall.findByName(memoKey.toString(), filter);
    }

    const typeGraph = this.getFullSubSuperGraph(entity);
    for (const e of typeGraph) {
      for (const a of this.getAttributesV2(e)) {
        const attributeName = this.nameProvider.getName(a);
        if (attributeName) this.memoizedAttributesCall.add(expressEntity.graphKey.toString(), attributeName, a);
      }
    }
    //this.getFullSubSuperGraph(entity).forEach((e) => this.getAttributesV2(e).forEach((a) => attributes.push(a)));
    // for (const key of this.getFullSubSuperGraph(entity)) {
    //   const ename = key.name;
    //   const sname = getContainerOfType(key, isSchemaDefinition)?.name;
    //   this.memoizedAttributesCall.set(`${ename}.${sname}`, attributes);
    // }
    //this.memoizedAttributesCall.set(memoKey.toString(), attributes);
    // console.timeEnd(`${memoKey}`);

    // return attributes;
    return this.memoizedAttributesCall.findByName(expressEntity.graphKey.toString(), filter);
  }

  protected getAttributes(type: ConcreteType): Attribute_decl[] {
    const attributes: Attribute_decl[] = [];
    if (!type.node.body) return [];

    for (const elt of streamAllContents(type.node.body)) {
      if (isAttribute_decl(elt)) attributes.push(elt);
    }

    return attributes;
  }
  public getAttributesV2(entity: EntityDefinition): Attribute_decl[] {
    const attributes: Attribute_decl[] = [];
    if (!entity.body) return [];

    for (const elt of streamAllContents(entity.body)) {
      if (isAttribute_decl(elt)) attributes.push(elt);
    }

    return attributes;
  }
  //   protected async extractAttributes(schema: string, type: ConcreteType, cancelToken: CancellationToken): Promise<void> {
  //     for (const elt of streamAllContents(type.node.body)) {
  //       await interruptAndCheck(cancelToken);
  //       if (isAttribute_decl(elt)) {
  //         if (isExplicit_attr(elt.$container) || isDerived_attr(elt.$container) || isInverse_attr(elt.$container)) {
  //           const name = this.getAttributeName(elt);
  //             if (!name) continue;
  //             let unresolvedType: string;
  //             if (isInverse_attr(elt.$container))
  //                 unresolvedType = elt.$container.type.$refText;
  //             else {
  //                 const parameterType = elt.$container.type;
  //                 if (isNamed_types(parameterType)) unresolvedType = parameterType.of.$refText;
  //                 if(isGeneral_aggregation_types(parameterType)) unresolvedType = parameterType.

  //             }
  //           const concreteAttribute: ConcreteAttribute = { node: elt, name, types: [], unresolvedType:elt.$container.type };
  //         }
  //       }
  //     }
  //   }

  public getSuperTypesOf(entity: string, schema: string): EntityDefinition[] {
    if (!entity || !schema) {
      //   console.log(`Incomplete key ${entity}.${schema}`);
      return [];
    }
    const memoKey = `${schema}.${entity}`;
    const hasBeenComputed = this.memoizedSupertypesCall.has(memoKey);
    if (hasBeenComputed) {
      return this.memoizedSupertypesCall.get(memoKey)!;
    }
    const eType = this.findType(entity, schema);

    if (!eType) {
      //   console.log(`Couldn't find ${memoKey}.`);

      return [];
    }
    const supertypes: EntityDefinition[] = [];
    for (const supertypeDef of eType.supertypes) {
      const concreteSupertype = this.findType(supertypeDef.name, supertypeDef.schema);
      if (concreteSupertype) {
        supertypes.push(concreteSupertype.node);
        supertypes.push(...this.getSuperTypesOf(supertypeDef.name, supertypeDef.schema));
      }
    }

    this.memoizedSupertypesCall.set(memoKey, supertypes);
    return supertypes;
  }

  public getSubTypesOf(entity: string, schema: string, traversed: string[] = []): EntityDefinition[] {
    if (!entity || !schema) {
      //   console.log(`Incomplete key ${entity}.${schema}`);
      return [];
    }
    const memoKey = `${schema}.${entity}`;
    if (traversed.includes(memoKey)) return [];
    traversed.push(memoKey);
    const hasBeenComputed = this.memoizedSubtypesCall.has(memoKey);
    if (hasBeenComputed) {
      return this.memoizedSubtypesCall.get(memoKey)!;
    }
    const eType = this.findType(entity, schema);

    if (!eType) {
      //   console.log(`Couldn't find ${memoKey}.`);

      return [];
    }
    const subtypes: EntityDefinition[] = [];
    for (const subtypeDef of eType.subtypes) {
      const concreteSubtype = this.findType(subtypeDef.name, subtypeDef.schema);
      if (concreteSubtype) {
        subtypes.push(concreteSubtype.node);
        subtypes.push(...this.getSubTypesOf(subtypeDef.name, subtypeDef.schema, traversed));
      }
    }

    this.memoizedSubtypesCall.set(memoKey, subtypes);
    return subtypes;
  }

  public getSuperTypesFromDefinition(entity: EntityDefinition): EntityDefinition[] {
    const schema = getContainerOfType(entity, isSchemaDefinition);
    if (!schema) {
      //   console.log(`No schema found for ${entity.name}`);
      return [];
    }
    return (
      this.schemas
        .get(schema.name)
        ?.getEntity(entity.name)
        ?.getSuperTypes(this.memoPool)
        .map((t) => t.getNode()) ?? []
    );
    // return this.getSuperTypesOf(entity.name, schema.name);
  }

  public getSubTypesFromDefinition(entity: EntityDefinition): EntityDefinition[] {
    const schema = getContainerOfType(entity, isSchemaDefinition);
    if (!schema) {
      return [];
    }
    return (
      this.schemas
        .get(schema.name)
        ?.getEntity(entity.name)
        ?.getSubTypes(this.memoPool)
        .map((t) => t.getNode()) ?? []
    );
  }

  public getGraphKey(entity: EntityDefinition): string {
    const expEntity = this.getExpressP11EntityFrom(entity);

    return expEntity ? expEntity.graphKey : NIL;
  }

  public getAllRessourcesFrom(schema: ExpressP11Schema, includeReference: boolean): ExpressP11OptimizedResourceList {
    return schema.getAllResources(this.memoPool, includeReference, []);
  }

  getExpressP11EntityFrom(entity: EntityDefinition): ExpressP11Entity | undefined {
    const schema = getContainerOfType(entity, isSchemaDefinition);
    if (!schema || !schema.name) {
      return;
    }
    const key = `${schema}.${entity.name}`;
    const expressSchema = this.schemas.get(schema!.name);
    if (!expressSchema) return;

    const expEntity = expressSchema.getEntity(entity.name);
    return expEntity;
  }
  public getFullSubSuperGraph(entity: EntityDefinition, filter: string = ""): readonly EntityDefinition[] {
    const expressEntity = this.getExpressP11EntityFrom(entity);

    if (!expressEntity) {
      return [];
    }
    return expressEntity.getSubSuper(this.memoPool, filter);
  }

  public getAllGraphs(): Map<string, MultiMap<string, EntityDefinition>> {
    return this.memoPool.getAllGraphs();
  }
  private findType(entity: string, schema: string): ConcreteType | undefined {
    return this.localEntities.get(schema)?.find((t) => t.name === entity);
  }
  private hasSuperTypes(entity: EntityDefinition): boolean {
    return entity.types?.supertypes?.entities ? true : false;
  }

  public getAllResourcesFrom(schema: string, includeReference: boolean = true, traversed: string[] = []): EntityDefinition[] {
    if (traversed.includes(schema)) return [];
    traversed.push(schema);
    const hasBeenComputed = this.memoizedAllResourcesFromCall.has(schema);
    if (hasBeenComputed) {
      return this.memoizedAllResourcesFromCall.get(schema)!;
    }

    const entitiesInScope: EntityDefinition[] = [];
    for (const e of this.localEntities.get(schema)) {
      entitiesInScope.push(e.node);
    }
    for (const i of this.localPartialUseFrom.get(schema)) {
      const def = this.findType(i.name, i.schema);
      if (!def) continue;
      entitiesInScope.push(def.node);
    }
    if (includeReference) {
      for (const i of this.localPartialReferenceFrom.get(schema)) {
        const def = this.findType(i.name, i.schema);
        if (!def) continue;
        entitiesInScope.push(def.node);
      }
      for (const i of this.localFullReferenceFrom.get(schema)) {
        for (const e of this.localEntities.get(i)) {
          entitiesInScope.push(e.node);
        }
      }
    }

    for (const fullImport of this.localFullUseFrom.get(schema)) {
      const imported = this.getAllResourcesFrom(fullImport, false, traversed);
      for (const e of imported) {
        entitiesInScope.push(e);
      }
    }
    this.memoizedAllResourcesFromCall.set(schema, entitiesInScope);
    return entitiesInScope;
  }
  private getAllResourceDefinitionFrom(
    sink: ExpressSink,
    schema: string,
    includeReference: boolean = true,
    traversed: string[] = []
  ): SubSuperTypeDefinition[] {
    if (traversed.includes(schema)) return [];
    traversed.push(schema);
    // const hasBeenComputed = this.memoizedAllDefinitionsFromCall.has(schema);
    // if (hasBeenComputed) {
    //   return this.memoizedAllDefinitionsFromCall.get(schema)!;
    // }
    const entitiesInScope: SubSuperTypeDefinition[] = [];
    // We add locally defined entities
    for (const e of sink.localTypes.get(schema)) {
      entitiesInScope.push({ name: e.name, schema });
    }
    for (const i of this.localPartialUseFrom.get(schema)) {
      entitiesInScope.push(i);
    }
    if (includeReference) {
      for (const i of this.localPartialReferenceFrom.get(schema)) {
        entitiesInScope.push(i);
      }
      for (const i of this.localFullReferenceFrom.get(schema)) {
        for (const e of sink.localTypes.get(i)) {
          entitiesInScope.push({ schema: i, name: e.name });
        }
      }
    }
    for (const fullImport of this.localFullUseFrom.get(schema)) {
      const imported = this.getAllResourceDefinitionFrom(sink, fullImport, false, traversed);
      for (const e of imported) {
        entitiesInScope.push(e);
      }
    }
    // this.memoizedAllDefinitionsFromCall.set(schema, entitiesInScope);
    return entitiesInScope;
  }
}
