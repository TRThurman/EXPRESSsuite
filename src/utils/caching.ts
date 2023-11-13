import { AstNode } from "langium";
import {
  Constant_body,
  EntityDefinition,
  FunctionDefinition,
  Parameter_id,
  Variable_id,
  isEntityDefinition,
  isFunctionDefinition,
} from "../language/generated/ast.js";
import { getFunctionLocalConstants, getFunctionLocalVariables, getFunctionParameters, getStatementVariables } from "./function-helpers.js";
import { ExpressP11References } from "../language/express-p11-references.js";
import { getFullSubSuperGraph } from "./entity-helpers.js";
import { CustomExpressDescription } from "../language/express-p11-scope-provider.js";

type MemoCall = {
  deps: string[];
  value: any;
  type: MemoType;
  key: AstNode;
};

export enum MemoType {
  FunctionParameters,
  FunctionLocalVariables,
  FunctionLocalConstants,
  StatementVariables,
  ExplicitAttributeDeclarations,
  AttributeDeclarations,
  DerivedAttributes,
  DirectDataTypeFromAttribute,
  DataTypesFromAttributes,
  FunctionParameterType,
  DataTypesFromParameterId,
  FullGraph,
}

export class ScopingCache {
  private memoCalls: MemoCall[] = [];
  private computed: number = 0;
  private saved: number = 0;
  constructor() {}

  private get<T>({ type, key, deps, filler }: { type: MemoType; key: AstNode; deps: string[]; filler: () => T }): T {
    const call = this.memoCalls.find((c) => c.key === key && c.type === type);

    if (call) {
      this.saved += 1;
      return call.value;
    }

    const newCall = { key, type, deps, value: filler() };
    this.computed += 1;
    this.memoCalls.push(newCall);
    return newCall.value;
  }

  public logFinal(): void {
    console.log(`Saved: ${this.saved} - Computed: ${this.computed}`);
    this.saved = 0;
    this.computed = 0;
  }

  public logFirst(): void {}

  public getFunctionParameters(func: FunctionDefinition, deps: string[]): Parameter_id[] {
    return this.get({
      filler: () => getFunctionParameters(func),
      type: MemoType.FunctionParameters,
      deps,
      key: func,
    });
  }
  public getFunctionLocalVariables(func: FunctionDefinition, deps: string[]): Variable_id[] {
    return this.get({
      filler: () => getFunctionLocalVariables(func),
      type: MemoType.FunctionLocalVariables,
      deps,
      key: func,
    });
  }

  public getFunctionLocalConstants(func: FunctionDefinition, deps: string[]): Constant_body[] {
    return this.get({
      filler: () => getFunctionLocalConstants(func),
      type: MemoType.FunctionLocalConstants,
      deps,
      key: func,
    });
  }

  public getFunctionStatementVariables(leaf: AstNode, deps: string[]): Variable_id[] {
    return this.get({
      filler: () => getStatementVariables(leaf, isFunctionDefinition),
      type: MemoType.StatementVariables,
      deps,
      key: leaf,
    });
  }
  public getEntityStatementVariables(leaf: AstNode, deps: string[]): Variable_id[] {
    return this.get({
      filler: () => getStatementVariables(leaf, isEntityDefinition),
      type: MemoType.StatementVariables,
      deps,
      key: leaf,
    });
  }

  public getFullSubSuperGraph(
    entity: EntityDefinition,
    references: ExpressP11References,
    deps: string[]
  ): CustomExpressDescription<EntityDefinition>[] {
    return this.get({
      filler: () => getFullSubSuperGraph(entity, references),
      type: MemoType.FullGraph,
      deps,
      key: entity,
    });
  }

  public flush(dep: string): void {
    //console.log(`flushing ${dep}`);
    this.memoCalls = this.memoCalls.filter((m) => !m.deps.includes(dep));
  }
}
