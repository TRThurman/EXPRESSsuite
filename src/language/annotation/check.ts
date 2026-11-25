import { CstUtils } from "langium";
import type { LangiumDocument, NameProvider } from "langium";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic } from "vscode-languageserver";
import { isExpressFile } from "../generated/ast.js";
import type { ExpressFile } from "../generated/ast.js";
import { isLongFormSchemaName } from "../express-p11-scope-index.js";
import { isInformalPropositionKey } from "../informal-proposition-validator.js";
import { annotationContexts, findExpressLinks, firstSentenceEnd } from "./blocks.js";
import { declaredKeys, describeTargets } from "./keys.js";
import type { DescribeTarget } from "./keys.js";
import type { LinkResolver } from "./link-resolver.js";
import { publicationFindings } from "./publication.js";

export enum AnnotationIssues {
  LinkUndeclared = "annotation-link-undeclared",
  LinkUnverified = "annotation-link-unverified",
  LinkSpace = "annotation-link-space",
  SelfLink = "annotation-self-link",
  OrphanKey = "annotation-orphan-key",
  DuplicateKey = "annotation-duplicate-key",
  UnkeyedRemark = "annotation-unkeyed-remark",
  NonAscii = "annotation-non-ascii",
  FirstSentenceAttributeLink = "annotation-first-sentence-attribute-link",
  OptionalSentence = "annotation-optional-sentence",
  BareSubtype = "annotation-bare-subtype",
  InsideSchema = "annotation-inside-schema",
  ContinuationWithoutList = "annotation-continuation-without-list",
  GluedContinuation = "annotation-glued-continuation",
  BlockMacroInline = "annotation-block-macro-inline",
  OpenBlockDelimiter = "annotation-open-block-delimiter",
  ListChainMacro = "annotation-list-chain-macro",
}

export const OPTIONAL_SENTENCE = "The value of this attribute need not be specified.";

/**
 * The last sentence of the body says that the value need not be given: the standard sentence, or
 * another that ends "need not be specified | supplied | provided | given | present | populated"
 * (also "does not need to be ..."), in any case. The check asks for this statement, not for one
 * wording of it.
 */
const OPTIONAL_STATEMENT_RE = /\b(?:need not be|does not need to be|do not need to be)\s+(?:specified|supplied|provided|given|present|populated)\s*[.!]?$/i;

export function endsWithOptionalStatement(body: string): boolean {
  return OPTIONAL_STATEMENT_RE.test(body.trimEnd());
}

export interface BlockFinding {
  code: AnnotationIssues;
  /** Offsets in the body. */
  start: number;
  end: number;
  message: string;
  severity: "warning" | "information";
  /** An unambiguous correction: replace `start`..`end` (offsets in the body) with `newText`. */
  fix?: { title: string; start: number; end: number; newText: string };
}

export interface CheckOptions {
  /** Class B rules, for constructs the publication toolchain mishandles (setting `expresssuite.annotations.publicationHazards`; default on). */
  publicationHazards?: boolean;
  /** The 1-based line of the file the body starts on, for messages that name lines. */
  firstLine?: number;
}

const SPACE_LINK_RE = /<<express:([^,>]*\s[^,>]*)(?:,[^>]*)?>>/g;
const BARE_SUBTYPE_RE = /^An? \*\*\w+\*\* is a type of <<express:[^>]+>>\.$/i;

function finding(code: AnnotationIssues, start: number, end: number, message: string): BlockFinding {
  return { code, start, end, message, severity: code === AnnotationIssues.LinkUnverified ? "information" : "warning" };
}

/** Findings for one block's body; `target` is what its key describes, when anything. */
export function checkBlock(
  block: { key: string; body: string },
  target: DescribeTarget | undefined,
  resolver: LinkResolver,
  options: CheckOptions = {}
): BlockFinding[] {
  const { key, body } = block;
  const findings: BlockFinding[] = [];

  for (const m of body.matchAll(SPACE_LINK_RE)) {
    findings.push(finding(AnnotationIssues.LinkSpace, m.index, m.index + m[0].length, `Link target "${m[1]}" contains a space.`));
  }

  const selfTarget = key.toLowerCase();
  for (const link of findExpressLinks(body)) {
    if (link.target.toLowerCase() === selfTarget) {
      findings.push(finding(AnnotationIssues.SelfLink, link.start, link.end, `The description links to its own subject "${link.target}".`));
      continue;
    }
    switch (resolver.check(link.target)) {
      case "undeclared":
        findings.push(finding(AnnotationIssues.LinkUndeclared, link.start, link.end, `"${link.target}" is not declared in its schema.`));
        break;
      case "unknown-schema":
        findings.push(finding(AnnotationIssues.LinkUnverified, link.start, link.end, `The schema of "${link.target}" is not in the workspace; the link is not verified.`));
        break;
      case "unsupported":
        findings.push(finding(AnnotationIssues.LinkUnverified, link.start, link.end, `The shape of "${link.target}" cannot be verified.`));
        break;
      default:
        break;
    }
  }

  for (let i = 0; i < body.length; ) {
    const point = body.codePointAt(i)!;
    const width = point > 0xffff ? 2 : 1;
    if (point > 0x7e) {
      findings.push(finding(AnnotationIssues.NonAscii, i, i + width, `Non-ASCII character U+${point.toString(16).toUpperCase().padStart(4, "0")}.`));
    }
    i += width;
  }

  if (target) {
    if (target.key.split(".").length === 2) {
      const sentence = body.slice(0, firstSentenceEnd(body));
      for (const link of findExpressLinks(sentence)) {
        if (resolver.check(link.target) === "declared" && resolver.isAttributeTarget(link.target)) {
          findings.push(
            finding(AnnotationIssues.FirstSentenceAttributeLink, link.start, link.end, "The first sentence links an attribute; it should describe the declaration alone.")
          );
        }
      }
    }
    if (target.kind === "explicit-attribute" && target.optional && !endsWithOptionalStatement(body)) {
      findings.push(finding(AnnotationIssues.OptionalSentence, 0, body.length, `The description of an OPTIONAL attribute ends with a sentence that says the value need not be specified, such as "${OPTIONAL_SENTENCE}".`));
    }
    if (target.kind === "entity" && target.supertypes && target.supertypes.length > 0 && BARE_SUBTYPE_RE.test(body.replace(/\s+/g, " ").trim())) {
      findings.push(finding(AnnotationIssues.BareSubtype, 0, body.length, "The description only restates the supertype."));
    }
  }
  for (const f of publicationFindings(body, { hazards: options.publicationHazards ?? true, firstLine: options.firstLine })) {
    findings.push({ ...f, code: f.code as AnnotationIssues });
  }
  return findings;
}

export function validateAnnotations(
  document: LangiumDocument<ExpressFile>,
  resolver: LinkResolver,
  nameProvider: NameProvider,
  options: Pick<CheckOptions, "publicationHazards"> = {}
): Diagnostic[] {
  const root = document.parseResult.value;
  // A document with no schema parses to a root without the list.
  if (!isExpressFile(root) || !root.schemas?.length) return [];
  const text = document.textDocument.getText();
  const diagnostics: Diagnostic[] = [];
  const range = (start: number, end: number) => ({ start: document.textDocument.positionAt(start), end: document.textDocument.positionAt(end) });
  const report = (
    code: AnnotationIssues,
    start: number,
    end: number,
    message: string,
    severity: BlockFinding["severity"] = "warning",
    fix?: BlockFinding["fix"]
  ): void => {
    diagnostics.push({
      range: range(start, end),
      severity: severity === "information" ? DiagnosticSeverity.Information : DiagnosticSeverity.Warning,
      message,
      code,
      source: "EXPRESSsuite",
      // The quick fix of the diagnostic, read by the code action provider.
      ...(fix ? { data: { fix: { title: fix.title, newText: fix.newText, range: range(fix.start, fix.end) } } } : {}),
    });
  };
  reportBlocksInsideSchemas(root, report);
  const contexts = annotationContexts(root, text).filter((context) => !isLongFormSchemaName(context.schema));
  if (contexts.length === 0) return diagnostics;

  // Keys and targets serve only keyed blocks; a file whose contexts hold none skips collecting them.
  const keyed = contexts.some((context) => context.blocks.length > 0);
  const declared = keyed ? declaredKeys(root, nameProvider) : new Set<string>();
  const targets = new Map<string, DescribeTarget>();
  for (const target of keyed ? describeTargets(root, nameProvider) : []) {
    if (!targets.has(target.key.toLowerCase())) targets.set(target.key.toLowerCase(), target);
  }

  for (const context of contexts) {
    const seen = new Set<string>();
    for (const block of context.blocks) {
      const lower = block.key.toLowerCase();
      const bare = lower.replace(/\.__[^.]*$/, "");
      // Ruling R10: role blocks (`.__note`, `.__example`, `.__expressg`, ...) may repeat.
      if (bare === lower && seen.has(lower)) {
        report(AnnotationIssues.DuplicateKey, block.keyStart, block.keyEnd, `Another description block with key "${block.key}" precedes this one.`);
      }
      seen.add(lower);

      // Informal-proposition keys belong to the informal-proposition validator.
      if (!/\.wr:ip\d+$/.test(bare) && !isInformalPropositionKey(block.key) && !declared.has(bare)) {
        report(AnnotationIssues.OrphanKey, block.keyStart, block.keyEnd, `No declaration has the key "${block.key}"; the text would be published without a subject.`);
      } else if (!bare.startsWith(`${context.schema.toLowerCase()}.`) && bare !== context.schema.toLowerCase() && !isInformalPropositionKey(block.key) && !/\.wr:ip\d+$/.test(bare)) {
        // The block follows the END_SCHEMA of its own schema: another schema's key is printed in no listing (XS-PUB-005).
        report(AnnotationIssues.OrphanKey, block.keyStart, block.keyEnd, `The key "${block.key}" is qualified with another schema than ${context.schema}, after whose END_SCHEMA it stands; the text would be published without a subject.`);
      }

      const empty = block.body.length === 0;
      const firstLine = document.textDocument.positionAt(block.bodyStart).line + 1;
      for (const f of checkBlock(block, targets.get(lower), resolver, { ...options, firstLine })) {
        const fix = f.fix && { ...f.fix, start: block.bodyStart + f.fix.start, end: block.bodyStart + f.fix.end };
        report(f.code, block.bodyStart + (empty ? 0 : f.start), block.bodyStart + (empty ? 0 : f.end), f.message, f.severity, fix);
      }
    }
    for (const remark of context.unkeyed) {
      report(AnnotationIssues.UnkeyedRemark, remark.start, remark.end, "A remark after END_SCHEMA is published as documentation; keep working notes inside the schema as -- lines.");
    }
  }
  return diagnostics;
}

type Report = (code: AnnotationIssues, start: number, end: number, message: string) => void;

const KEYED_REMARK_RE = /^\(\*\s*"([^"\r\n]+)"/;

/** A keyed remark between a schema's head and its END_SCHEMA; is published nowhere sensible, so it is reported. */
function reportBlocksInsideSchemas(root: ExpressFile, report: Report): void {
  for (const schema of root.schemas) {
    if (!schema.$cstNode || !schema.name || isLongFormSchemaName(schema.name)) continue;
    for (const leaf of CstUtils.streamCst(schema.$cstNode)) {
      if (!leaf.hidden || (leaf as { tokenType?: { name?: string } }).tokenType?.name !== "ML_COMMENT") continue;
      const keyed = KEYED_REMARK_RE.exec(leaf.text);
      if (!keyed) continue;
      const keyStart = leaf.offset + keyed[0].length - 1 - keyed[1].length;
      report(
        AnnotationIssues.InsideSchema,
        keyStart,
        keyStart + keyed[1].length,
        `Description block "${keyed[1]}" is inside SCHEMA ${schema.name} ... END_SCHEMA; description blocks belong after END_SCHEMA;.`
      );
    }
  }
}
