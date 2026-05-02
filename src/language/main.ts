import { startLanguageServer } from "langium/lsp";
import { NodeFileSystem } from "langium/node";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node.js";
import { createExpressP11Services } from "./express-module.js";

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared } = createExpressP11Services({ connection, ...NodeFileSystem });

// Custom LSP requests (DESIGN §3.2.2, §3.2.3). Registered before
// startLanguageServer so handlers are wired by the time the client begins
// requesting.
connection.onRequest("express/getAnnotations", (params: { uri: string }) => {
  if (!params || typeof params.uri !== "string") return [];
  return shared.workspace.AnnotationIndex.getAnnotations(params.uri);
});

connection.onRequest("express/findAnnotationsForEntity", (params: { entityName: string }) => {
  if (!params || typeof params.entityName !== "string") return [];
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.entityName)) return [];
  return shared.workspace.AnnotationIndex.findByEntityName(params.entityName);
});

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

// Start the language server with the shared services
startLanguageServer(shared);
