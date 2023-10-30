import { ExpressP11Entity } from "./express-p11-type-utilities";
import { EntityDefinition } from "./generated/ast";

export enum MemoType {
  Supertypes,
  Subtypes,
  Graph,
}

export type MemoRecord = { name: string } & (
  | {
      type: MemoType.Subtypes;
      payload: ExpressP11Entity[];
    }
  | {
      type: MemoType.Supertypes;
      payload: ExpressP11Entity[];
    }
  | {
      type: MemoType.Graph;
      payload: EntityDefinition[];
    }
);

export type MemoQuery = {
  name: string;
  type: MemoType;
};

export class ExpressP11MemoPool {
  protected readonly memoizedSupertypesCall = new Map<string, ExpressP11Entity[]>();
  protected readonly memoizedSubtypesCall = new Map<string, ExpressP11Entity[]>();

  protected readonly memoizedGraphCall = new Map<string, EntityDefinition[]>();

  constructor() {}

  public reset() {
    this.memoizedGraphCall.clear();
    this.memoizedSubtypesCall.clear();
    this.memoizedSupertypesCall.clear();
  }
  public memoize(record: MemoRecord): void {
    switch (record.type) {
      case MemoType.Graph:
        this.memoizedGraphCall.set(record.name, record.payload);
        break;
      case MemoType.Subtypes:
        this.memoizedSubtypesCall.set(record.name, record.payload);
        break;
      case MemoType.Supertypes:
        this.memoizedSupertypesCall.set(record.name, record.payload);
        break;
    }
  }

  public exist(query: MemoQuery): boolean {
    switch (query.type) {
      case MemoType.Graph:
        return this.memoizedGraphCall.has(query.name);
      case MemoType.Subtypes:
        return this.memoizedSubtypesCall.has(query.name);
      case MemoType.Supertypes:
        return this.memoizedSupertypesCall.has(query.name);
      default:
        return false;
    }
  }

  public query(query: MemoQuery): ExpressP11Entity[] | EntityDefinition[] {
    switch (query.type) {
      case MemoType.Graph:
        return this.memoizedGraphCall.get(query.name) ?? [];
      case MemoType.Subtypes:
        return this.memoizedSubtypesCall.get(query.name) ?? [];
      case MemoType.Supertypes:
        return this.memoizedSupertypesCall.get(query.name) ?? [];
      default:
        return [];
    }
  }
}
