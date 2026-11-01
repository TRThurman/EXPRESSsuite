import { AstNode, AstUtils, GrammarUtils, LangiumDocument } from "langium";
import { byUri } from "../utils/file-filter.js";
import type { Range } from "vscode-languageserver";
import {
  Named_type_or_rename,
  Reference_clause,
  Resource_or_rename,
  SchemaDefinition,
  Use_clause,
  isEntityDefinition,
  isExpressFile,
  isFunctionDefinition,
  isProcedureDefinition,
  isReference_clause,
  isRule_decl,
  isSubtypeConstraintDefinition,
  isTypeDefinition,
  isUse_clause,
} from "./generated/ast.js";

/**
 * Schema scopes and the identifiers visible in them, ISO 10303-11:2004 10.1 b
 * and clause 11, as decided by `lean/ExpressSuite/Interfaces.lean`:
 *
 * - `exportOf` is `Export` (the items a schema re-exports along USE chains):
 *   its local named data types, its listed USE items under their effective
 *   names, and the `Export` of every schema it fully USEs (11.1: "declared
 *   within or use'd by"; 11.3: use chains, renames). REFERENCE'd items are
 *   never in it (11.3: "it is not possible to chain reference's").
 * - `visibleIn` is `Visible`: the schema's own declarations of every kind, its
 *   listed and full USE arrivals, and its REFERENCE arrivals, where a full
 *   REFERENCE FROM t brings the constants, entities, functions, procedures and
 *   types declared in t and everything t use's (11.2, fourth sentence; ruling
 *   2026-10-30: the clause wins).
 * - `clashesIn` is `clash`: one identifier, two or more different
 *   declarations (10.1 b). One declaration reached by several routes counts
 *   once (10.1 b, second sentence). Implicit interfaces (11.4) bring no
 *   identifier and play no part.
 *
 * Identifier keys (project rulings 2026-10-29 and 2026-10-30): in a short
 * form, an entity name is case-significant and every other kind is compared
 * without regard to case; in a long form (schema name ending `_lf`, WG11
 * N239) every identifier is compared without regard to case, and two
 * declarations with identical text are a redundancy rather than a clash.
 */
export type ScopeDeclKind = "ENTITY" | "TYPE" | "FUNCTION" | "PROCEDURE" | "RULE" | "SUBTYPE_CONSTRAINT" | "CONSTANT";

/** A declaration that defines an identifier in a schema scope (ISO 10303-11:2004 Table 9). */
export type ScopeDecl = {
  kind: ScopeDeclKind;
  name: string;
  /** The whole declaration (a `Rule_decl` for a rule). */
  node: AstNode;
  /** The node that carries the `name` property (the `Rule_head` for a rule). */
  anchor: AstNode;
  schema: string;
  uri: string;
};

export type ScopeRoute =
  | { kind: "local" }
  | {
      kind: "use" | "reference";
      spec: Use_clause | Reference_clause;
      /** The listed item, when the interface names its items. */
      item?: Named_type_or_rename | Resource_or_rename;
      /** Schemas passed through, nearest first; empty for a declaration of the interfaced schema itself. */
      chain: string[];
    };

export type ScopeArrival = { decl: ScopeDecl; effectiveName: string; route: ScopeRoute };

export type ScopeClash = {
  /** The identifier as first seen in this scope. */
  identifier: string;
  key: string;
  /** Distinct declarations, in order of first arrival. */
  declarations: ScopeDecl[];
  /** Every arrival in this schema under the key. */
  arrivals: ScopeArrival[];
  longForm: boolean;
  /** Long forms only: every declaration has the same text after remark, whitespace and case normalisation. */
  identical: boolean;
};

type ExportEntry = { decl: ScopeDecl; effectiveName: string; chain: string[] };

type SchemaRecord = {
  node: SchemaDefinition;
  name: string;
  uri: string;
  locals: ScopeDecl[];
  specs: Array<Use_clause | Reference_clause>;
  exports: Map<string, ExportEntry>;
};

const REFERENCEABLE: ReadonlySet<ScopeDeclKind> = new Set(["CONSTANT", "ENTITY", "FUNCTION", "PROCEDURE", "TYPE"]);
const NAMED_TYPES: ReadonlySet<ScopeDeclKind> = new Set(["ENTITY", "TYPE"]);

export function isLongFormSchemaName(name: string): boolean {
  return /_lf$/i.test(name);
}

/** The range of a declaration's name, for related information and command output. */
export function declarationNameRange(decl: ScopeDecl): Range | undefined {
  return GrammarUtils.findNodeForProperty(decl.anchor.$cstNode, "name")?.range ?? decl.anchor.$cstNode?.range;
}

export class ExpressP11ScopeIndex {
  private records = new Map<SchemaDefinition, SchemaRecord>();
  /** Records per schema name, in document order. */
  private byName = new Map<string, SchemaRecord[]>();
  private declIds = new WeakMap<AstNode, number>();
  private nextDeclId = 0;
  private clashCache = new Map<SchemaDefinition, ScopeClash[]>();

  build(documents: LangiumDocument[]): void {
    this.records = new Map();
    this.byName = new Map();
    this.declIds = new WeakMap();
    this.nextDeclId = 0;
    this.clashCache = new Map();
    for (const document of [...documents].sort(byUri)) {
      const file = document.parseResult.value;
      if (!isExpressFile(file)) continue;
      const uri = document.uri.toString();
      for (const schema of file.schemas ?? []) {
        if (!schema.name) continue;
        const record: SchemaRecord = {
          node: schema,
          name: schema.name,
          uri,
          locals: this.collectLocals(schema, uri),
          specs: (schema.body?.specifications ?? []).filter(
            (spec): spec is Use_clause | Reference_clause => isUse_clause(spec) || isReference_clause(spec)
          ),
          exports: new Map(),
        };
        this.records.set(schema, record);
        const named = this.byName.get(schema.name);
        if (named) named.push(record);
        else this.byName.set(schema.name, [record]);
      }
    }
    this.computeExports();
  }

  /** Names declared by more than one schema in the workspace (concatenated copies, duplicated files). */
  get shadowedSchemaNames(): string[] {
    return [...this.byName.entries()].filter(([, records]) => records.length > 1).map(([name]) => name);
  }

  /**
   * The schema an interface specification names: a same-named schema in the
   * same document first (a concatenated file interfaces its own copies), else
   * the first in workspace order.
   */
  private resolveTarget(from: SchemaRecord, name: string): SchemaRecord | undefined {
    const candidates = this.byName.get(name);
    if (!candidates || candidates.length === 0) return undefined;
    return candidates.find((candidate) => candidate.uri === from.uri) ?? candidates[0];
  }

  exportOf(schema: SchemaDefinition | string): ScopeArrival[] {
    const record = typeof schema === "string" ? this.byName.get(schema)?.[0] : this.records.get(schema);
    if (!record) return [];
    return [...record.exports.values()].map((entry) => ({
      decl: entry.decl,
      effectiveName: entry.effectiveName,
      route: { kind: "local" as const },
    }));
  }

  visibleIn(schema: SchemaDefinition): ScopeArrival[] {
    const record = this.records.get(schema);
    if (!record) return [];
    const arrivals: ScopeArrival[] = record.locals.map((decl) => ({ decl, effectiveName: decl.name, route: { kind: "local" } }));
    for (const spec of record.specs) {
      const target = this.resolveTarget(record, spec.schema.$refText);
      if (!target) continue;
      const kind = isUse_clause(spec) ? "use" : "reference";
      const pool = kind === "use" ? [...target.exports.values()] : this.referenceable(target);
      if (spec.resources.length === 0) {
        for (const entry of pool) {
          arrivals.push({ decl: entry.decl, effectiveName: entry.effectiveName, route: { kind, spec, chain: entry.chain } });
        }
        continue;
      }
      for (const item of spec.resources as Array<Named_type_or_rename | Resource_or_rename>) {
        const written = item.resource.$refText;
        if (!written) continue;
        for (const entry of resolveIn(pool, written)) {
          const effectiveName = item.isRenamed && item.name ? item.name : entry.effectiveName;
          arrivals.push({ decl: entry.decl, effectiveName, route: { kind, spec, item, chain: entry.chain } });
        }
      }
    }
    return arrivals;
  }

  clashesIn(schema: SchemaDefinition): ScopeClash[] {
    const cached = this.clashCache.get(schema);
    if (cached) return cached;
    const record = this.records.get(schema);
    if (!record) return [];
    const longForm = isLongFormSchemaName(record.name);
    const groups = new Map<string, ScopeArrival[]>();
    for (const arrival of this.visibleIn(schema)) {
      const key = scopeKey(arrival, longForm);
      const group = groups.get(key);
      if (group) group.push(arrival);
      else groups.set(key, [arrival]);
    }
    const clashes: ScopeClash[] = [];
    for (const [key, arrivals] of groups) {
      const declarations: ScopeDecl[] = [];
      const seen = new Set<number>();
      for (const arrival of arrivals) {
        const id = this.declId(arrival.decl.node);
        if (seen.has(id)) continue;
        seen.add(id);
        declarations.push(arrival.decl);
      }
      if (declarations.length < 2) continue;
      const identical = longForm && allEqual(declarations.map((decl) => normalisedText(decl.node)));
      clashes.push({ identifier: arrivals[0].effectiveName, key, declarations, arrivals, longForm, identical });
    }
    clashes.sort((left, right) => left.key.localeCompare(right.key));
    this.clashCache.set(schema, clashes);
    return clashes;
  }

  private collectLocals(schema: SchemaDefinition, uri: string): ScopeDecl[] {
    const locals: ScopeDecl[] = [];
    const add = (kind: ScopeDeclKind, name: string | undefined, node: AstNode, anchor: AstNode = node) => {
      if (name) locals.push({ kind, name, node, anchor, schema: schema.name, uri });
    };
    for (const declaration of schema.body?.declarations ?? []) {
      if (isEntityDefinition(declaration)) add("ENTITY", declaration.name, declaration);
      else if (isTypeDefinition(declaration)) add("TYPE", declaration.name, declaration);
      else if (isFunctionDefinition(declaration)) add("FUNCTION", declaration.name, declaration);
      else if (isProcedureDefinition(declaration)) add("PROCEDURE", declaration.name, declaration);
      else if (isSubtypeConstraintDefinition(declaration)) add("SUBTYPE_CONSTRAINT", declaration.name, declaration);
      else if (isRule_decl(declaration)) add("RULE", declaration.ruleHead?.name, declaration, declaration.ruleHead ?? declaration);
    }
    for (const constant of schema.body?.constant?.items ?? []) add("CONSTANT", constant.name, constant);
    return locals;
  }

  /**
   * `Export` as a least fixed point over the USE graph: seeded with each
   * schema's local named data types, then grown by its USE interfaces until a
   * round adds nothing. Lean: every entry produced is in `Export`
   * (`iterate_sound`), and a table that a round cannot grow contains all of
   * `Export` (`export_of_stable`), so stopping at "no change" is exact. The
   * cap only guards against a runaway: a derivation visits each (schema,
   * effective name) state at most once, and a new effective name needs a
   * rename, so schemas × (1 + renames) rounds always suffice.
   */
  private computeExports(): void {
    for (const record of this.records.values()) {
      record.exports = new Map();
      for (const decl of record.locals) {
        if (NAMED_TYPES.has(decl.kind)) this.addExport(record, { decl, effectiveName: decl.name, chain: [] });
      }
    }
    let renames = 0;
    for (const record of this.records.values()) {
      for (const spec of record.specs) for (const item of spec.resources) if (item.isRenamed) renames++;
    }
    const bound = this.records.size * (1 + renames) + 2;
    for (let round = 0; round < bound; round++) {
      let changed = false;
      for (const record of this.records.values()) {
        for (const spec of record.specs) {
          if (!isUse_clause(spec)) continue;
          const target = this.resolveTarget(record, spec.schema.$refText);
          if (!target || target === record) continue;
          if (spec.resources.length === 0) {
            for (const entry of target.exports.values()) {
              if (this.addExport(record, { decl: entry.decl, effectiveName: entry.effectiveName, chain: [target.name, ...entry.chain] })) changed = true;
            }
            continue;
          }
          for (const item of spec.resources) {
            const written = item.resource.$refText;
            if (!written) continue;
            for (const entry of resolveIn([...target.exports.values()], written)) {
              const effectiveName = item.isRenamed && item.name ? item.name : entry.effectiveName;
              if (this.addExport(record, { decl: entry.decl, effectiveName, chain: [target.name, ...entry.chain] })) changed = true;
            }
          }
        }
      }
      if (!changed) return;
    }
  }

  private addExport(record: SchemaRecord, entry: ExportEntry): boolean {
    const key = `${this.declId(entry.decl.node)}\u0000${entry.effectiveName}`;
    if (record.exports.has(key)) return false;
    record.exports.set(key, entry);
    return true;
  }

  /** What a REFERENCE FROM t may name: t's referenceable declarations and everything t use's (11.2). */
  private referenceable(target: SchemaRecord): ExportEntry[] {
    const pool: ExportEntry[] = [];
    const seen = new Set<string>();
    const push = (entry: ExportEntry) => {
      const key = `${this.declId(entry.decl.node)}\u0000${entry.effectiveName}`;
      if (seen.has(key)) return;
      seen.add(key);
      pool.push(entry);
    };
    for (const decl of target.locals) if (REFERENCEABLE.has(decl.kind)) push({ decl, effectiveName: decl.name, chain: [] });
    for (const entry of target.exports.values()) push(entry);
    return pool;
  }

  private declId(node: AstNode): number {
    let id = this.declIds.get(node);
    if (id === undefined) {
      id = this.nextDeclId++;
      this.declIds.set(node, id);
    }
    return id;
  }
}

/** Entries whose effective name is the written one: exact spelling first; otherwise any case for a non-entity. */
function resolveIn(pool: ExportEntry[], written: string): ExportEntry[] {
  const exact = pool.filter((entry) => entry.effectiveName === written);
  if (exact.length > 0) return exact;
  const lower = written.toLowerCase();
  return pool.filter((entry) => entry.decl.kind !== "ENTITY" && entry.effectiveName.toLowerCase() === lower);
}

function scopeKey(arrival: ScopeArrival, longForm: boolean): string {
  if (longForm) return arrival.effectiveName.toLowerCase();
  return arrival.decl.kind === "ENTITY" ? arrival.effectiveName : arrival.effectiveName.toLowerCase();
}

function normalisedText(node: AstNode): string {
  const text = node.$cstNode?.text ?? "";
  return text
    .replace(/\(\*[\s\S]*?\*\)/g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function allEqual(values: string[]): boolean {
  return values.every((value) => value === values[0]);
}

export function documentUriOf(node: AstNode): string {
  return AstUtils.getDocument(node).uri.toString();
}
