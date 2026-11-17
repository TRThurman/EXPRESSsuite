import { DocumentState, URI } from "langium";
import { startLanguageServer } from "langium/lsp";
import { NodeFileSystem } from "langium/node";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import type { CancellationToken } from "vscode-languageserver/node";
import { DescribeService, isDescribeRequest } from "./annotation/describe.js";
import type { DescribeEditResult } from "./annotation/describe.js";
import { createExpressP11Services } from "./express-module.js";
import { SchemaClosureDuplicateAnalyzer } from "./schema-closure-duplicates.js";
import {
  DETECT_SCHEMA_CLOSURE_DUPLICATES_REQUEST,
  DetectSchemaClosureDuplicatesParams,
} from "../shared/schema-closure-duplicates.js";
import { EXPRESS_SERVICE_REQUIREMENTS } from "./service-requirements.js";

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared, ExpressP11 } = createExpressP11Services({ connection, ...NodeFileSystem });
const schemaClosureDuplicateAnalyzer = new SchemaClosureDuplicateAnalyzer(ExpressP11);

// Created with the server, not on the first request: its parse-phase
// listener must be in place before the workspace's initial build, or nothing
// parsed before the first hover is indexed.
const annotationIndex = shared.workspace.AnnotationIndex;

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TAG_PATH_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

// Custom LSP requests (DESIGN §3.2.2, §3.2.3). Registered before
// startLanguageServer so handlers are wired by the time the client begins
// requesting.
connection.onRequest("express/getAnnotations", (params: { uri: string }) => {
  if (!params || typeof params.uri !== "string") return [];
  return annotationIndex.getAnnotations(params.uri);
});

connection.onRequest("express/findAnnotationsForEntity", (params: { entityName: string }) => {
  if (!params || typeof params.entityName !== "string") return [];
  if (!IDENTIFIER_RE.test(params.entityName)) return [];
  return annotationIndex.findByEntityName(params.entityName);
});

connection.onRequest("express/findAnnotationsByPath", (params: { path: string }) => {
  if (!params || typeof params.path !== "string") return [];
  if (!TAG_PATH_RE.test(params.path)) return [];
  return annotationIndex.findByPath(params.path);
});

connection.onRequest(
  "express/findAnnotationsAt",
  (params: { uri: string; position: { line: number; character: number } }) => {
    if (!params || typeof params.uri !== "string" || !params.position) return null;
    const { line, character } = params.position;
    if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) return null;
    return annotationIndex.annotationsAt(params.uri, { line, character }) ?? null;
  },
);

connection.onRequest(
  "express/resolveEntity",
  (params: { name: string; schemaHint?: string }) => {
    if (!params || typeof params.name !== "string") return null;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.name)) return null;
    if (params.schemaHint !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.schemaHint)) {
      return null;
    }
    const im = shared.workspace.IndexManager;
    const want = params.name;
    const schema = params.schemaHint;
    for (const desc of im.allElements()) {
      if (desc.name !== want) continue;
      if (schema) {
        // Description's documentUri ends with .../<schema>.exp under the
        // wg12-step convention. Match defensively.
        const docPath = desc.documentUri.path;
        if (!docPath.endsWith(`/${schema}.exp`)) continue;
      }
      const seg = desc.nameSegment;
      return {
        uri: desc.documentUri.toString(),
        range: seg
          ? {
              start: { line: seg.range.start.line, character: seg.range.start.character },
              end: { line: seg.range.end.line, character: seg.range.end.character },
            }
          : null,
      };
    }
    return null;
  },
);

connection.onRequest(
  DETECT_SCHEMA_CLOSURE_DUPLICATES_REQUEST,
  (params: DetectSchemaClosureDuplicatesParams, cancelToken) => {
    if (!params || typeof params.uri !== "string" || !params.position) return { conflicts: [] };
    return schemaClosureDuplicateAnalyzer.analyze(params.uri, params.position, cancelToken);
  },
);

// Describe Declaration: targets, link proposals and the edit. Each waits until
// the document is built, so offsets and the AST describe the same text.
const describeService = new DescribeService(ExpressP11);

const isOffset = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

async function whenBuilt(uri: string, cancelToken: CancellationToken): Promise<boolean> {
  try {
    await shared.workspace.WorkspaceManager.ready;
    await shared.workspace.DocumentBuilder.waitUntil(DocumentState.IndexedReferences, URI.parse(uri), cancelToken);
    return true;
  } catch {
    return false;
  }
}

connection.onRequest(
  "express/describeTargets",
  async (params: { uri: string; start: number; end: number }, cancelToken) => {
    if (!params || typeof params.uri !== "string" || !isOffset(params.start) || !isOffset(params.end) || params.end < params.start) {
      return null;
    }
    if (!(await whenBuilt(params.uri, cancelToken))) return null;
    return describeService.targets(params.uri, params.start, params.end);
  },
);

connection.onRequest(
  "express/describeProposals",
  async (params: { uri: string; key: string; text: string }, cancelToken) => {
    if (!params || typeof params.uri !== "string" || typeof params.key !== "string" || typeof params.text !== "string") return [];
    if (!(await whenBuilt(params.uri, cancelToken))) return [];
    return describeService.proposals(params.uri, params.key, params.text);
  },
);

connection.onRequest("express/describeEdit", async (params: unknown, cancelToken): Promise<DescribeEditResult> => {
  if (!isDescribeRequest(params)) return { edits: [], findings: [], refused: "The describe request is malformed." };
  if (!(await whenBuilt(params.uri, cancelToken))) {
    return { edits: [], findings: [], refused: "The document is not built in the language server." };
  }
  return describeService.edit(params);
});

// Start the language server with the shared services
startLanguageServer(shared, EXPRESS_SERVICE_REQUIREMENTS);
