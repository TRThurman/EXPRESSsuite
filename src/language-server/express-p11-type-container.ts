import {
  AstNode,
  DocumentState,
  LangiumDocuments,
  MultiMap,
  getContainerOfType,
  interruptAndCheck,
  stream,
  streamAllContents,
  streamContents,
} from "langium";
import { ExpressP11SharedServices } from "./express-p11-module";
import {
  Attribute_decl,
  EntityDefinition,
  Explicit_attr,
  ExpressFile,
  isAttribute_decl,
  isAttribute_id,
  isDerived_attr,
  isEntityDefinition,
  isExplicit_attr,
  isExpressFile,
  isGeneral_aggregation_types,
  isGeneralized_types,
  isInverse_attr,
  isNamedType,
  isNamed_types,
  isRedeclared_attribute,
  isReference_clause,
  isSchemaDefinition,
  isUse_clause,
} from "./generated/ast";
import { CancellationToken } from "vscode-languageserver";

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
  protected readonly langiumDocuments: LangiumDocuments;
  protected localTypes = new MultiMap<string, ConcreteType>();
  protected readonly memoizedSupertypesCall = new Map<string, EntityDefinition[]>();
  protected readonly memoizedSubtypesCall = new Map<string, EntityDefinition[]>();
  protected readonly memoizedAttributesCall = new Map<string, Attribute_decl[]>();

  constructor(services: ExpressP11SharedServices) {
    this.langiumDocuments = services.workspace.LangiumDocuments;
    services.workspace.DocumentBuilder.onBuildPhase(DocumentState.ComputedScopes, (_, cancelToken) =>
      this.build(cancelToken)
    );
  }
  protected async build(cancelToken: CancellationToken): Promise<void> {
    this.localTypes.clear();
    this.memoizedSupertypesCall.clear();
    const sink: ExpressSink = {
      imports: new MultiMap<string, SubSuperTypeDefinition>(),
      localTypes: new MultiMap<string, ConcreteType>(),
    };

    for (const document of this.langiumDocuments.all) {
      await interruptAndCheck(cancelToken);
      const value = document.parseResult.value;
      if (isExpressFile(value)) {
        await this.extractEntities(value, sink, cancelToken);
      }
    }
    for (const document of this.langiumDocuments.all) {
      await interruptAndCheck(cancelToken);
      const value = document.parseResult.value;
      if (isExpressFile(value)) {
        await this.resolveSpecifications(value, sink, cancelToken);
      }
    }
    for (const document of this.langiumDocuments.all) {
      await interruptAndCheck(cancelToken);
      const value = document.parseResult.value;
      if (isExpressFile(value)) {
        await this.resolveSuperTypes(value, sink, cancelToken);
      }
    }

    await this.resolveSubTypes(cancelToken);
  }

  protected async resolveSuperTypes(
    file: ExpressFile,
    sink: ExpressSink,
    cancelToken: CancellationToken
  ): Promise<void> {
    for (const schema of file.schemas) {
      await interruptAndCheck(cancelToken);
      const localTypes = sink.localTypes.get(schema.name);
      const imports = sink.imports.get(schema.name);
      for (const eType of localTypes) {
        await interruptAndCheck(cancelToken);
        if (this.hasSuperTypes(eType.node)) {
          for (const supertype of eType.node.types.supertypes?.entities!) {
            const supertypeName = supertype.entity.$refText;
            let supertypeObject = localTypes.find((t) => t.name === supertypeName);
            let source: string | undefined = undefined;
            if (supertypeObject) {
              source = schema.name;
            }
            if (!supertypeObject) {
              const importedObject = imports.find((i) => i.name === supertypeName);
              if (importedObject) source = importedObject.schema;
            }
            if (!source) continue;

            eType.supertypes.push({
              name: supertypeName,
              schema: source,
            });
          }
        }
        this.localTypes.add(schema.name, eType);
      }
    }
  }

  protected async resolveSubTypes(cancelToken: CancellationToken): Promise<void> {
    const tempoSubTypes = new MultiMap<string, SubSuperTypeDefinition>();
    const tempSystem = new MultiMap<string, ConcreteType>();
    for (const schema of this.localTypes.keys()) {
      await interruptAndCheck(cancelToken);
      for (const eType of this.localTypes.get(schema)) {
        const subtypeDefinition = this.getDefinition(eType, schema);
        for (const supertype of eType.supertypes) {
          this.addSubType(subtypeDefinition, supertype);
        }
      }
    }
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
  protected async resolveSpecifications(
    file: ExpressFile,
    sink: ExpressSink,
    cancelToken: CancellationToken
  ): Promise<void> {
    for (const schema of file.schemas) {
      await interruptAndCheck(cancelToken);

      for (const specification of schema.body.specifications) {
        await interruptAndCheck(cancelToken);

        if (isReference_clause(specification)) {
          if (specification.resources.length < 1) {
            //import all from schema
            const imports: SubSuperTypeDefinition[] = [];
            sink.localTypes.get(specification.schema.$refText).forEach((t) => {
              imports.push({ name: t.name, schema: specification.schema.$refText });
            });
            sink.imports.addAll(schema.name, imports);
          }
          if (specification.resources.length >= 1) {
            for (const resource of specification.resources) {
              const imp0rt = sink.localTypes
                .get(specification.schema.$refText)
                .find((t) => t.name === resource.resource.$refText);
              if (imp0rt) sink.imports.add(schema.name, { name: imp0rt.name, schema: specification.schema.$refText });
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
          }
          if (specification.resources.length >= 1) {
            for (const resource of specification.resources) {
              const imp0rt = sink.localTypes
                .get(specification.schema.$refText)
                .find((t) => t.name === resource.resource.$refText);
              if (imp0rt) sink.imports.add(schema.name, { name: imp0rt.name, schema: specification.schema.$refText });
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
    for (const schema of file.schemas) {
      await interruptAndCheck(cancelToken);
      const temporaryTypes: ConcreteType[] = [];
      for (const decl of schema.body.declarations) {
        if (isEntityDefinition(decl)) {
          const concreteType: ConcreteType = { name: decl.name, subtypes: [], supertypes: [], local: true, node: decl };
          temporaryTypes.push(concreteType);
        }
      }
      sink.localTypes.addAll(schema.name, temporaryTypes);
    }
  }

  public getAllAttributes(entity: EntityDefinition): Attribute_decl[] {
    const entityname = entity.name;
    const schemaName = getContainerOfType(entity, isSchemaDefinition)?.name;
    const memoKey = `${entityname}.${schemaName}`;
    const hasBeenComputed = this.memoizedAttributesCall.has(memoKey);
    if (hasBeenComputed) {
      //   console.log(`saved attributes`);
      return this.memoizedAttributesCall.get(memoKey)!;
    }
    if (!entityname || !schemaName) return [];
    const type = this.findType(entityname, schemaName);
    if (!type) return [];
    let attributes: Attribute_decl[] = [];
    attributes = this.getAttributes(type);
    this.memoizedAttributesCall.set(memoKey, attributes);
    return attributes;
  }

  protected getAttributes(type: ConcreteType): Attribute_decl[] {
    const attributes: Attribute_decl[] = [];
    if (!type.node.body) return [];

    for (const elt of streamAllContents(type.node.body)) {
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
      console.log(`Incomplete key ${entity}.${schema}`);
      return [];
    }
    const memoKey = `${schema}.${entity}`;
    const hasBeenComputed = this.memoizedSupertypesCall.has(memoKey);
    if (hasBeenComputed) {
      return this.memoizedSupertypesCall.get(memoKey)!;
    }
    const eType = this.findType(entity, schema);

    if (!eType) {
      console.log(`Couldn't find ${memoKey}.`);

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

  public getSubTypesOf(entity: string, schema: string): EntityDefinition[] {
    if (!entity || !schema) {
      console.log(`Incomplete key ${entity}.${schema}`);
      return [];
    }
    const memoKey = `${schema}.${entity}`;
    const hasBeenComputed = this.memoizedSubtypesCall.has(memoKey);
    if (hasBeenComputed) {
      return this.memoizedSubtypesCall.get(memoKey)!;
    }
    const eType = this.findType(entity, schema);

    if (!eType) {
      console.log(`Couldn't find ${memoKey}.`);

      return [];
    }
    const subtypes: EntityDefinition[] = [];
    for (const subtypeDef of eType.subtypes) {
      const concreteSubtype = this.findType(subtypeDef.name, subtypeDef.schema);
      if (concreteSubtype) {
        subtypes.push(concreteSubtype.node);
        subtypes.push(...this.getSuperTypesOf(subtypeDef.name, subtypeDef.schema));
      }
    }

    this.memoizedSubtypesCall.set(memoKey, subtypes);
    return subtypes;
  }

  public getSuperTypesFromDefinition(entity: EntityDefinition): EntityDefinition[] {
    const schema = getContainerOfType(entity, isSchemaDefinition);
    if (!schema) {
      console.log(`No schema found for ${entity.name}`);
      return [];
    }
    return this.getSuperTypesOf(entity.name, schema.name);
  }

  public getSubTypesFromDefinition(entity: EntityDefinition): EntityDefinition[] {
    const schema = getContainerOfType(entity, isSchemaDefinition);
    if (!schema) {
      console.log(`No schema found for ${entity.name}`);
      return [];
    }
    return this.getSubTypesOf(entity.name, schema.name);
  }

  public getFullSubSuperGraph(entity: EntityDefinition): EntityDefinition[] {
    // const graph: EntityDefinition[] = [];
    const supertypes = this.getSuperTypesFromDefinition(entity);
    //const subtypes = this.getSubTypesFromDefinition(entity);
    // for(const subtype of sub)

    return [...supertypes, entity];
  }
  private findType(entity: string, schema: string): ConcreteType | undefined {
    return this.localTypes.get(schema)?.find((t) => t.name === entity);
  }
  private hasSuperTypes(entity: EntityDefinition): boolean {
    return entity.types?.supertypes?.entities ? true : false;
  }
}
