import type { LangiumDocument } from "langium";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { Diagnostic } from "vscode-languageserver";
import {
  ExpressFile,
  SchemaDefinition,
  isEntityDefinition,
  isTypeDefinition,
} from "./generated/ast.js";

export enum InformalPropositionIssues {
  MissingSignature = "informal-proposition-missing-signature",
  MalformedSignature = "informal-proposition-malformed-signature",
  MisplacedSignature = "informal-proposition-misplaced-signature",
  MissingAnnotation = "informal-proposition-missing-annotation",
  MalformedAnnotationKey = "informal-proposition-malformed-annotation-key",
}

type Declaration = {
  schema: string;
  name: string;
  kind: "ENTITY" | "TYPE";
  start: number;
  end: number;
};

type Annotation = {
  schema: string;
  declaration: string;
  ip: string;
  malformed: boolean;
  keyStart: number;
  keyEnd: number;
};

type Signature = {
  ip: string;
  valid: boolean;
  start: number;
  end: number;
  misplaced: boolean;
  notLast: boolean;
  declaration?: Declaration;
};

const ANNOTATION_RE = /\(\*\s*"([^"\r\n]+)"[\s\S]*?\*\)/g;
const VALID_ANNOTATION_KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\.wr:(IP[0-9]+)$/;
const IP_LIKE_ANNOTATION_KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\.(?:wr:)?(IP[0-9]+)$/i;
const LINE_COMMENT_RE = /^[\t ]*--[^\r\n]*/gm;
const IP_LIKE_SIGNATURE_RE = /^\s*(IP[0-9]+)\b/i;
const VALID_SIGNATURE_RE = /^(IP[0-9]+):[\t ]*$/;

export function validateInformalPropositions(document: LangiumDocument<ExpressFile>): Diagnostic[] {
  const text = document.textDocument.getText();
  const declarations = getDeclarations(document.parseResult.value.schemas);
  const annotations = getAnnotations(text);
  const signatures = getSignatures(text, declarations);
  const diagnostics: Diagnostic[] = [];

  for (const annotation of annotations) {
    const declaration = findDeclaration(declarations, annotation.schema, annotation.declaration);
    if (annotation.malformed) {
      diagnostics.push(createDiagnostic(
        document,
        annotation.keyStart,
        annotation.keyEnd,
        DiagnosticSeverity.Error,
        `Informal proposition annotation key must be '${annotation.schema}.${annotation.declaration}.wr:${annotation.ip}'.`,
        InformalPropositionIssues.MalformedAnnotationKey,
      ));
    }
    if (!declaration) continue;
    const matchingSignature = signatures.find((signature) =>
      signature.declaration === declaration && signature.ip.toLowerCase() === annotation.ip.toLowerCase()
    );
    if (!matchingSignature) {
      diagnostics.push(createDiagnostic(
        document,
        annotation.keyStart,
        annotation.keyEnd,
        DiagnosticSeverity.Error,
        `${declaration.kind} '${declaration.name}' has annotation '${annotation.ip}' but is missing signature '--${annotation.ip}:'.`,
        InformalPropositionIssues.MissingSignature,
      ));
    }
  }

  for (const signature of signatures) {
    if (!signature.valid) {
      diagnostics.push(createDiagnostic(
        document,
        signature.start,
        signature.end,
        DiagnosticSeverity.Error,
        `Malformed informal proposition signature; use '--${signature.ip}:' with no space before the colon and no trailing text.`,
        InformalPropositionIssues.MalformedSignature,
      ));
    }
    if (signature.misplaced) {
      diagnostics.push(createDiagnostic(
        document,
        signature.start,
        signature.end,
        DiagnosticSeverity.Error,
        `Informal proposition signature '--${signature.ip}:' must be inside an ENTITY or TYPE before its END statement.`,
        InformalPropositionIssues.MisplacedSignature,
      ));
    }
    if (signature.notLast) {
      diagnostics.push(createDiagnostic(
        document,
        signature.start,
        signature.end,
        DiagnosticSeverity.Error,
        `Informal proposition signatures must be the last entries before END_${signature.declaration?.kind ?? "ENTITY"}.`,
        InformalPropositionIssues.MisplacedSignature,
      ));
    }
    if (!signature.declaration) continue;
    const hasAnnotation = annotations.some((annotation) =>
      annotation.ip.toLowerCase() === signature.ip.toLowerCase() &&
      annotation.schema.toLowerCase() === signature.declaration!.schema.toLowerCase() &&
      annotation.declaration.toLowerCase() === signature.declaration!.name.toLowerCase()
    );
    if (!hasAnnotation) {
      diagnostics.push(createDiagnostic(
        document,
        signature.start,
        signature.end,
        DiagnosticSeverity.Error,
        `Signature '--${signature.ip}:' has no matching '${signature.declaration.schema}.${signature.declaration.name}.wr:${signature.ip}' annotation block.`,
        InformalPropositionIssues.MissingAnnotation,
      ));
    }
  }

  return diagnostics;
}

function getDeclarations(schemas: SchemaDefinition[]): Declaration[] {
  const declarations: Declaration[] = [];
  for (const schema of schemas) {
    for (const node of schema.body.declarations) {
      if (!isEntityDefinition(node) && !isTypeDefinition(node)) continue;
      const cst = node.$cstNode;
      if (!cst) continue;
      declarations.push({
        schema: schema.name,
        name: node.name,
        kind: isEntityDefinition(node) ? "ENTITY" : "TYPE",
        start: cst.offset,
        end: cst.end,
      });
    }
  }
  return declarations;
}

function getAnnotations(text: string): Annotation[] {
  const annotations: Annotation[] = [];
  ANNOTATION_RE.lastIndex = 0;
  for (let match = ANNOTATION_RE.exec(text); match; match = ANNOTATION_RE.exec(text)) {
    const key = match[1].trim();
    const valid = VALID_ANNOTATION_KEY_RE.exec(key);
    const ipLike = valid ?? IP_LIKE_ANNOTATION_KEY_RE.exec(key);
    if (!ipLike) continue;
    const keyOffset = match.index + match[0].indexOf(match[1]);
    annotations.push({
      schema: ipLike[1],
      declaration: ipLike[2],
      ip: ipLike[3].toUpperCase(),
      malformed: !valid,
      keyStart: keyOffset,
      keyEnd: keyOffset + match[1].length,
    });
  }
  return annotations;
}

function getSignatures(text: string, declarations: Declaration[]): Signature[] {
  const signatures: Signature[] = [];
  const sourceWithoutBlockComments = maskBlockComments(text);
  LINE_COMMENT_RE.lastIndex = 0;
  for (let match = LINE_COMMENT_RE.exec(sourceWithoutBlockComments); match; match = LINE_COMMENT_RE.exec(sourceWithoutBlockComments)) {
    const markerOffset = match.index + match[0].indexOf("--");
    const content = match[0].slice(match[0].indexOf("--") + 2);
    const ipLike = IP_LIKE_SIGNATURE_RE.exec(content);
    if (!ipLike) continue;
    const valid = VALID_SIGNATURE_RE.exec(content);
    const ip = ipLike[1].toUpperCase();
    const containingDeclaration = declarations.find((candidate) => markerOffset >= candidate.start && markerOffset < candidate.end);
    const precedingDeclaration = containingDeclaration ? undefined : declarations
      .filter((candidate) => candidate.end <= markerOffset && /^\s*$/.test(sourceWithoutBlockComments.slice(candidate.end, markerOffset)))
      .sort((left, right) => right.end - left.end)[0];
    signatures.push({
      ip,
      valid: Boolean(valid),
      start: markerOffset,
      end: match.index + match[0].length,
      misplaced: !containingDeclaration,
      notLast: false,
      declaration: containingDeclaration ?? precedingDeclaration,
    });
  }
  for (const declaration of declarations) {
    const inside = signatures.filter((signature) => signature.declaration === declaration && !signature.misplaced);
    const last = inside.sort((left, right) => right.start - left.start)[0];
    if (!last) continue;
    const tail = sourceWithoutBlockComments.slice(last.end, declaration.end);
    const expectedEnd = new RegExp(`^\\s*END_${declaration.kind}\\s*;\\s*$`, "i");
    last.notLast = !expectedEnd.test(tail);
  }
  return signatures;
}

function maskBlockComments(text: string): string {
  return text.replace(/\(\*[\s\S]*?\*\)/g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function findDeclaration(declarations: Declaration[], schema: string, name: string): Declaration | undefined {
  return declarations.find((declaration) =>
    declaration.schema.toLowerCase() === schema.toLowerCase() && declaration.name.toLowerCase() === name.toLowerCase()
  );
}

function createDiagnostic(
  document: LangiumDocument,
  start: number,
  end: number,
  severity: DiagnosticSeverity,
  message: string,
  code: InformalPropositionIssues,
): Diagnostic {
  return {
    range: {
      start: document.textDocument.positionAt(start),
      end: document.textDocument.positionAt(end),
    },
    severity,
    message,
    code,
    source: "EXPRESSsuite",
  };
}
