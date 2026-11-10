import { AstUtils } from "langium";
import type { LangiumDocument, NameProvider } from "langium";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic } from "vscode-languageserver";
import { isExpressFile } from "../generated/ast.js";
import type { ExpressFile } from "../generated/ast.js";
import { isLongFormSchemaName } from "../express-p11-scope-index.js";
import { annotationContexts, findExpressLinks, firstSentenceEnd } from "./blocks.js";
import { annotationKeyOf, describeTargets } from "./keys.js";
import type { DescribeTarget } from "./keys.js";
import type { LinkResolver } from "./link-resolver.js";

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
}

export const OPTIONAL_SENTENCE = "The value of this attribute need not be specified.";

export interface BlockFinding {
  code: AnnotationIssues;
  /** Offsets in the body. */
  start: number;
  end: number;
  message: string;
  severity: "warning" | "information";
}

const SPACE_LINK_RE = /<<express:([^,>]*\s[^,>]*)(?:,[^>]*)?>>/g;
const BARE_SUBTYPE_RE = /^An? \*\*\w+\*\* is a type of <<express:[^>]+>>\.$/i;

function finding(code: AnnotationIssues, start: number, end: number, message: string): BlockFinding {
  return { code, start, end, message, severity: code === AnnotationIssues.LinkUnverified ? "information" : "warning" };
}

/** Findings for one block's body; `target` is what its key describes, when anything. */
export function checkBlock(block: { key: string; body: string }, target: DescribeTarget | undefined, resolver: LinkResolver): BlockFinding[] {
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
    if (target.kind === "explicit-attribute" && target.optional && !body.trimEnd().endsWith(OPTIONAL_SENTENCE)) {
      findings.push(finding(AnnotationIssues.OptionalSentence, 0, body.length, `The description of an OPTIONAL attribute ends with "${OPTIONAL_SENTENCE}".`));
    }
    if (target.kind === "entity" && target.supertypes && target.supertypes.length > 0 && BARE_SUBTYPE_RE.test(body.replace(/\s+/g, " ").trim())) {
      findings.push(finding(AnnotationIssues.BareSubtype, 0, body.length, "The description only restates the supertype."));
    }
  }
  return findings;
}

export function validateAnnotations(document: LangiumDocument<ExpressFile>, resolver: LinkResolver, nameProvider: NameProvider): Diagnostic[] {
  const root = document.parseResult.value;
  // A document with no schema parses to a root without the list.
  if (!isExpressFile(root) || !root.schemas?.length) return [];
  const text = document.textDocument.getText();
  const contexts = annotationContexts(root, text).filter((context) => !isLongFormSchemaName(context.schema));
  if (contexts.length === 0) return [];

  const declared = new Set<string>();
  for (const node of AstUtils.streamAst(root)) {
    const key = annotationKeyOf(node, nameProvider);
    if (key) declared.add(key.toLowerCase());
  }
  const targets = new Map<string, DescribeTarget>();
  for (const target of describeTargets(root, nameProvider)) {
    if (!targets.has(target.key.toLowerCase())) targets.set(target.key.toLowerCase(), target);
  }

  const diagnostics: Diagnostic[] = [];
  const report = (code: AnnotationIssues, start: number, end: number, message: string, severity: BlockFinding["severity"] = "warning"): void => {
    diagnostics.push({
      range: { start: document.textDocument.positionAt(start), end: document.textDocument.positionAt(end) },
      severity: severity === "information" ? DiagnosticSeverity.Information : DiagnosticSeverity.Warning,
      message,
      code,
      source: "EXPRESSsuite",
    });
  };

  for (const context of contexts) {
    const seen = new Set<string>();
    for (const block of context.blocks) {
      const lower = block.key.toLowerCase();
      if (seen.has(lower)) report(AnnotationIssues.DuplicateKey, block.keyStart, block.keyEnd, `Another description block with key "${block.key}" precedes this one.`);
      seen.add(lower);

      const bare = lower.replace(/\.__[^.]*$/, "");
      if (!/\.wr:ip\d+$/.test(bare) && !declared.has(bare)) {
        report(AnnotationIssues.OrphanKey, block.keyStart, block.keyEnd, `No declaration has the key "${block.key}"; the text would be published without a subject.`);
      }

      const empty = block.body.length === 0;
      for (const f of checkBlock(block, targets.get(lower), resolver)) {
        report(f.code, block.bodyStart + (empty ? 0 : f.start), block.bodyStart + (empty ? 0 : f.end), f.message, f.severity);
      }
    }
    for (const remark of context.unkeyed) {
      report(AnnotationIssues.UnkeyedRemark, remark.start, remark.end, "A remark after END_SCHEMA is published as documentation; keep working notes inside the schema as -- lines.");
    }
  }
  return diagnostics;
}
