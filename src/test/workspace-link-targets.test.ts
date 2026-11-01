import { AstUtils, URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11ScopeProvider, ScopeType } from "../language/express-p11-scope-provider.js";
import { ExpressP11TypeContainer } from "../language/express-p11-type-container.js";
import {
  EntityDefinition,
  isAttribute_decl,
  isAttribute_qualifier,
  isEntityDefinition,
  isExplicit_attr,
  isInverse_attr,
  isSchemaDefinition,
} from "../language/generated/ast.js";

/**
 * Headless link-target census over a workspace folder: for every attribute
 * qualifier `x.a` and every INVERSE `FOR a`, where the reference actually binds,
 * and how that target relates to the declared type of the operand under
 * ISO 10303-11:2004 12.7.3 (self, supertype, subtype, or outside that set).
 * The relation is computed from the AST independently of the linker, so the
 * census can judge the linker. Not a test by itself: it runs only when the
 * environment names a workspace, and writes names, positions and counts only.
 *
 *   EXPRESS_LINK_ROOT=<folder> EXPRESS_LINK_OUT=<file.json> \
 *       npx vitest run src/test/workspace-link-targets.test.ts
 *
 * The workspace is loaded with the extension's default settings read from
 * package.json, as the diagnostics census does.
 */
const root = process.env.EXPRESS_LINK_ROOT ? resolve(process.env.EXPRESS_LINK_ROOT) : undefined;
const out = process.env.EXPRESS_LINK_OUT ? resolve(process.env.EXPRESS_LINK_OUT) : undefined;

type Relation = "self" | "ancestor" | "descendant" | "outside" | "own" | "unresolved" | "enum";

type Site = {
  file: string;
  line: number;
  col: number;
  kind: "attr" | "inverse";
  name: string;
  operandKind: "entities" | "entity" | "enums" | "empty";
  operand: string[];
  target: { schema: string; entity: string; attribute: string; explicit: boolean } | null;
  relation: Relation;
  nodeMismatch: boolean;
};

describe.skipIf(!root || !out)("workspace link-target census", () => {
  test("record the target of every attribute qualifier and INVERSE FOR", async () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const props = pkg.contributes.configuration.properties;
    const settings = {
      expresssuite: {
        useOptimizedConfiguration: props["expresssuite.useOptimizedConfiguration"].default,
        excludedFolders: props["expresssuite.excludedFolders"].default,
        excludedFiles: props["expresssuite.excludedFiles"].default,
      },
    };
    const { shared, ExpressP11 } = createExpressP11Services(NodeFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    shared.workspace.ConfigurationProvider.updateConfiguration({ settings });
    const started = Date.now();
    await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(root!).toString(), name: "corpus" }]);
    await shared.workspace.WorkspaceManager.ready;

    const scopeProvider = ExpressP11.references.ScopeProvider as ExpressP11ScopeProvider;
    const nameProvider = ExpressP11.references.NameProvider;
    const typeContainer: ExpressP11TypeContainer = ExpressP11.validation.TypeContainer;

    const schemaOf = (node: EntityDefinition): string => AstUtils.getContainerOfType(node, isSchemaDefinition)?.name ?? "?";
    const qualified = (node: EntityDefinition): string => `${schemaOf(node)}.${node.name}`;

    const ancestorMemo = new Map<EntityDefinition, Set<EntityDefinition>>();
    const ancestorsOf = (entity: EntityDefinition): Set<EntityDefinition> => {
      const memo = ancestorMemo.get(entity);
      if (memo) return memo;
      const seen = new Set<EntityDefinition>([entity]);
      const queue = [entity];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const reference of current.types?.supertypes?.entities ?? []) {
          const target = reference.entity.ref;
          if (target && !seen.has(target)) {
            seen.add(target);
            queue.push(target);
          }
        }
      }
      seen.delete(entity);
      ancestorMemo.set(entity, seen);
      return seen;
    };
    const descendantMemo = new Map<EntityDefinition, Set<EntityDefinition>>();
    const descendantsOf = (entity: EntityDefinition): Set<EntityDefinition> => {
      const memo = descendantMemo.get(entity);
      if (memo) return memo;
      const set = new Set(typeContainer.getSubTypesFromDefinition(entity));
      descendantMemo.set(entity, set);
      return set;
    };
    const relationOf = (operands: EntityDefinition[], owner: EntityDefinition): Relation => {
      if (operands.includes(owner)) return "self";
      if (operands.some((o) => ancestorsOf(o).has(owner))) return "ancestor";
      if (operands.some((o) => descendantsOf(o).has(owner))) return "descendant";
      return "outside";
    };
    const operandKindOf = (type: ScopeType): Site["operandKind"] =>
      type === ScopeType.Entities ? "entities" : type === ScopeType.Entity ? "entity" : type === ScopeType.Enums ? "enums" : "empty";

    const sites: Site[] = [];
    let documents = 0;
    for (const doc of shared.workspace.LangiumDocuments.all.toArray()) {
      const path = doc.uri.path;
      if (!path.startsWith(root!)) continue;
      documents += 1;
      const file = path.slice(root!.length + 1);
      for (const node of AstUtils.streamAllContents(doc.parseResult.value)) {
        if (isAttribute_qualifier(node)) {
          const position = node.target.$refNode?.range.start ?? node.$cstNode?.range.start;
          const operandInfo = scopeProvider.getQualifierOperand(node);
          const operandEntities = (operandInfo?.nodes ?? []).filter(isEntityDefinition);
          const ref = node.target.ref;
          const site: Site = {
            file,
            line: (position?.line ?? -1) + 1,
            col: (position?.character ?? -1) + 1,
            kind: "attr",
            name: node.target.$refText,
            operandKind: operandKindOf(operandInfo?.type ?? ScopeType.Empty),
            operand: operandEntities.map(qualified),
            target: null,
            relation: "unresolved",
            nodeMismatch: operandEntities.some((e) => typeContainer.getExpressP11EntityFrom(e)?.getNode() !== e),
          };
          if (ref && isAttribute_decl(ref)) {
            const owner = AstUtils.getContainerOfType(ref, isEntityDefinition);
            if (owner) {
              site.target = { schema: schemaOf(owner), entity: owner.name, attribute: nameProvider.getName(ref) ?? node.target.$refText, explicit: isExplicit_attr(ref.$container) };
              if (site.operandKind === "entity") site.relation = operandEntities.includes(owner) ? "own" : "outside";
              else site.relation = relationOf(operandEntities, owner);
            }
          } else if (ref) {
            site.relation = "enum";
          }
          sites.push(site);
        }
        if (isInverse_attr(node)) {
          const position = node.forAttribute.$refNode?.range.start ?? node.$cstNode?.range.start;
          const referencing = node.forEntity?.ref ?? node.type.ref;
          const operandEntities = referencing ? [referencing] : [];
          const ref = node.forAttribute.ref;
          const site: Site = {
            file,
            line: (position?.line ?? -1) + 1,
            col: (position?.character ?? -1) + 1,
            kind: "inverse",
            name: `${node.forEntity ? `${node.forEntity.$refText}.` : ""}${node.forAttribute.$refText}`,
            operandKind: node.forEntity ? "entity" : "entities",
            operand: operandEntities.map(qualified),
            target: null,
            relation: "unresolved",
            nodeMismatch: operandEntities.some((e) => typeContainer.getExpressP11EntityFrom(e)?.getNode() !== e),
          };
          if (ref && isAttribute_decl(ref)) {
            const owner = AstUtils.getContainerOfType(ref, isEntityDefinition);
            if (owner) {
              site.target = { schema: schemaOf(owner), entity: owner.name, attribute: nameProvider.getName(ref) ?? node.forAttribute.$refText, explicit: isExplicit_attr(ref.$container) };
              site.relation = node.forEntity ? (operandEntities.includes(owner) ? "own" : "outside") : relationOf(operandEntities, owner);
            }
          }
          sites.push(site);
        }
      }
    }
    sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
    const counts: Record<string, number> = {};
    for (const site of sites) {
      const key = `${site.kind}:${site.relation}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    writeFileSync(
      out!,
      `${JSON.stringify({ tool: "expresssuite", version: pkg.version, root, settings, elapsedMs: Date.now() - started, documents, siteCount: sites.length, counts, sites }, null, 1)}\n`
    );
    console.log(`link census: ${documents} documents, ${sites.length} sites, ${JSON.stringify(counts)}, ${Math.round((Date.now() - started) / 1000)} s -> ${out}`);
  }, 3600000);
});
