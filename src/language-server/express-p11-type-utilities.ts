import { ExpressP11MemoPool, MemoQuery, MemoType } from "./express-p11-memo-pool";
import { EntityDefinition } from "./generated/ast";

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
export class ExpressP11Schema {
  protected hasResolvedGraph: boolean = false;
  protected name: string;
  protected entities: Map<string, ExpressP11Entity> = new Map();
  protected enumTypes: Map<string, ExpressP11EnumType> = new Map();
  protected selectTypes: Map<string, ExpressP11SelectType> = new Map();
  protected localResourceRegistry: Map<string, Definition> = new Map();
  protected partiallyInterfacedResourceRegistry: InterfacedDefinition[] = [];
  protected fullInterfaces: Interface[] = [];

  constructor(name: string) {
    this.name = name;
  }

  public addEntity(entity: ExpressP11Entity): void {
    if (entity) {
      this.entities.set(entity.getName(), entity);
      this.localResourceRegistry.set(entity.getName(), entity.getDefinition());
    }
  }

  public markAsResolved() {
    this.hasResolvedGraph = true;
  }
  public isResolved() {
    return this.hasResolvedGraph;
  }
  public getEntity(name: string): ExpressP11Entity | undefined {
    return this.entities.get(name);
  }

  public getLocalDefinition(name: string): Definition | undefined {
    return this.localResourceRegistry.get(name);
  }

  public getEntities(): IterableIterator<ExpressP11Entity> {
    return this.entities.values();
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

  public getAllResources(includeReference: boolean = true, exclude: string[] = []): Definition[] {
    if (exclude.includes(this.name)) return [];
    exclude.push(this.name);
    const definitionsInScope: Definition[] = [];

    definitionsInScope.push(...this.localResourceRegistry.values());

    if (includeReference) {
      definitionsInScope.push(...this.partiallyInterfacedResourceRegistry.values());
      this.fullInterfaces
        .filter((i) => i.type === InterfaceType.ReferenceFrom)
        .forEach((i) => definitionsInScope.push(...i.schema.getLocalDefinitions()));
    } else {
      definitionsInScope.push(
        ...this.partiallyInterfacedResourceRegistry.filter((elt) => elt.interface != InterfaceType.ReferenceFrom)
      );
    }

    for (const useFromInterface of this.fullInterfaces.filter((i) => i.type === InterfaceType.UseFrom)) {
      definitionsInScope.push(...useFromInterface.schema.getAllResources(false, exclude));
    }
    return definitionsInScope;
  }

  public getName(): string {
    return this.name;
  }
}

export class ExpressP11Entity {
  protected name: string;
  protected node: EntityDefinition;
  protected subtypes: ExpressP11Entity[] = [];
  protected supertyes: ExpressP11Entity[] = [];
  protected owner: ExpressP11Schema;

  constructor(name: string, owner: ExpressP11Schema, node: EntityDefinition) {
    this.name = name;
    this.owner = owner;
    this.node = node;
  }

  public getName(): string {
    return this.name;
  }

  public getNode(): EntityDefinition {
    return this.node;
  }
  public getQualifiedName(): string {
    return `${this.owner.getName()}.${this.name}`;
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

    for (const supertype of this.supertyes) {
      superTypes.push(supertype);
      superTypes.push(...supertype.getSuperTypes(memo, exclude));
    }
    memo.memoize({ type: MemoType.Supertypes, name: this.getQualifiedName(), payload: superTypes });

    return superTypes;
  }

  public getSubTypes(memo: ExpressP11MemoPool, exclude: string[] = []): ExpressP11Entity[] {
    const memoQuery: MemoQuery = { name: this.getQualifiedName(), type: MemoType.Subtypes };
    if (memo.exist(memoQuery)) return memo.query(memoQuery) as ExpressP11Entity[];
    if (exclude.includes(this.getQualifiedName())) return [];
    exclude.push(this.getQualifiedName());
    const subTypes: ExpressP11Entity[] = [];

    for (const subtype of this.subtypes) {
      subTypes.push(subtype);
      subTypes.push(...subtype.getSubTypes(memo, exclude));
    }
    memo.memoize({ type: MemoType.Subtypes, name: this.getQualifiedName(), payload: subTypes });
    return subTypes;
  }
  public addSuperType(superType: ExpressP11Entity): void {
    if (superType) {
      this.supertyes.push(superType);
      superType.addSubType(this);
    }
  }
  public addSubType(subtype: ExpressP11Entity): void {
    if (subtype) this.subtypes.push(subtype);
  }
}

enum P11Type {
  Enum,
  Select,
}
export abstract class ExpressP11Type {
  protected name: string;
  protected isExtensible: boolean;
  protected hasBase: boolean;

  constructor(name: string, isExtensible: boolean, hasBase: boolean) {
    this.name = name;
    this.isExtensible = isExtensible;
    this.hasBase = hasBase;
  }
}

export class ExpressP11EnumType extends ExpressP11Type {
  protected values: string[] = [];
  protected base: ExpressP11EnumType | undefined;
  constructor(name: string, isExtensible: boolean, hasBase: boolean, base: ExpressP11EnumType, values: string[]) {
    super(name, isExtensible, hasBase);
    this.values = values;
    this.base = base;
  }

  public getValues(): string[] {
    return this.values;
  }
}

export class ExpressP11SelectType extends ExpressP11Type {
  protected values: ExpressP11Entity[] = [];
  protected base: ExpressP11SelectType | undefined;
  constructor(
    name: string,
    isExtensible: boolean,
    hasBase: boolean,
    base: ExpressP11SelectType,
    values: ExpressP11Entity[]
  ) {
    super(name, isExtensible, hasBase);
    this.values = values;
    this.base = base;
  }

  public getValues(): ExpressP11Entity[] {
    return this.values;
  }
}
