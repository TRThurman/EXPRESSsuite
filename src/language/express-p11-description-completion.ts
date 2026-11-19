import type { AstNode, LangiumDocument, LangiumDocuments, NameProvider } from "langium";
import type { CompletionItem, CompletionList, Range } from "vscode-languageserver";
import { CompletionItemKind, InsertTextFormat } from "vscode-languageserver";
import { annotationContexts } from "./annotation/blocks.js";
import { completionSiteAt, inWords, ITEM_ROLES, SCHEMA_ROLES } from "./annotation/completion.js";
import type { CompletionSite } from "./annotation/completion.js";
import { pathSegments } from "./annotation/definition.js";
import { annotationKeyOf, keyedNodes, memberNamesOf } from "./annotation/keys.js";
import { nameParts } from "./annotation/references.js";
import type { ExpressP11Services } from "./express-module.js";
import type { ScopeDeclKind } from "./express-p11-scope-index.js";
import type { ExpressP11TypeContainer } from "./express-p11-type-container.js";
import type { ExpressFile, SchemaDefinition } from "./generated/ast.js";
import {
  isConstant_body,
  isDerived_attr,
  isDomain_rule,
  isEntityDefinition,
  isEnumeration_id,
  isExpressFile,
  isFunctionDefinition,
  isInverse_attr,
  isParameter_id,
  isProcedureDefinition,
  isRule_decl,
  isSchemaDefinition,
  isSubtypeConstraintDefinition,
  isTypeDefinition,
  isUnique_rule,
} from "./generated/ast.js";

/** A schema of the workspace: its node, its file, and the keys the file declares for it. */
interface LoadedSchema {
  schema: SchemaDefinition;
  root: ExpressFile;
  text: string;
}

/** A key with the node it names, spelled as the schema declares it. */
interface KeyEntry {
  key: string;
  node: AstNode;
}

const SCOPE_KINDS: Record<ScopeDeclKind, [CompletionItemKind, string]> = {
  ENTITY: [CompletionItemKind.Class, "Entity"],
  TYPE: [CompletionItemKind.Variable, "Type"],
  FUNCTION: [CompletionItemKind.Function, "Function"],
  PROCEDURE: [CompletionItemKind.Function, "Procedure"],
  RULE: [CompletionItemKind.Event, "Rule"],
  SUBTYPE_CONSTRAINT: [CompletionItemKind.Interface, "Subtype constraint"],
  CONSTANT: [CompletionItemKind.Constant, "Constant"],
};

/**
 * Type-ahead in the description blocks after `END_SCHEMA;`: the parts of a key, the target of an
 * `<<express:...>>` cross-reference, the bold subject, and, when asked for, the names a block may
 * mention. The grammar reads these blocks as remarks, so Langium's completion offers nothing there.
 */
export class DescriptionCompletion {
  private readonly documents: LangiumDocuments;
  private readonly nameProvider: NameProvider;
  private readonly typeContainer: ExpressP11TypeContainer;

  constructor(services: ExpressP11Services) {
    this.documents = services.shared.workspace.LangiumDocuments;
    this.nameProvider = services.references.NameProvider;
    this.typeContainer = services.validation.TypeContainer;
  }

  /**
   * What is offered at `offset`, or `undefined` when the offset is not in description text.
   * `asked`: the user asked for the list (Ctrl+Space); names in the running text are offered only then.
   */
  complete(document: LangiumDocument, offset: number, asked: boolean): CompletionList | undefined {
    const root = document.parseResult?.value;
    if (!isExpressFile(root) || !root.schemas?.length) return undefined;
    const text = document.textDocument.getText();
    const site = completionSiteAt(annotationContexts(root, text), text, offset);
    if (!site) return undefined;
    const range = (start: number, end: number): Range => ({ start: document.textDocument.positionAt(start), end: document.textDocument.positionAt(end) });
    const request = new Request(this.documents, this.nameProvider, this.typeContainer, document, range);
    let items: CompletionItem[];
    if (site.kind === "key") items = request.key(site);
    else if (site.kind === "link") items = request.link(site, offset);
    else if (site.kind === "bold") items = request.bold(site, offset);
    else items = asked ? request.word(site, offset) : [];
    return { isIncomplete: false, items };
  }
}

/** One request: the workspace as it is loaded now. */
class Request {
  private schemas: Map<string, LoadedSchema> | undefined;
  private readonly keys = new Map<ExpressFile, KeyEntry[]>();
  private readonly bodies = new Map<ExpressFile, Map<string, string>>();

  constructor(
    private readonly documents: LangiumDocuments,
    private readonly nameProvider: NameProvider,
    private readonly typeContainer: ExpressP11TypeContainer,
    private readonly from: LangiumDocument,
    private readonly range: (start: number, end: number) => Range,
  ) {}

  /** The parts of a key: the schema, then its declarations and roles, then an owner's members and roles. */
  key(site: Extract<CompletionSite, { kind: "key" }>): CompletionItem[] {
    const cut = lastSeparator(site.typed);
    const path = cut < 0 ? "" : site.typed.slice(0, cut);
    const at = this.range(site.start + cut + 1, site.partEnd);
    const own = this.schema(site.schema);
    if (!own) return [];
    if (!path) return [this.item(own.schema.name, at, CompletionItemKind.Module, "Schema", "0")];

    const segments = pathSegments(path).map((segment) => segment.text);
    // After the END_SCHEMA of a schema stand the keys of that schema only; nothing follows a role.
    if (segments[0].toLowerCase() !== own.schema.name.toLowerCase() || segments[segments.length - 1].startsWith("__")) return [];
    const described = this.bodiesOf(own);
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const offer = (label: string, kind: CompletionItemKind, detail: string, role: boolean): void => {
      if (seen.has(label.toLowerCase())) return;
      seen.add(label.toLowerCase());
      const body = described.get(`${path}.${label}`.toLowerCase());
      // The keys that have no block yet come first; the roles, which may repeat, come last.
      const item = this.item(label, at, kind, body !== undefined && !role ? `${detail}, described` : detail, role ? "2" : body !== undefined ? "1" : "0");
      if (body && !role) item.documentation = body;
      items.push(item);
    };
    const prefix = `${path.toLowerCase()}.`;
    for (const entry of this.keysOf(own)) {
      if (!entry.key.toLowerCase().startsWith(prefix)) continue;
      const next = pathSegments(entry.key.slice(prefix.length));
      if (next.length !== 1) continue;
      offer(next[0].text, ...kindOf(entry.node), false);
    }
    const owner = this.keysOf(own).find((entry) => entry.key.toLowerCase() === path.toLowerCase())?.node;
    if (segments.length === 2 && owner?.$cstNode) {
      // The informal propositions of the owner: its `--IPn:` lines.
      for (const line of owner.$cstNode.text.matchAll(/^[\t ]*--[\t ]*(IP[0-9]+)\b/gim)) offer(`wr:${line[1].toUpperCase()}`, CompletionItemKind.Event, "Informal proposition", false);
    }
    if (segments.length === 1 || owner) {
      for (const role of segments.length === 1 ? SCHEMA_ROLES : ITEM_ROLES) offer(role, CompletionItemKind.Keyword, "Role", true);
    }
    return items;
  }

  /** The target of a cross-reference: a schema, then one of its declarations, then one of an owner's members. */
  link(site: Extract<CompletionSite, { kind: "link" }>, offset: number): CompletionItem[] {
    const parts = site.typed.split(".");
    const at = this.range(offset - parts[parts.length - 1].length, site.partEnd);
    const own = this.schema(site.block.schema);
    const scopeIndex = this.typeContainer.getScopeIndex();
    const subject = pathSegments(site.block.key).filter((segment) => !segment.text.startsWith("__")).map((segment) => segment.text).join(".").toLowerCase();

    if (parts.length === 1) {
      const reached = new Set(own ? scopeIndex.visibleIn(own.schema).map((arrival) => arrival.decl.schema.toLowerCase()) : []);
      const items: CompletionItem[] = [];
      for (const [lower, loaded] of this.loaded()) {
        const order = lower === site.block.schema.toLowerCase() ? "0" : reached.has(lower) ? "1" : "2";
        const item = this.item(loaded.schema.name, at, CompletionItemKind.Module, order === "0" ? "This schema" : order === "1" ? "Schema, interfaced" : "Schema", order);
        item.textEdit = { range: at, newText: `${loaded.schema.name}.` };
        // The names of the schema follow at once.
        item.command = { title: "Suggest", command: "editor.action.triggerSuggest" };
        items.push(item);
      }
      return items;
    }

    const target = this.schema(parts[0]);
    if (!target) return [];
    const finish = (item: CompletionItem, name: string, written: string, whole: boolean): CompletionItem => {
      const edit = whole ? this.range(site.start, site.end) : at;
      if (site.closed) item.textEdit = { range: edit, newText: written };
      else if (site.mapping) item.textEdit = { range: edit, newText: `${written}>>; ` };
      else {
        // The display text is the name in words, selected so that it can be typed over.
        item.textEdit = { range: edit, newText: `${written},\${1:${inWords(name)}}>>` };
        item.insertTextFormat = InsertTextFormat.Snippet;
      }
      return item;
    };
    const described = this.bodiesOf(target);

    if (parts.length === 2) {
      const items: CompletionItem[] = [];
      const seen = new Set<string>();
      for (const arrival of scopeIndex.visibleIn(target.schema)) {
        const local = arrival.route.kind === "local";
        const full = `${arrival.decl.schema}.${arrival.decl.name}`;
        // A block does not refer to its own subject.
        if (full.toLowerCase() === subject || seen.has(full.toLowerCase())) continue;
        seen.add(full.toLowerCase());
        const [kind, detail] = SCOPE_KINDS[arrival.decl.kind];
        const item = this.item(arrival.decl.name, at, kind, local ? detail : `${detail}, declared in ${arrival.decl.schema}`, local ? "0" : "1");
        // A name that the schema reaches through an interface is written under the schema that declares it.
        item.filterText = local ? arrival.decl.name : `${site.typed.slice(0, site.typed.length - parts[1].length)}${arrival.decl.name}`;
        const body = local ? described.get(full.toLowerCase()) : undefined;
        if (body) item.documentation = body;
        items.push(finish(item, arrival.decl.name, local ? arrival.decl.name : full, !local));
      }
      return items;
    }

    if (parts.length === 3) {
      const owner = scopeIndex.localDeclaration(target.schema.name, parts[1]);
      if (!owner) return [];
      const members = memberNamesOf(owner.node, this.nameProvider);
      const prefix = `${target.schema.name}.${owner.name}.`.toLowerCase();
      const items: CompletionItem[] = [];
      for (const entry of this.keysOf(target)) {
        const lower = entry.key.toLowerCase();
        if (!lower.startsWith(prefix) || lower === subject) continue;
        const name = entry.key.slice(prefix.length);
        // Only what a cross-reference may name: attributes, enumeration items and parameters, by their plain name.
        if (!members.has(name.toLowerCase()) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) continue;
        const item = this.item(name, at, ...kindOf(entry.node), "0");
        const body = described.get(lower);
        if (body) item.documentation = body;
        items.push(finish(item, name, name, false));
      }
      return items;
    }
    return [];
  }

  /** After `**`: the name of the block's subject. */
  bold(site: Extract<CompletionSite, { kind: "bold" }>, offset: number): CompletionItem[] {
    const name = subjectName(site.block.key);
    if (!name) return [];
    const item = this.item(name, this.range(site.start, offset), CompletionItemKind.Text, "The subject of this block", "0");
    if (!site.closed) item.textEdit = { range: this.range(site.start, offset), newText: `${name}**` };
    return [item];
  }

  /** A name in the running text: the members of the block's subject, then what its schema declares and reaches. */
  word(site: Extract<CompletionSite, { kind: "word" }>, offset: number): CompletionItem[] {
    const own = this.schema(site.block.schema);
    if (!own) return [];
    const at = this.range(site.start, offset);
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    const offer = (name: string, kind: CompletionItemKind, detail: string, order: string): void => {
      if (seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());
      items.push(this.item(name, at, kind, detail, order));
    };
    const segments = pathSegments(site.block.key).map((segment) => segment.text);
    if (segments.length >= 2) {
      const prefix = `${segments[0]}.${segments[1]}.`.toLowerCase();
      for (const entry of this.keysOf(own)) {
        if (!entry.key.toLowerCase().startsWith(prefix)) continue;
        const name = subjectName(entry.key);
        if (name) offer(name, ...kindOf(entry.node), "0");
      }
    }
    for (const arrival of this.typeContainer.getScopeIndex().visibleIn(own.schema)) {
      const local = arrival.route.kind === "local";
      const [kind, detail] = SCOPE_KINDS[arrival.decl.kind];
      offer(arrival.effectiveName, kind, local ? detail : `${detail}, declared in ${arrival.decl.schema}`, local ? "1" : "2");
    }
    return items;
  }

  private item(label: string, range: Range, kind: CompletionItemKind, detail: string, sortText: string): CompletionItem {
    return { label, kind, detail, sortText: `${sortText}${label.toLowerCase()}`, filterText: label, textEdit: { range, newText: label } };
  }

  /** The loaded schemas by lower-case name; the file of the request before any other that declares the same name. */
  private loaded(): Map<string, LoadedSchema> {
    if (this.schemas) return this.schemas;
    const schemas = new Map<string, LoadedSchema>();
    const consider = (document: LangiumDocument): void => {
      const root = document.parseResult?.value;
      if (!isExpressFile(root)) return;
      let text: string | undefined;
      for (const schema of root.schemas ?? []) {
        const lower = schema.name?.toLowerCase();
        if (lower && !schemas.has(lower)) schemas.set(lower, { schema, root, text: (text ??= document.textDocument.getText()) });
      }
    };
    consider(this.from);
    for (const document of this.documents.all) if (document !== this.from) consider(document);
    return (this.schemas = schemas);
  }

  private schema(name: string): LoadedSchema | undefined {
    return this.loaded().get(name.toLowerCase());
  }

  /** The keys the file of `loaded` declares for that schema. */
  private keysOf(loaded: LoadedSchema): KeyEntry[] {
    let known = this.keys.get(loaded.root);
    if (!known) {
      known = [];
      for (const node of keyedNodes(loaded.root, this.nameProvider).values()) {
        const key = annotationKeyOf(node, this.nameProvider);
        if (key) known.push({ key, node });
      }
      this.keys.set(loaded.root, known);
    }
    const prefix = `${loaded.schema.name.toLowerCase()}.`;
    return known.filter((entry) => entry.key.toLowerCase().startsWith(prefix));
  }

  /** The text of the first description block of each key in the file of `loaded`, by lower-case key. */
  private bodiesOf(loaded: LoadedSchema): Map<string, string> {
    let known = this.bodies.get(loaded.root);
    if (!known) {
      known = new Map();
      for (const context of annotationContexts(loaded.root, loaded.text)) {
        for (const block of context.blocks) {
          const lower = block.key.toLowerCase();
          if (!known.has(lower)) known.set(lower, block.body);
        }
      }
      this.bodies.set(loaded.root, known);
    }
    return known;
  }
}

/** The offset of the dot that ends the last complete part of a key being typed; -1 when it has none. */
function lastSeparator(typed: string): number {
  const segments = pathSegments(typed);
  return segments.length < 2 ? -1 : segments[segments.length - 1].start - 1;
}

/** The name of what a key describes: its last part without roles, without `wr:`, `ur:` or `SELF\supertype.`. */
function subjectName(key: string): string | undefined {
  const segments = pathSegments(key).filter((segment) => !segment.text.startsWith("__"));
  const last = segments[segments.length - 1]?.text;
  if (!last) return undefined;
  const part = nameParts(last).filter((candidate) => !candidate.entity).pop();
  return part ? last.slice(part.start, part.end) : undefined;
}

function kindOf(node: AstNode): [CompletionItemKind, string] {
  if (isSchemaDefinition(node)) return [CompletionItemKind.Module, "Schema"];
  if (isEntityDefinition(node)) return SCOPE_KINDS.ENTITY;
  if (isTypeDefinition(node)) return SCOPE_KINDS.TYPE;
  if (isFunctionDefinition(node)) return SCOPE_KINDS.FUNCTION;
  if (isProcedureDefinition(node)) return SCOPE_KINDS.PROCEDURE;
  if (isRule_decl(node)) return SCOPE_KINDS.RULE;
  if (isSubtypeConstraintDefinition(node)) return SCOPE_KINDS.SUBTYPE_CONSTRAINT;
  if (isConstant_body(node)) return SCOPE_KINDS.CONSTANT;
  if (isDerived_attr(node)) return [CompletionItemKind.Property, "Derived attribute"];
  if (isInverse_attr(node)) return [CompletionItemKind.Property, "Inverse attribute"];
  if (isEnumeration_id(node)) return [CompletionItemKind.EnumMember, "Enumeration item"];
  if (isParameter_id(node)) return [CompletionItemKind.Variable, "Parameter"];
  if (isDomain_rule(node)) return [CompletionItemKind.Event, "WHERE rule"];
  if (isUnique_rule(node)) return [CompletionItemKind.Event, "UNIQUE rule"];
  return [CompletionItemKind.Property, "Attribute"];
}
