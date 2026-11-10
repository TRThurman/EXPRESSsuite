import { AstUtils, GrammarUtils } from "langium";
import type { LangiumDocument, LangiumDocuments, NameProvider } from "langium";
import type { Lexer } from "langium";
import type { TextEdit } from "vscode-languageserver";
import { isExplicit_attr, isExpressFile } from "../generated/ast.js";
import type { ExpressFile, SchemaDefinition } from "../generated/ast.js";
import type { ExpressP11Services } from "../express-module.js";
import type { ExpressP11TypeContainer } from "../express-p11-type-container.js";
import { annotationContexts } from "./blocks.js";
import type { AnnotationBlock, AnnotationContext } from "./blocks.js";
import { checkBlock, OPTIONAL_SENTENCE } from "./check.js";
import type { BlockFinding } from "./check.js";
import { annotationKeyOf, describeTargets } from "./keys.js";
import type { DescribeTarget } from "./keys.js";
import { LinkResolver } from "./link-resolver.js";
import { applyLinks, linkProposals } from "./proposals.js";
import type { LinkProposal } from "./proposals.js";

export type DescribeSource = { kind: "selection"; start: number; end: number } | { kind: "typed" } | { kind: "clipboard" };
export type BlockRole = "description" | "note" | "example";

export interface MemberText {
  key: string;
  text: string;
  accepted: LinkProposal[];
}

export interface DescribeRequest {
  uri: string;
  version: number;
  key: string;
  role: BlockRole;
  text: string;
  accepted: LinkProposal[];
  members: MemberText[];
  mode: "new" | "append" | "replace";
  source: DescribeSource;
}

export interface DescribeTargetsResult {
  version: number;
  targets: DescribeTarget[];
  defaultKey?: string;
  existing: string[];
  /** Why a non-empty selection cannot be the source, by the rule the edit applies (ruling R14). */
  sourceRefusal?: string;
}

export interface DescribeEditResult {
  edits: TextEdit[];
  findings: BlockFinding[];
  refused?: string;
}

const ROLE_SUFFIX: Readonly<Record<BlockRole, string>> = { description: "", note: ".__note", example: ".__example" };
/** Line breaks between two blocks when the context shows none to copy: two blank lines. */
const DEFAULT_SEPARATOR_BREAKS = 3;

const NOT_A_COMMENT = "The selection is not wholly inside one (* *) remark or a run of consecutive -- lines.";

/** A change by offsets into the document text. */
export interface OffsetEdit {
  start: number;
  end: number;
  newText: string;
}

interface Comment {
  start: number;
  end: number;
  kind: "remark" | "tail";
}

/** One block the request writes: created, or an existing one appended to or replaced. */
interface BlockWrite {
  target: DescribeTarget;
  key: string;
  body: string;
  action: "new" | "append" | "replace";
  block?: AnnotationBlock;
  role: BlockRole;
}

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

/**
 * Server side of "Describe Declaration": the targets a describe step can fill, link proposals
 * for the author's text, and the edits that write the blocks and remove the used source text.
 */
export class DescribeService {
  private readonly documents: LangiumDocuments;
  private readonly typeContainer: ExpressP11TypeContainer;
  private readonly nameProvider: NameProvider;
  private readonly lexer: Lexer;

  constructor(services: ExpressP11Services) {
    this.documents = services.shared.workspace.LangiumDocuments;
    this.typeContainer = services.validation.TypeContainer;
    this.nameProvider = services.references.NameProvider;
    this.lexer = services.parser.Lexer;
  }

  targets(uri: string, start: number, end: number): DescribeTargetsResult {
    const document = this.find(uri);
    if (!document) return { version: -1, targets: [], existing: [] };
    const text = document.textDocument.getText();
    const result: DescribeTargetsResult = { version: document.textDocument.version, targets: [], existing: [] };
    const root = document.parseResult.value;
    // A document with no schema parses to a root without the list.
    if (isExpressFile(root) && root.schemas?.length) {
      result.targets = describeTargets(root, this.nameProvider);
      result.existing = existingKeys(result.targets, annotationContexts(root, text));
      const defaultKey = defaultTargetKey(root, result.targets, start, end, this.nameProvider);
      if (defaultKey) result.defaultKey = defaultKey;
    }
    if (start < end) {
      const refusal = this.sourceRefusal(text, start, end);
      if (refusal) result.sourceRefusal = refusal;
    }
    return result;
  }

  /** The refusal the edit would give for removing the selection [start, end) as its source; undefined when it can be removed. */
  private sourceRefusal(text: string, start: number, end: number): string | undefined {
    try {
      selectionRemoval(text, commentsOf(this.lexer, text), start, end);
      return undefined;
    } catch (error) {
      if (error instanceof Refusal) return error.message;
      throw error;
    }
  }

  proposals(uri: string, key: string, text: string): LinkProposal[] {
    const document = this.find(uri);
    const root = document?.parseResult.value;
    if (!isExpressFile(root) || !root.schemas?.length) return [];
    const target = findTarget(describeTargets(root, this.nameProvider), key);
    const schema = target && root.schemas.find((candidate) => candidate.name === target.schema);
    if (!target || !schema) return [];
    return this.propose(text, target, schema);
  }

  edit(request: DescribeRequest): DescribeEditResult {
    try {
      return this.computeEdit(request);
    } catch (error) {
      if (error instanceof Refusal) return { edits: [], findings: [], refused: error.message };
      throw error;
    }
  }

  private computeEdit(request: DescribeRequest): DescribeEditResult {
    const document = this.find(request.uri) ?? refuse("The document is not open in the language server.");
    if (document.textDocument.version !== request.version) {
      refuse("The document has changed since the targets were read; run the command again.");
    }
    const text = document.textDocument.getText();
    const root = document.parseResult.value;
    if (!isExpressFile(root) || !root.schemas?.length || root.$cstNode?.root.fullText !== text) {
      refuse("The document is being rebuilt; run the command again.");
    }
    const targets = describeTargets(root, this.nameProvider);
    const target = findTarget(targets, request.key) ?? refuse(`"${request.key}" is not a declaration of this file that can be described.`);
    if (request.text.trim() === "") refuse("The text is empty.");
    const members = memberTexts(request, target, targets);

    const schema = root.schemas.find((candidate) => candidate.name === target.schema) ?? refuse(`The schema "${target.schema}" is not in this file.`);
    const context = annotationContexts(root, text).find((candidate) => candidate.schema === target.schema);
    if (!context || !endsWithEndSchema(text, context.start)) refuse(`The schema "${target.schema}" does not end with END_SCHEMA;.`);
    const eol = lineEnding(text);

    const writes: BlockWrite[] = [];
    const plan = (write: Omit<BlockWrite, "action" | "block">, owner: boolean): void => {
      const block = firstBlock(context, write.key);
      const action = writeAction(request.mode, write.key, block !== undefined, owner);
      if (block && !isOneRemark(text.slice(block.start, block.end))) refuse(`The block "${block.key}" is not closed with *).`);
      if (!isOneRemark(`(*${eol}${write.body}${eol}*)`)) refuse(`The text for "${write.key}" has an unmatched (* or *).`);
      writes.push({ ...write, action, block });
    };
    plan({ target, key: target.key + ROLE_SUFFIX[request.role], body: this.body(request.text, request.accepted, target, request.role, schema, eol), role: request.role }, true);
    for (const { member, text: memberText } of members) {
      plan({ target: member, key: member.key, body: this.body(memberText.text, memberText.accepted, member, "description", schema, eol), role: "description" }, false);
    }

    const edits: OffsetEdit[] = [];
    for (const write of writes) {
      if (write.action === "append") edits.push(appendEdit(text, write.block!, write.body, eol, keptOnAppend(write)));
      if (write.action === "replace") edits.push(replaceEdit(text, write.block!, write.body, eol));
    }
    edits.push(...placeNewBlocks(writes.filter((write) => write.action === "new"), targets, context, text, eol));

    if (request.source.kind === "selection") {
      const { start, end } = request.source;
      const comments = commentsOf(this.lexer, text);
      const remark = sourceRemark(comments, start, end);
      if (remark && writes.some((write) => write.block && write.block.start === remark.start && write.block.end === remark.end)) {
        refuse("The selection lies in the block being written.");
      }
      edits.push(...selectionRemoval(text, comments, start, end));
    }

    const sorted = sortedWithoutOverlap(edits);
    const resolver = this.resolver();
    const findings = writes.flatMap((write) =>
      checkBlock({ key: write.key, body: finalBody(write, eol) }, write.role === "description" ? write.target : undefined, resolver)
    );
    const textDocument = document.textDocument;
    return {
      edits: sorted.map((edit) => ({
        range: { start: textDocument.positionAt(edit.start), end: textDocument.positionAt(edit.end) },
        newText: edit.newText,
      })),
      findings,
    };
  }

  /** The block body for `text`: links applied as ruling R2 says, the OPTIONAL sentence, the document's line endings. */
  private body(text: string, accepted: ReadonlyArray<LinkProposal>, target: DescribeTarget, role: BlockRole, schema: SchemaDefinition, eol: string): string {
    const spans = acceptedSpans(this.propose(text, target, schema), accepted);
    let body = applyLinks(text, spans).trim();
    if (role === "description" && target.kind === "explicit-attribute" && target.optional && !body.endsWith(OPTIONAL_SENTENCE)) {
      body = `${body} ${OPTIONAL_SENTENCE}`;
    }
    return body.replace(/\r\n|\r|\n/g, eol);
  }

  private propose(text: string, target: DescribeTarget, schema: SchemaDefinition): LinkProposal[] {
    const visible = this.typeContainer
      .getScopeIndex()
      .visibleIn(schema)
      .map((arrival) => arrival.effectiveName);
    return linkProposals(text, target, schema, this.resolver(), visible);
  }

  private resolver(): LinkResolver {
    return new LinkResolver(this.typeContainer.getScopeIndex(), this.nameProvider);
  }

  private find(uri: string): LangiumDocument<ExpressFile> | undefined {
    return this.documents.all.find((candidate) => candidate.uri.toString() === uri) as LangiumDocument<ExpressFile> | undefined;
  }
}

// ---------------------------------------------------------------- request shape

const ROLES: ReadonlySet<string> = new Set(["description", "note", "example"]);
const MODES: ReadonlySet<string> = new Set(["new", "append", "replace"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOffset(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isSpan(value: unknown): boolean {
  return isRecord(value) && isOffset(value.start) && isOffset(value.end) && typeof value.name === "string";
}

function isSource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "typed" || value.kind === "clipboard") return true;
  return value.kind === "selection" && isOffset(value.start) && isOffset(value.end);
}

/** Whether `value` has the shape of a {@link DescribeRequest}, as received from the client. */
export function isDescribeRequest(value: unknown): value is DescribeRequest {
  if (!isRecord(value)) return false;
  const { uri, version, key, role, text, accepted, members, mode, source } = value;
  return (
    typeof uri === "string" &&
    Number.isInteger(version) &&
    typeof key === "string" &&
    typeof role === "string" &&
    ROLES.has(role) &&
    typeof text === "string" &&
    Array.isArray(accepted) &&
    accepted.every(isSpan) &&
    Array.isArray(members) &&
    members.every(
      (member) => isRecord(member) && typeof member.key === "string" && typeof member.text === "string" && Array.isArray(member.accepted) && member.accepted.every(isSpan)
    ) &&
    typeof mode === "string" &&
    MODES.has(mode) &&
    isSource(source)
  );
}

// ---------------------------------------------------------------- targets

function findTarget(targets: ReadonlyArray<DescribeTarget>, key: string): DescribeTarget | undefined {
  const lower = key.toLowerCase();
  return targets.find((target) => target.key.toLowerCase() === lower);
}

/** Keys, in each target's spelling and with role suffixes, that already have a block in their schema's context. */
function existingKeys(targets: ReadonlyArray<DescribeTarget>, contexts: ReadonlyArray<AnnotationContext>): string[] {
  const keysBySchema = new Map<string, Set<string>>();
  for (const context of contexts) keysBySchema.set(context.schema, new Set(context.blocks.map((block) => block.key.toLowerCase())));
  const existing: string[] = [];
  for (const target of targets) {
    const keys = keysBySchema.get(target.schema);
    if (!keys) continue;
    for (const suffix of Object.values(ROLE_SUFFIX)) {
      if (keys.has((target.key + suffix).toLowerCase())) existing.push(target.key + suffix);
    }
  }
  return existing;
}

/**
 * The default target for a selection or cursor [start, end]: the innermost member or declaration
 * containing it (an explicit attribute counts its whole declaration statement); else, in a schema,
 * the schema when on its `SCHEMA name;` head, the first declaration starting after the selection, or
 * the schema itself; outside every schema, the first target starting after the selection.
 */
export function defaultTargetKey(root: ExpressFile, targets: ReadonlyArray<DescribeTarget>, start: number, end: number, nameProvider: NameProvider): string | undefined {
  const contains = (from: number, to: number): boolean => from <= start && end <= to;
  const statements = explicitStatementRanges(root, nameProvider);
  let best: { key: string; size: number } | undefined;
  for (const target of targets) {
    if (target.kind === "schema") continue;
    let range: [number, number] | undefined = contains(target.start, target.end) ? [target.start, target.end] : undefined;
    const statement = statements.get(target.key.toLowerCase());
    if (!range && statement && contains(...statement)) range = statement;
    if (range && (!best || range[1] - range[0] < best.size)) best = { key: target.key, size: range[1] - range[0] };
  }
  if (best) return best.key;

  const schema = root.schemas.find((candidate) => candidate.$cstNode && contains(candidate.$cstNode.offset, candidate.$cstNode.end));
  if (!schema) return targets.find((target) => target.start >= end)?.key;
  const own = targets.find((target) => target.kind === "schema" && target.schema === schema.name);
  const head = GrammarUtils.findNodeForKeyword(schema.$cstNode, ";");
  if (head && contains(schema.$cstNode!.offset, head.end)) return own?.key;
  return targets.find((target) => target.kind !== "schema" && target.schema === schema.name && target.start >= end)?.key ?? own?.key;
}

/** Lower-case key of each explicit attribute to the range of its whole `a, b : T;` statement. */
function explicitStatementRanges(root: ExpressFile, nameProvider: NameProvider): Map<string, [number, number]> {
  const ranges = new Map<string, [number, number]>();
  for (const node of AstUtils.streamAst(root)) {
    if (!isExplicit_attr(node) || !node.$cstNode) continue;
    for (const attribute of node.attributes) {
      const key = annotationKeyOf(attribute, nameProvider);
      if (key) ranges.set(key.toLowerCase(), [node.$cstNode.offset, node.$cstNode.end]);
    }
  }
  return ranges;
}

// ---------------------------------------------------------------- what to write

/** The members of `target` with non-empty text, in member order, each checked against the target. */
function memberTexts(request: DescribeRequest, target: DescribeTarget, targets: ReadonlyArray<DescribeTarget>): Array<{ member: DescribeTarget; text: MemberText }> {
  const given = new Map<string, MemberText>();
  for (const member of request.members) {
    const lower = member.key.toLowerCase();
    if (!target.members?.some((key) => key.toLowerCase() === lower)) refuse(`"${member.key}" is not a parameter or item of "${target.key}".`);
    if (given.has(lower)) refuse(`"${member.key}" is given twice.`);
    given.set(lower, member);
  }
  const result: Array<{ member: DescribeTarget; text: MemberText }> = [];
  for (const key of target.members ?? []) {
    const text = given.get(key.toLowerCase());
    const member = findTarget(targets, key);
    if (text && member && text.text.trim() !== "") result.push({ member, text });
  }
  if (result.length > 0 && request.role !== "description") refuse("Parameter and item texts go only with a description.");
  return result;
}

function writeAction(mode: DescribeRequest["mode"], key: string, exists: boolean, owner: boolean): BlockWrite["action"] {
  if (mode === "new") {
    if (exists) refuse(`"${key}" already has a block; append to it or replace it.`);
    return "new";
  }
  if (!exists) {
    if (owner) refuse(`"${key}" has no block to ${mode === "append" ? "append to" : "replace"}.`);
    return "new";
  }
  return mode;
}

/** The recomputed proposals to apply: every auto and subject span, and the proposed spans the author ticked. */
export function acceptedSpans(recomputed: ReadonlyArray<LinkProposal>, ticked: ReadonlyArray<Pick<LinkProposal, "start" | "end" | "name">>): LinkProposal[] {
  const isTicked = (proposal: LinkProposal): boolean =>
    ticked.some((span) => span.start === proposal.start && span.end === proposal.end && span.name.toLowerCase() === proposal.name.toLowerCase());
  return recomputed.filter((proposal) => {
    if (proposal.status === "subject") return true;
    if (proposal.schema === undefined) return false;
    return proposal.status === "auto" || (proposal.status === "proposed" && isTicked(proposal));
  });
}

/**
 * The existing body an append keeps (ruling R7): for an OPTIONAL explicit attribute's description,
 * without the trailing mandatory sentence (and the whitespace before it: a space, a line break or a
 * blank line), since the new text brings it.
 */
function keptOnAppend(write: BlockWrite): string {
  const old = write.block?.body ?? "";
  if (write.role !== "description" || write.target.kind !== "explicit-attribute" || !write.target.optional) return old;
  if (old === OPTIONAL_SENTENCE) return "";
  if (old.endsWith(OPTIONAL_SENTENCE) && /\s$/.test(old.slice(0, -OPTIONAL_SENTENCE.length))) return old.slice(0, -OPTIONAL_SENTENCE.length).trimEnd();
  return old;
}

/** The body the block has once the edit is applied: what the check reads. */
function finalBody(write: BlockWrite, eol: string): string {
  const kept = write.action === "append" ? keptOnAppend(write) : "";
  return kept !== "" ? `${kept}${eol}${eol}${write.body}` : write.body;
}

// ---------------------------------------------------------------- blocks: placement, separators, append, replace

export function lineEnding(text: string): string {
  return /\r\n|\n|\r/.exec(text)?.[0] ?? "\n";
}

/** `(*"<key>"`, the body and `*)`, each on its own line. */
export function blockText(key: string, body: string, eol: string): string {
  return `(*"${key}"${eol}${body}${eol}*)`;
}

/** Whether `remark` is one `(* ... *)` remark that closes at its last character and not before. */
export function isOneRemark(remark: string): boolean {
  if (!remark.startsWith("(*")) return false;
  let depth = 0;
  let i = 0;
  while (i < remark.length) {
    if (remark.startsWith("(*", i)) {
      depth++;
      i += 2;
    } else if (remark.startsWith("*)", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i === remark.length;
    } else {
      i++;
    }
  }
  return false;
}

function endsWithEndSchema(text: string, offset: number): boolean {
  return /END_SCHEMA\s*;$/i.test(text.slice(Math.max(0, offset - 64), offset));
}

function bareKey(key: string): string {
  return key.toLowerCase().replace(/\.__[^.]*$/, "");
}

function firstBlock(context: AnnotationContext, key: string): AnnotationBlock | undefined {
  const lower = key.toLowerCase();
  return context.blocks.find((block) => block.key.toLowerCase() === lower);
}

/** The last block whose key, without a `.__` role suffix, is `key`. */
function lastBlockOf(context: AnnotationContext, key: string): AnnotationBlock | undefined {
  const lower = key.toLowerCase();
  let last: AnnotationBlock | undefined;
  for (const block of context.blocks) if (bareKey(block.key) === lower) last = block;
  return last;
}

/** Where a new block goes: after the line holding `END_SCHEMA;` (before its line break). */
export function endSchemaInsertion(context: AnnotationContext, text: string): number {
  let lineEnd = context.start;
  while (lineEnd < context.end && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") lineEnd++;
  const remarks = [...context.blocks, ...context.unkeyed];
  return remarks.some((remark) => remark.start < lineEnd) ? context.start : lineEnd;
}

/**
 * Insertion offset for a new block of `target`: after the last block of the same key; else after
 * the blocks of the nearest preceding target of the schema that has one (a member's owner precedes
 * it, and blocks this request creates count); else after the `END_SCHEMA;` line. Refuses an anchor
 * block that is not closed: its end is where the scan gave up, inside it.
 */
function anchorOffset(target: DescribeTarget, schemaTargets: ReadonlyArray<DescribeTarget>, context: AnnotationContext, created: ReadonlyMap<string, number>, text: string): number {
  const own = lastBlockOf(context, target.key);
  if (own) return closedEnd(own, text);
  const index = schemaTargets.indexOf(target);
  for (let i = index - 1; i >= 0; i--) {
    const previous = schemaTargets[i].key.toLowerCase();
    const pending = created.get(previous);
    if (pending !== undefined) return pending;
    const block = lastBlockOf(context, previous);
    if (block) return closedEnd(block, text);
  }
  return endSchemaInsertion(context, text);
}

function closedEnd(block: AnnotationBlock, text: string): number {
  if (!isOneRemark(text.slice(block.start, block.end))) refuse(`The block "${block.key}" is not closed with *).`);
  return block.end;
}

function lineBreakCount(gap: string): number {
  return gap.trim() === "" ? (gap.match(/\r\n|\r|\n/g) ?? []).length : 0;
}

/**
 * Line breaks to put before a block inserted at `offset`: those between the block ending there and
 * the next (or the previous) block; else the first such gap of the context; else two blank lines.
 */
export function separatorBreaks(context: AnnotationContext, offset: number, text: string): number {
  const blocks = context.blocks;
  const gap = (i: number): number => (i >= 0 && i + 1 < blocks.length ? lineBreakCount(text.slice(blocks[i].end, blocks[i + 1].start)) : 0);
  const at = blocks.findIndex((block) => block.end === offset);
  const candidates = at >= 0 ? [gap(at), gap(at - 1)] : [];
  for (let i = 0; i + 1 < blocks.length; i++) candidates.push(gap(i));
  return candidates.find((count) => count > 0) ?? DEFAULT_SEPARATOR_BREAKS;
}

/** One insertion per offset; the blocks at an offset are in document order, each after its separator. */
function placeNewBlocks(writes: ReadonlyArray<BlockWrite>, targets: ReadonlyArray<DescribeTarget>, context: AnnotationContext, text: string, eol: string): OffsetEdit[] {
  const schemaTargets = targets.filter((target) => target.schema === context.schema);
  const ordered = [...writes].sort((a, b) => schemaTargets.indexOf(a.target) - schemaTargets.indexOf(b.target));
  const created = new Map<string, number>();
  const groups = new Map<number, string[]>();
  for (const write of ordered) {
    const offset = anchorOffset(write.target, schemaTargets, context, created, text);
    created.set(write.target.key.toLowerCase(), offset);
    groups.set(offset, [...(groups.get(offset) ?? []), blockText(write.key, write.body, eol)]);
  }
  return [...groups].map(([offset, blocks]) => {
    const separator = eol.repeat(separatorBreaks(context, offset, text));
    return { start: offset, end: offset, newText: blocks.map((block) => separator + block).join("") };
  });
}

/** Start of the line holding the block's closing `*)` when nothing but blanks precede it there; else the `*)` itself. */
function closingLineStart(text: string, block: AnnotationBlock): number {
  const close = block.end - 2;
  let i = close;
  while (i > block.start && (text[i - 1] === " " || text[i - 1] === "\t")) i--;
  return text[i - 1] === "\n" || text[i - 1] === "\r" ? i : close;
}

/**
 * A blank line and `body` after the part `kept` of the existing body (a prefix of it; by default all
 * of it), before the closing `*)` line. Nothing kept is a replace.
 */
export function appendEdit(text: string, block: AnnotationBlock, body: string, eol: string, kept: string = block.body): OffsetEdit {
  if (kept === "") return replaceEdit(text, block, body, eol);
  return { start: block.bodyStart + kept.length, end: closingLineStart(text, block), newText: `${eol}${eol}${body}${eol}` };
}

/** `body` in place of the whole existing body, between the key line and the closing `*)` line. */
export function replaceEdit(text: string, block: AnnotationBlock, body: string, eol: string): OffsetEdit {
  return { start: block.keyEnd + 1, end: closingLineStart(text, block), newText: `${eol}${body}${eol}` };
}

// ---------------------------------------------------------------- removal of the source selection

function commentsOf(lexer: Lexer, text: string): Comment[] {
  const comments: Comment[] = [];
  for (const token of lexer.tokenize(text).hidden) {
    const kind = token.tokenType.name === "ML_COMMENT" ? "remark" : token.tokenType.name === "SL_COMMENT" ? "tail" : undefined;
    if (kind) comments.push({ start: token.startOffset, end: token.startOffset + token.image.length, kind });
  }
  return comments;
}

function sourceRemark(comments: ReadonlyArray<Comment>, start: number, end: number): Comment | undefined {
  return comments.find((comment) => comment.kind === "remark" && comment.start <= start && end <= comment.end);
}

function lineStartOf(text: string, offset: number): number {
  let i = offset;
  while (i > 0 && text[i - 1] !== "\n" && text[i - 1] !== "\r") i--;
  return i;
}

function lineEndOf(text: string, offset: number): number {
  let i = offset;
  while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
  return i;
}

/** Offset just past the line break at `lineEnd` (itself at the end of the text). */
function pastLineBreak(text: string, lineEnd: number): number {
  if (text.startsWith("\r\n", lineEnd)) return lineEnd + 2;
  return lineEnd < text.length ? lineEnd + 1 : lineEnd;
}

function isBlank(text: string): boolean {
  return text.trim() === "";
}

function blanksBefore(text: string, offset: number, limit: number): number {
  let i = offset;
  while (i > limit && (text[i - 1] === " " || text[i - 1] === "\t")) i--;
  return i;
}

function blanksAfter(text: string, offset: number, limit: number): number {
  let i = offset;
  while (i < limit && (text[i] === " " || text[i] === "\t")) i++;
  return i;
}

/**
 * The edits removing the selected source text; refuses a selection that is not wholly inside one
 * `(* *)` remark or a run of consecutive `--` lines.
 */
function selectionRemoval(text: string, comments: ReadonlyArray<Comment>, start: number, end: number): OffsetEdit[] {
  if (start >= end || end > text.length) refuse("The selection is empty or outside the document.");
  const remark = sourceRemark(comments, start, end);
  if (remark) return remarkRemoval(text, remark, start, end);
  return tailRemoval(text, comments, start, end) ?? refuse(NOT_A_COMMENT);
}

/** A `(* *)` remark in full, with its line when nothing else is on it; the blanks that separated it go too. */
export function wholeRemarkRemoval(text: string, remark: { start: number; end: number }): OffsetEdit {
  const lineStart = lineStartOf(text, remark.start);
  const lineEnd = lineEndOf(text, remark.end);
  const before = text.slice(lineStart, remark.start);
  const after = text.slice(remark.end, lineEnd);
  if (isBlank(before) && isBlank(after)) return { start: lineStart, end: pastLineBreak(text, lineEnd), newText: "" };
  if (isBlank(after)) return { start: blanksBefore(text, remark.start, lineStart), end: lineEnd, newText: "" };
  if (isBlank(before) || /[ \t]$/.test(before)) return { start: remark.start, end: blanksAfter(text, remark.end, lineEnd), newText: "" };
  // Code on both sides and no blank between: keep the two tokens apart.
  return { start: remark.start, end: remark.end, newText: /^[ \t]/.test(after) ? "" : " " };
}

/** The selected characters inside the remark's delimiters; the whole remark when nothing but blanks would be left. */
function remarkRemoval(text: string, remark: Comment, start: number, end: number): OffsetEdit[] {
  if (start <= remark.start && end >= remark.end) return [wholeRemarkRemoval(text, remark)];
  const from = Math.max(start, remark.start + 2);
  const to = Math.min(end, remark.end - 2);
  if (from >= to) return [];
  const left = text.slice(remark.start, from) + text.slice(to, remark.end);
  if (!isOneRemark(left)) refuse("Removing the selection would break its remark.");
  if (isBlank(left.slice(2, -2))) return [wholeRemarkRemoval(text, remark)];
  return [{ start: from, end: to, newText: "" }];
}

/**
 * The selected comment text of each `--` line of the run; a line left with only `--` and blanks goes
 * whole, or loses its `--` when code precedes it. `undefined` when the selection is not such a run.
 */
function tailRemoval(text: string, comments: ReadonlyArray<Comment>, start: number, end: number): OffsetEdit[] | undefined {
  const tails = comments.filter((comment) => comment.kind === "tail");
  const selected = tails.filter((tail) => tail.start < end && tail.end > start);
  let first = -1;
  let last = -1;
  for (let i = start; i < end; i++) {
    const c = text[i];
    if (c !== "\n" && c !== "\r") {
      if (first < 0) first = i;
      last = i;
    }
    if (!/\s/.test(c) && !selected.some((tail) => tail.start <= i && i < tail.end)) return undefined;
  }
  if (first < 0) return undefined;

  const removals: Array<[number, number]> = [];
  let lineStart = lineStartOf(text, first);
  while (lineStart <= last) {
    const lineEnd = lineEndOf(text, lineStart);
    const tail = tails.find((comment) => comment.start >= lineStart && comment.start <= lineEnd);
    if (!tail) return undefined;
    removals.push(...tailLineRemoval(text, tail, lineStart, lineEnd, start, end));
    const next = pastLineBreak(text, lineEnd);
    if (next === lineEnd) break;
    lineStart = next;
  }
  return mergeRanges(removals).map(([from, to]) => ({ start: from, end: to, newText: "" }));
}

function tailLineRemoval(text: string, tail: Comment, lineStart: number, lineEnd: number, start: number, end: number): Array<[number, number]> {
  const textStart = tail.start + 2;
  const from = Math.max(start, textStart);
  const to = Math.min(end, tail.end);
  if (from >= to) return [];
  const left = text.slice(textStart, from) + text.slice(to, tail.end);
  if (isBlank(left)) {
    if (isBlank(text.slice(lineStart, tail.start))) return [[lineStart, pastLineBreak(text, lineEnd)]];
    return [[blanksBefore(text, tail.start, lineStart), tail.end]];
  }
  return [[to === tail.end ? blanksBefore(text, from, textStart) : from, to]];
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const previous = merged[merged.length - 1];
    if (previous && from <= previous[1]) previous[1] = Math.max(previous[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

// ---------------------------------------------------------------- the edit set

/** Sorted by position, an insertion before a removal at the same offset; refuses edits that overlap. */
function sortedWithoutOverlap(edits: ReadonlyArray<OffsetEdit>): OffsetEdit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const sameInsertion = previous.start === previous.end && current.start === current.end && current.start === previous.start;
    if (current.start < previous.end || sameInsertion) refuse("The selection overlaps the text being written.");
  }
  return sorted;
}
