import { AstNode, MultiMap, getContainerOfType } from "langium";
import { ExpressP11MemoPool, MemoQuery, MemoType } from "./express-p11-memo-pool.js";
import {
  Attribute_decl,
  Derived_attr,
  EntityDefinition,
  Enumeration_id,
  Enumeration_type,
  Explicit_attr,
  Inverse_attr,
  Parameter_type,
  Select_type,
  TypeDefinition,
  isDerived_attr,
  isEnumeration_type,
  isExplicit_attr,
  isGeneral_aggregation_types,
  isInverse_attr,
  isNamed_types,
  isSchemaDefinition,
  isSelect_extension,
  isSelect_list,
  isSelect_type,
} from "./generated/ast.js";
import { NIL, v4 as uuidv4 } from "uuid";

export abstract class ExpressResource<T extends AstNode> {
  protected owner: ExpressP11Schema | undefined;
  protected name: string;
  protected type: DefinitionType;

  protected readonly node: T;
  constructor(name: string, type: DefinitionType, node: T) {
    this.name = name;
    this.type = type;
    this.node = node;
  }

  public getQualifiedName(): string {
    return this.owner ? `${this.owner.getName()}.${this.name}` : `.${this.name}`;
  }
  public setOwner(owner: ExpressP11Schema) {
    this.owner = owner;
  }

  public getName(): string {
    return this.name;
  }

  public getNode(): T {
    return this.node;
  }
  abstract getDefinition(): Definition;
}
export enum DefinitionType {
  Entity,
  EnumType,
  SelectType,
}

export enum InterfaceType {
  UseFrom,
  ReferenceFrom,
}

export type Interface = { type: InterfaceType; schema: ExpressP11Schema };

export type Definition =
  | {
      type: DefinitionType.Entity;
      resource: ExpressP11Entity;
    }
  | {
      type: DefinitionType.EnumType;
      resource: ExpressP11EnumType;
    }
  | {
      type: DefinitionType.SelectType;
      resource: ExpressP11SelectType;
    };

export type InterfacedDefinition = { interface: InterfaceType } & Definition;

export enum ExpressConflictType {
  EntityExistInSchema,
  TypeExistInSchema,
  FunctionExistInSchema,
}
export type ExpressConflict = { source: AstNode; type: ExpressConflictType };

export class ExpressP11ConflictManager {
  protected conflicts: ExpressConflict[] = [];

  public addConflict(conflict: ExpressConflict): void {
    if (conflict) this.conflicts.push(conflict);
  }

  public getConflicts(): ExpressConflict[] {
    return this.conflicts;
  }
  public reset(): void {
    this.conflicts = [];
  }
}
export class ExpressP11Schema {
  protected hasResolvedGraph: boolean = false;
  protected name: string;
  protected entities: Map<string, ExpressP11Entity> = new Map();
  protected types: Map<string, ExpressP11Type> = new Map();
  protected conflictManager: ExpressP11ConflictManager;
  protected enumTypes: Map<string, ExpressP11EnumType> = new Map();
  protected selectTypes: Map<string, ExpressP11SelectType> = new Map();
  protected localResourceRegistry: Map<string, Definition> = new Map();
  protected partiallyInterfacedResourceRegistry: InterfacedDefinition[] = [];
  protected fullInterfaces: Interface[] = [];

  constructor(name: string, conflictManager: ExpressP11ConflictManager) {
    this.name = name;
    this.conflictManager = conflictManager;
  }

  public addEntity(entity: ExpressP11Entity): void {
    if (entity) {
      if (this.entities.has(entity.getName())) {
        this.conflictManager.addConflict({ source: entity.getNode(), type: ExpressConflictType.EntityExistInSchema });
        return;
      }
      entity.setOwner(this);
      this.entities.set(entity.getName(), entity);
      this.localResourceRegistry.set(entity.getName(), entity.getDefinition());
    }
  }

  public addType(type: ExpressP11Type): void {
    if (type) {
      if (this.types.has(type.getName()))
        this.conflictManager.addConflict({
          source: type.getNode(),
          type: ExpressConflictType.TypeExistInSchema,
        });
      type.setOwner(this);
      this.types.set(type.getName(), type);
      this.localResourceRegistry.set(type.getName(), type.getDefinition());
    }
  }

  public markAsResolved() {
    this.hasResolvedGraph = true;
  }

  public resolve(memoPool: ExpressP11MemoPool) {
    this.resolveTypes(memoPool);
  }
  public resolveTypes(memoPool: ExpressP11MemoPool) {
    for (const t of this.types.values()) {
      t.resolve(memoPool);
    }
  }
  public isResolved() {
    return this.hasResolvedGraph;
  }
  public getEntity(name: string): ExpressP11Entity | undefined {
    return this.entities.get(name);
  }
  public getType(name: string): ExpressP11Type | undefined {
    return this.types.get(name);
  }
  public getLocalDefinition(name: string): Definition | undefined {
    return this.localResourceRegistry.get(name);
  }

  public getEntities(): Map<string, ExpressP11Entity> {
    return this.entities;
  }
  public getTypes(): Map<string, ExpressP11Type> {
    return this.types;
  }

  public getLocalDefinitions(): IterableIterator<Definition> {
    return this.localResourceRegistry.values();
  }
  public fullyInterfaceWith(schema: ExpressP11Schema, type: InterfaceType): void {
    if (!schema) return;
    this.fullInterfaces.push({ schema, type });
  }

  public partiallyInterfaceWith(definition: InterfacedDefinition): void {
    if (!definition) return;
    this.partiallyInterfacedResourceRegistry.push(definition);
  }

  public getAllResources(
    memoPool: ExpressP11MemoPool = new ExpressP11MemoPool(),
    includeReference: boolean = true,
    exclude: string[] = []
  ): ExpressP11OptimizedResourceList {
    const def = new ExpressP11OptimizedResourceList();

    if (memoPool.exist({ name: this.getName(), type: MemoType.Resources }) && includeReference)
      return memoPool.query({ name: this.getName(), type: MemoType.Resources }) as ExpressP11OptimizedResourceList;
    if (exclude.includes(this.name)) return new ExpressP11OptimizedResourceList();
    exclude.push(this.name);

    for (const resource of this.localResourceRegistry.values()) {
      def.add(resource.type, resource.resource.getName(), resource);
    }

    if (includeReference) {
      for (const resource of this.partiallyInterfacedResourceRegistry.values()) {
        def.add(resource.type, resource.resource.getName(), resource);
      }

      for (const i of this.fullInterfaces.filter((i) => i.type === InterfaceType.ReferenceFrom)) {
        for (const resource of i.schema.getLocalDefinitions()) {
          def.add(resource.type, resource.resource.getName(), resource);
        }
      }
    } else {
      for (const resource of this.partiallyInterfacedResourceRegistry.filter((elt) => elt.interface != InterfaceType.ReferenceFrom)) {
        def.add(resource.type, resource.resource.getName(), resource);
      }
    }

    for (const useFromInterface of this.fullInterfaces.filter((i) => i.type === InterfaceType.UseFrom)) {
      for (const resources of useFromInterface.schema.getAllResources(memoPool, false, exclude).resources.values()) {
        for (const resource of resources.values()) {
          def.add(resource.type, resource.resource.getName(), resource);
        }
      }
    }
    if (includeReference) memoPool.memoize({ name: this.getName(), payload: def, type: MemoType.Resources });

    return def;
  }

  public getName(): string {
    return this.name;
  }
}

export class ExpressP11Entity extends ExpressResource<EntityDefinition> {
  protected _subtypes: ExpressP11Entity[] = [];
  protected _supertypes: ExpressP11Entity[] = [];

  get supertypes() {
    return this._supertypes;
  }

  get subtypes() {
    return this._subtypes;
  }
  public graphKey: string = NIL;
  constructor(name: string, node: EntityDefinition) {
    super(name, DefinitionType.Entity, node);
  }

  public getDefinition(): Definition {
    return { type: DefinitionType.Entity, resource: this };
  }

  public getFullSubSuperGraph(memo: ExpressP11MemoPool): EntityDefinition[] {
    const memoQuery: MemoQuery = { name: this.getQualifiedName(), type: MemoType.Graph };
    if (memo.exist(memoQuery)) return memo.query(memoQuery) as EntityDefinition[];

    const graph = [this, ...this.getSubTypes(memo), ...this.getSuperTypes(memo)].map((ent) => ent.getNode());
    memo.memoize({ name: this.getQualifiedName(), type: MemoType.Graph, payload: graph });
    return graph;
  }
  public getSuperTypes(memo: ExpressP11MemoPool, exclude: string[] = []): ExpressP11Entity[] {
    const memoQuery: MemoQuery = { name: this.getQualifiedName(), type: MemoType.Supertypes };
    if (memo.exist(memoQuery)) return memo.query(memoQuery) as ExpressP11Entity[];

    if (exclude.includes(this.getQualifiedName())) return [];
    exclude.push(this.getQualifiedName());
    const superTypes: ExpressP11Entity[] = [];

    for (const supertype of this._supertypes) {
      superTypes.push(supertype);
      superTypes.push(...supertype.getSuperTypes(memo, exclude));
    }
    memo.memoize({ type: MemoType.Supertypes, name: this.getQualifiedName(), payload: superTypes });

    return superTypes;
  }

  public getSubSuper(memo: ExpressP11MemoPool, filter: string = ""): readonly EntityDefinition[] {
    const userFilter = filter;
    const memoQuery: MemoQuery = { name: this.graphKey.toString(), type: MemoType.SubSuper };
    if (memo.exist(memoQuery) && this.graphKey != NIL) {
      const memoized = memo.query(memoQuery) as MultiMap<string, EntityDefinition>;
      return userFilter.length > 0 ? memoized.get(userFilter) : memoized.values().toArray();
    }
    const graph = new MultiMap<string, EntityDefinition>();
    this.graphKey = uuidv4();
    const payload = this.computeSubSuper([], this.graphKey);
    payload.map((e) => graph.add(e.getName(), e.getNode()));

    memo.memoize({ type: MemoType.SubSuper, name: this.graphKey.toString(), payload: graph });

    return userFilter.length > 0 ? graph.get(filter) : graph.values().toArray();
  }
  private computeSubSuper(exclude: string[] = [], graphKey: string): ExpressP11Entity[] {
    if (exclude.includes(this.getQualifiedName())) {
      return [];
    }
    this.graphKey = graphKey;
    const subSuperList: Map<string, ExpressP11Entity> = new Map();
    exclude.push(this.getQualifiedName());
    const directTypes = [...this._supertypes, ...this._subtypes];
    for (const directType of directTypes) {
      if (!exclude.includes(directType.getQualifiedName())) {
        const result = directType.computeSubSuper(exclude, graphKey);

        for (const t of result) {
          if (!subSuperList.has(t.getQualifiedName())) {
            subSuperList.set(t.getQualifiedName(), t);
            exclude.push(t.getQualifiedName());
          }
        }
      }
    }
    subSuperList.set(this.getQualifiedName(), this);

    return [...subSuperList.values()];
  }

  public getSubTypes(memo: ExpressP11MemoPool, exclude: string[] = []): ExpressP11Entity[] {
    const memoQuery: MemoQuery = { name: this.getQualifiedName(), type: MemoType.Subtypes };
    if (memo.exist(memoQuery)) return memo.query(memoQuery) as ExpressP11Entity[];
    if (exclude.includes(this.getQualifiedName())) return [];
    exclude.push(this.getQualifiedName());
    const subTypes: ExpressP11Entity[] = [];

    for (const subtype of this._subtypes) {
      subTypes.push(subtype);
      subTypes.push(...subtype.getSubTypes(memo, exclude));
    }
    memo.memoize({ type: MemoType.Subtypes, name: this.getQualifiedName(), payload: subTypes });
    return subTypes;
  }
  public addSuperType(superType: ExpressP11Entity): void {
    if (superType) {
      this._supertypes.push(superType);
      superType.addSubType(this);
    }
  }
  public addSubType(subtype: ExpressP11Entity): void {
    if (subtype) this._subtypes.push(subtype);
  }
}

export abstract class ExpressP11Type extends ExpressResource<TypeDefinition> {
  protected isExtensible: boolean;
  protected hasBase: boolean = false;

  constructor(name: string, isExtensible: boolean, hasBase: boolean, type: DefinitionType, node: TypeDefinition) {
    super(name, type, node);
    this.isExtensible = isExtensible;
    this.hasBase = hasBase;
  }

  abstract resolve(memoPool: ExpressP11MemoPool): void;
}

export class ExpressP11EnumType extends ExpressP11Type {
  protected values: EnumValue[] = [];
  protected base: ExpressP11EnumType | undefined;
  protected baseName: string | undefined;
  constructor(
    name: string,
    isExtensible: boolean,
    hasBase: boolean,
    baseName: string | undefined,
    values: EnumValue[],
    node: TypeDefinition
  ) {
    super(name, isExtensible, hasBase, DefinitionType.EnumType, node);
    this.values = values;
    this.baseName = baseName;
  }

  public getValues(): EnumValue[] {
    const allValues: EnumValue[] = [];
    allValues.push(...this.values);
    if (this.hasBase && this.base) allValues.push(...this.base.getValues());
    return allValues;
  }
  override getDefinition(): Definition {
    return { resource: this, type: DefinitionType.EnumType };
  }

  override resolve(memoPool: ExpressP11MemoPool): void {
    if (!this.hasBase) return;
    // const base = this.owner
    //   ?.getAllResources(memoPool)
    //   .find((r) => r.type === DefinitionType.EnumType && r.resource.name === this.baseName);
    const base = this.owner?.getAllResources(memoPool)?.resources.get(DefinitionType.EnumType)?.get(this.baseName!);
    if (base) this.base = base.resource as ExpressP11EnumType;
  }
}

export type EnumValue = {
  node: Enumeration_id;
};

export class ExpressP11SelectType extends ExpressP11Type {
  protected simpleValues: ExpressP11Entity[] = [];
  protected selectTypeValues: ExpressP11SelectType[] = [];
  protected valueNames: string[] = [];
  protected base: ExpressP11SelectType | undefined;
  protected baseName: string | undefined;

  constructor(
    name: string,
    isExtensible: boolean,
    hasBase: boolean,
    baseName: string | undefined,
    valueNames: string[],
    node: TypeDefinition
  ) {
    super(name, isExtensible, hasBase, DefinitionType.SelectType, node);
    this.valueNames = valueNames;
    this.baseName = baseName;
  }

  public getValues(): ExpressP11Entity[] {
    const allValues: ExpressP11Entity[] = [];
    allValues.push(...this.simpleValues);
    if (this.hasBase && this.base) allValues.push(...this.base.getValues());
    allValues.push(...this.selectTypeValues.map((selectType) => selectType.getValues()).flat());
    return allValues;
  }
  override getDefinition(): Definition {
    return { resource: this, type: DefinitionType.SelectType };
  }
  override resolve(memoPool: ExpressP11MemoPool): void {
    this.resolveBase(memoPool);
    this.resolveSelectValues(memoPool);
  }

  private resolveBase(memoPool: ExpressP11MemoPool): void {
    if (!this.hasBase) return;
    // const base = this.owner
    //   ?.getAllResources(memoPool)
    //   .find((r) => r.type === DefinitionType.SelectType && r.resource.name === this.baseName);
    const base = this.owner?.getAllResources(memoPool)?.resources.get(DefinitionType.SelectType)?.get(this.baseName!);
    if (base) this.base = base.resource as ExpressP11SelectType;
  }
  private resolveSelectValues(memoPool: ExpressP11MemoPool): void {
    for (const selectValue of this.valueNames) {
      //   const selectEntity = this.owner
      //     ?.getAllResources(memoPool)
      //     .find((r) => r.type === DefinitionType.Entity && r.resource.getName() === selectValue);
      const selectEntity = this.owner?.getAllResources(memoPool)?.resources.get(DefinitionType.Entity)?.get(selectValue);
      if (selectEntity) {
        this.simpleValues.push(selectEntity.resource as ExpressP11Entity);
        continue;
      }
      const selectType = this.owner?.getAllResources(memoPool)?.resources.get(DefinitionType.SelectType)?.get(selectValue);
      if (selectType) {
        this.selectTypeValues.push(selectType.resource as ExpressP11SelectType);
      }
    }
  }
}

export class ExpressP11TypeFactory {
  static getType(def: TypeDefinition): ExpressP11Type | undefined {
    if (isEnumeration_type(def.underlyingType)) {
      const enumType = def.underlyingType as Enumeration_type;
      //basic enum
      if (enumType.items) {
        return new ExpressP11EnumType(
          def.name,
          enumType.isExtensible,
          false,
          undefined,
          enumType.items.items.map((i) => ({ node: i } as EnumValue)),
          def
        );
      }
      //extension
      if (enumType.extension) {
        const baseName = enumType.extension.type?.$refText;
        return new ExpressP11EnumType(
          def.name,
          enumType.isExtensible,
          true,
          baseName,
          enumType.extension.items?.items.map((i) => ({ node: i } as EnumValue)) ?? [],
          def
        );
      }
    }
    if (isSelect_type(def.underlyingType)) {
      const selectType = def.underlyingType as Select_type;
      const isExtensible = selectType.isExtensible;

      if (isSelect_extension(selectType.select)) {
        const baseName = selectType.select.type?.$refText;
        return new ExpressP11SelectType(
          def.name,
          isExtensible,
          true,
          baseName,
          selectType.select.selectList?.types.map((t) => t.$refText) ?? [],
          def
        );
      }

      return new ExpressP11SelectType(
        def.name,
        isExtensible,
        false,
        undefined,
        selectType.select?.types.map((t) => t.$refText) ?? [], //make sure there is no error
        def
      );
    }
    return;
  }
}

export class ExpressP11ParameterTypeResolver {
  public static resolve(
    attribute: Explicit_attr | Derived_attr | Inverse_attr,
    schemas: Map<string, ExpressP11Schema>,
    memoPool: ExpressP11MemoPool = new ExpressP11MemoPool()
  ): ExpressP11ParameterTypeResolution {
    const schema = getContainerOfType(attribute, isSchemaDefinition);
    if (!schema || !schema.name) return { type: ExpressP11ParameterTypeResolutionType.Unresolved, value: undefined };
    const schemaObj = schemas.get(schema.name);
    if (!schemaObj) return { type: ExpressP11ParameterTypeResolutionType.Unresolved, value: undefined };
    if (isExplicit_attr(attribute) || isDerived_attr(attribute)) {
      //read parameterType
      const parameterType = attribute.type;
      return ExpressP11ParameterTypeResolver.resolveType(parameterType, schemaObj, memoPool);
    }
    if (isInverse_attr(attribute)) {
      const entityName = attribute.type.$refText;
      const entityObj = schemaObj.getAllResources(memoPool).resources.get(DefinitionType.Entity)?.get(entityName);
      if (entityObj)
        return {
          type: ExpressP11ParameterTypeResolutionType.EntityDefinition,
          value: [entityObj.resource.getNode() as EntityDefinition],
        };
    }

    return { type: ExpressP11ParameterTypeResolutionType.Unresolved, value: undefined };
  }
  private static resolveType(
    parameterType: Parameter_type,
    schema: ExpressP11Schema,
    memoPool: ExpressP11MemoPool
  ): ExpressP11ParameterTypeResolution {
    if (isNamed_types(parameterType)) {
      const entityDataType = parameterType.of;
      if (!entityDataType) return { type: ExpressP11ParameterTypeResolutionType.Unresolved, value: undefined };

      if (parameterType.of.error) return { type: ExpressP11ParameterTypeResolutionType.Unresolved, value: undefined };
      const name = parameterType.of.$refText;
      const namedTypeResource = schema.getAllResources(memoPool).findByName(name);
      if (!namedTypeResource) return { type: ExpressP11ParameterTypeResolutionType.Unresolved, value: undefined };
      switch (namedTypeResource.type) {
        case DefinitionType.Entity:
          return {
            type: ExpressP11ParameterTypeResolutionType.EntityDefinition,
            value: [namedTypeResource.resource.getNode()],
          };
        case DefinitionType.SelectType:
          return {
            type: ExpressP11ParameterTypeResolutionType.EntityDefinition,
            value: namedTypeResource.resource.getValues().map((v) => v.getNode()),
          };
        case DefinitionType.EnumType:
          return {
            type: ExpressP11ParameterTypeResolutionType.EnumValue,
            value: namedTypeResource.resource.getValues(),
          };
      }
    }
    if (isGeneral_aggregation_types(parameterType)) {
      return ExpressP11ParameterTypeResolver.resolveType(parameterType.type, schema, memoPool);
    }
    return { type: ExpressP11ParameterTypeResolutionType.Unresolved, value: undefined };
  }
}

export type ExpressP11ParameterTypeResolution =
  | { type: ExpressP11ParameterTypeResolutionType.EnumValue; value: EnumValue[] }
  | { type: ExpressP11ParameterTypeResolutionType.EntityDefinition; value: EntityDefinition[] }
  | { type: ExpressP11ParameterTypeResolutionType.Unresolved; value: undefined };

export enum ExpressP11ParameterTypeResolutionType {
  EnumValue,
  EntityDefinition,
  Unresolved,
}

export class ExpressP11OptimizedResourceList {
  protected resource = new Map<DefinitionType, Map<string, Definition>>();

  public add(type: DefinitionType, name: string, definition: Definition): void {
    if (this.resource.has(type)) {
      this.resource.get(type)?.set(name, definition);
    } else {
      this.resource.set(type, new Map<string, Definition>());
      this.resource.get(type)?.set(name, definition);
    }
  }

  get resources() {
    return this.resource;
  }

  public findByName(name: string): Definition | undefined {
    let result: Definition | undefined;
    this.resource.forEach((v, k) => {
      if (v.has(name)) result = v.get(name);
    });
    return result;
  }
}

export class ExpressP11OptimizedAttributeList {
  protected resource = new Map<string, Map<string, Attribute_decl[]>>();

  public add(graphKey: string, attributeName: string, attribute: Attribute_decl): void {
    if (this.resource.has(graphKey)) {
      if (this.resource.get(graphKey)?.has(attributeName)) {
        const attributes = this.resource.get(graphKey)?.get(attributeName);
        this.resource.get(graphKey)?.set(attributeName, [...attributes!, attribute]);
      } else {
        this.resource.get(graphKey)?.set(attributeName, [attribute]);
      }
    } else {
      this.resource.set(graphKey, new Map<string, Attribute_decl[]>());
      this.resource.get(graphKey)?.set(attributeName, [attribute]);
    }
  }

  get resources() {
    return this.resource;
  }

  public findByName(graphKey: string, name: string): Attribute_decl[] {
    // let result: Attribute_decl[] | undefined;
    // this.resource.forEach((v, k) => {
    //   if (v.has(name)) result = v.get(name);
    // });
    if (name.length > 0) {
      return this.resource.get(graphKey)?.get(name) ?? [];
    } else {
      let result: Attribute_decl[] = [];
      this.resource.get(graphKey)?.forEach((attributes, name) => {
        result.push(...attributes);
      });
      return result;
    }
    // return result;
  }

  public clear() {
    this.resource.clear();
  }
}
