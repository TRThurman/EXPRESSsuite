import { MultiMap } from "langium";
import {
  ExpressP11Entity,
  ExpressP11OptimizedResourceList,
  ExpressP11ParameterTypeResolution,
} from "./express-p11-type-utilities.js";
import { EntityDefinition } from "./generated/ast.js";

export enum MemoType {
  Supertypes,
  Subtypes,
  Resources,
  Types,
  SubSuper,
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
      type: MemoType.Resources;
      payload: ExpressP11OptimizedResourceList;
    }
  | {
      type: MemoType.Types;
      payload: ExpressP11ParameterTypeResolution;
    }
  | {
      type: MemoType.SubSuper;
      payload: MultiMap<string, EntityDefinition>;
    }
);

export type MemoQuery = {
  name: string;
  type: MemoType;
};

export class ExpressP11MemoPool {
  protected readonly memoizedSupertypesCall = new Map<string, ExpressP11Entity[]>();
  protected readonly memoizedSubtypesCall = new Map<string, ExpressP11Entity[]>();
  protected readonly memoizedSubSuperCall = new Map<string, MultiMap<string, EntityDefinition>>();

  protected readonly memoizedAllResourcesCall = new Map<string, ExpressP11OptimizedResourceList>();

  constructor() {}

  public reset() {
    this.memoizedSubtypesCall.clear();
    this.memoizedSupertypesCall.clear();
    this.memoizedAllResourcesCall.clear();
    this.memoizedSubSuperCall.clear();
  }

  public getAllGraphs(): Map<string, MultiMap<string, EntityDefinition>> {
    return this.memoizedSubSuperCall;
  }
  public memoize(record: MemoRecord): void {
    switch (record.type) {
      case MemoType.Subtypes:
        this.memoizedSubtypesCall.set(record.name, record.payload);
        break;
      case MemoType.Supertypes:
        this.memoizedSupertypesCall.set(record.name, record.payload);
        break;
      case MemoType.Resources:
        this.memoizedAllResourcesCall.set(record.name, record.payload);
        break;
      case MemoType.SubSuper:
        this.memoizedSubSuperCall.set(record.name, record.payload);
        break;
    }
  }

  public exist(query: MemoQuery): boolean {
    switch (query.type) {
      case MemoType.Subtypes:
        return this.memoizedSubtypesCall.has(query.name);
      case MemoType.Supertypes:
        return this.memoizedSupertypesCall.has(query.name);
      case MemoType.Resources:
        return this.memoizedAllResourcesCall.has(query.name);
      case MemoType.SubSuper:
        return this.memoizedSubSuperCall.has(query.name);
      default:
        return false;
    }
  }

  public query(
    query: MemoQuery
  ): ExpressP11Entity[] | EntityDefinition[] | ExpressP11OptimizedResourceList | MultiMap<string, EntityDefinition> {
    switch (query.type) {
      case MemoType.Subtypes:
        return this.memoizedSubtypesCall.get(query.name) ?? [];
      case MemoType.Supertypes:
        return this.memoizedSupertypesCall.get(query.name) ?? [];
      case MemoType.Resources:
        return this.memoizedAllResourcesCall.get(query.name) ?? [];
      case MemoType.SubSuper:
        return this.memoizedSubSuperCall.get(query.name) ?? [];
      default:
        return [];
    }
  }
}
