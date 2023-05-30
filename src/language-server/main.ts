import { startLanguageServer } from "langium";
import { NodeFileSystem } from "langium/node";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { createExpressP11Services } from "./express-p-11-module";

// Create a connection to the client
const connection = createConnection(ProposedFeatures.all);

// Inject the shared services and language-specific services
const { shared } = createExpressP11Services({ connection, ...NodeFileSystem });

// Start the language server with the shared services
// startLanguageServer(shared);
startLanguageServer(shared);
