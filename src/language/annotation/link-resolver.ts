import type { NameProvider } from "langium";
import type { SchemaDefinition } from "../generated/ast.js";
import { ExpressP11ScopeIndex, isLongFormSchemaName } from "../express-p11-scope-index.js";
import { memberNamesOf, type DescribeKind } from "./keys.js";

export type LinkCheck = "declared" | "undeclared" | "unknown-schema" | "unsupported";

export type Resolution =
  | { kind: "reachable"; schema: string }
  | { kind: "unique-elsewhere"; schema: string }
  | { kind: "ambiguous"; schemas: string[] }
  | { kind: "none" };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ATTRIBUTE_KINDS: ReadonlySet<DescribeKind> = new Set([
  "explicit-attribute",
  "derived-attribute",
  "inverse-attribute",
  "redeclared-attribute",
]);

/** Answers, from the scope index, whether a `<<express:...>>` target exists and which schema a bare name belongs to. */
export class LinkResolver {
  constructor(
    private readonly scopeIndex: ExpressP11ScopeIndex,
    private readonly nameProvider: NameProvider
  ) {}

  /** `schema.name` or `schema.owner.member`; every other shape is "unsupported". */
  check(target: string): LinkCheck {
    const parts = target.split(".");
    if ((parts.length !== 2 && parts.length !== 3) || !parts.every((part) => IDENTIFIER.test(part))) return "unsupported";
    const [schema, name, member] = parts;
    if (isLongFormSchemaName(schema) || !this.scopeIndex.hasSchema(schema)) return "unknown-schema";
    const decl = this.scopeIndex.localDeclaration(schema, name);
    if (!decl) return "undeclared";
    if (member === undefined) return "declared";
    return memberNamesOf(decl.node, this.nameProvider).has(member.toLowerCase()) ? "declared" : "undeclared";
  }

  resolve(from: SchemaDefinition, name: string): Resolution {
    const lower = name.toLowerCase();
    const reached: string[] = [];
    for (const arrival of this.scopeIndex.visibleIn(from)) {
      if (arrival.effectiveName.toLowerCase() === lower && !reached.includes(arrival.decl.schema)) reached.push(arrival.decl.schema);
    }
    if (reached.length === 1) return { kind: "reachable", schema: reached[0] };
    if (reached.length > 1) return { kind: "ambiguous", schemas: reached };
    const elsewhere = this.scopeIndex.declaringSchemas(name);
    if (elsewhere.length === 1) return { kind: "unique-elsewhere", schema: elsewhere[0] };
    if (elsewhere.length > 1) return { kind: "ambiguous", schemas: elsewhere };
    return { kind: "none" };
  }

  /** `schema.entity.attribute` of a declared entity. */
  isAttributeTarget(target: string): boolean {
    const parts = target.split(".");
    if (parts.length !== 3 || !parts.every((part) => IDENTIFIER.test(part))) return false;
    const decl = this.scopeIndex.localDeclaration(parts[0], parts[1]);
    if (!decl || decl.kind !== "ENTITY") return false;
    const kind = memberNamesOf(decl.node, this.nameProvider).get(parts[2].toLowerCase());
    return kind !== undefined && ATTRIBUTE_KINDS.has(kind);
  }
}
