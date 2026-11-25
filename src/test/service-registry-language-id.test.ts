import { EmptyFileSystem, URI } from "langium";
import { describe, test, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createExpressP11Services } from "../language/express-module.js";

const text = `SCHEMA s;
ENTITY a; x : STRING; END_ENTITY;
END_SCHEMA;
`;

// A file the client has set to EXPRESS mode must get EXPRESS services
// whatever its extension (a user's `schema.exp.origin` failed with
// "The service registry contains no services for the extension '.origin'").
describe("service registry honors the language id of an open document", () => {
  test("open document with a non-.exp extension and languageId express", () => {
    const { shared } = createExpressP11Services(EmptyFileSystem);
    const uri = URI.parse("file:///tmp/schema.exp.origin");
    (shared.workspace.TextDocuments as unknown as { set(doc: TextDocument): void }).set(TextDocument.create(uri.toString(), "express", 1, text));
    expect(shared.ServiceRegistry.hasServices(uri)).toBe(true);
    expect(() => shared.ServiceRegistry.getServices(uri)).not.toThrow();
  });

  test("a file that is not open and has another extension stays unserved", () => {
    const { shared } = createExpressP11Services(EmptyFileSystem);
    const uri = URI.parse("file:///tmp/notes.txt");
    expect(shared.ServiceRegistry.hasServices(uri)).toBe(false);
  });

  test(".exp still resolves", () => {
    const { shared } = createExpressP11Services(EmptyFileSystem);
    expect(shared.ServiceRegistry.hasServices(URI.parse("file:///tmp/a.exp"))).toBe(true);
  });
});
