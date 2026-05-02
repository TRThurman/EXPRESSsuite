import { startLanguageServer } from "langium/lsp";
import { NodeFileSystem } from "langium/node";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node.js";
import { createExpressP11Services } from "./express-module.js";

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared } = createExpressP11Services({ connection, ...NodeFileSystem });

// Custom LSP requests (DESIGN §3.2.2). Registered before startLanguageServer
// so handlers are wired by the time the client begins requesting.
connection.onRequest("express/getAnnotations", (params: { uri: string }) => {
  if (!params || typeof params.uri !== "string") return [];
  return shared.workspace.AnnotationIndex.getAnnotations(params.uri);
});

// Start the language server with the shared services
startLanguageServer(shared);
