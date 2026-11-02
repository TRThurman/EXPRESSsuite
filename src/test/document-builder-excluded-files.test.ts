import { DocumentState, EmptyFileSystem, URI } from "langium";
import { describe, test, expect, beforeAll } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { parseDocument } from "langium/test";
import { ExpressP11DocumentBuilder } from "../language/express-p11-document-builder.js";

// Regression test for the LSP error (code -32803, RequestFailed) logged on every hover
// over a file excluded by the optimized configuration (e.g. a "_lf" longform):
//
//   "Document state of <uri> is Changed, requiring Linked, but workspace state is
//    already Validated. Returning undefined."
//
// Sequence in the extension:
//  1. The workspace manager never loads excluded files, so the longform only becomes
//     a LangiumDocument when the user opens it in the editor.
//  2. Opening it fires `DocumentBuilder.update([uri], [])`. The builder registers a
//     placeholder document with an INVALID model at `Changed` and calls
//     `buildDocuments`, where `allowedDocuments` filters it out. Nothing ever parses
//     or advances it.
//  3. Every per-document request handler (hover needs `Linked`, the outline needs
//     `Parsed`, ...) awaits `DocumentBuilder.waitUntil(state, uri)`. Langium's
//     `awaitDocumentState` sees `document.state < state` while the builder's overall
//     state is already `Validated` and rejects with the error above.
//
// The builder relaxes the state requirement for excluded documents, so these requests
// proceed (and yield nothing) instead of failing.
describe("ExpressP11DocumentBuilder — excluded documents", () => {
  const services = createExpressP11Services(EmptyFileSystem);
  const documentBuilder = services.shared.workspace.DocumentBuilder as ExpressP11DocumentBuilder;
  const langiumDocuments = services.shared.workspace.LangiumDocuments;
  const documentFactory = services.shared.workspace.LangiumDocumentFactory;

  const moduleText = ["SCHEMA Nist;", "ENTITY Person;", "END_ENTITY;", "END_SCHEMA;"].join("\n");
  const longformText = [
    "SCHEMA Nist_lf;",
    "ENTITY Person;",
    "END_ENTITY;",
    "ENTITY Employee SUBTYPE OF (Person);",
    "END_ENTITY;",
    "END_SCHEMA;",
  ].join("\n");

  const includedUri = URI.parse("file:///workspace/mim.exp");
  // Opened in the editor after startup: registered by `update` as an unparsed placeholder.
  const openedUri = URI.parse("file:///workspace/mim_lf.exp");
  // Parsed earlier (e.g. before the exclusion applied), then invalidated and never rebuilt.
  const staleUri = URI.parse("file:///workspace/arm_lf.exp");

  beforeAll(async () => {
    // A normal module document, built all the way to `Validated` as part of the
    // workspace. This is what pushes the builder's overall state to `Validated`.
    await parseDocument(services.ExpressP11, moduleText, {
      documentUri: includedUri.toString(),
      validation: true,
    });

    // The exclusion configuration `refreshConfiguration()` would pull from the client.
    // There is no LSP connection in this unit test, so set the field directly, with the
    // defaults declared in package.json (`expresssuite.excludedFiles`).
    (documentBuilder as unknown as { workspaceConfiguration: unknown }).workspaceConfiguration = {
      useOptimizedConfiguration: true,
      excludedFiles: ["lf", "concatenated"],
      excludedFolders: [],
    };

    // Exactly what `update` does for a URI it has never seen: an INVALID placeholder.
    const placeholder = documentFactory.fromModel({ $type: "INVALID" }, openedUri);
    placeholder.state = DocumentState.Changed;
    langiumDocuments.addDocument(placeholder);
    // A previously parsed excluded document.
    langiumDocuments.createDocument(staleUri, longformText);

    // The content-change update: resets both to `Changed`, then runs a build that skips them.
    await documentBuilder.update([openedUri, staleUri], []);
  });

  test("premise: the excluded documents stay unbuilt while the included one is validated", () => {
    expect(langiumDocuments.getDocument(openedUri)?.state).toBe(DocumentState.Changed);
    expect(langiumDocuments.getDocument(staleUri)?.state).toBe(DocumentState.Changed);
    expect(langiumDocuments.getDocument(includedUri)?.state).toBe(DocumentState.Validated);
  });

  test("waitUntil(Linked) for an excluded document resolves instead of rejecting with RequestFailed", async () => {
    // This is exactly what Langium's hover request handler awaits before calling the provider.
    await expect(documentBuilder.waitUntil(DocumentState.Linked, openedUri)).resolves.toEqual(openedUri);
    await expect(documentBuilder.waitUntil(DocumentState.Linked, staleUri)).resolves.toEqual(staleUri);
  });

  test("waitUntil(Parsed) and waitUntil(Validated) for an excluded document resolve too", async () => {
    await expect(documentBuilder.waitUntil(DocumentState.Parsed, openedUri)).resolves.toEqual(openedUri);
    await expect(documentBuilder.waitUntil(DocumentState.Validated, openedUri)).resolves.toEqual(openedUri);
  });

  test("waitUntil for the included document is unaffected", async () => {
    await expect(documentBuilder.waitUntil(DocumentState.Linked, includedUri)).resolves.toEqual(includedUri);
  });

  test("hover on an excluded document yields no content and does not throw", async () => {
    const hoverProvider = services.ExpressP11.lsp.HoverProvider!;
    // The placeholder has no syntax tree at all.
    const placeholderHover = await hoverProvider.getHoverContent(langiumDocuments.getDocument(openedUri)!, {
      textDocument: { uri: openedUri.toString() },
      position: { line: 0, character: 0 },
    });
    expect(placeholderHover).toBeUndefined();
    // The stale document has a syntax tree but was never scoped or linked. Position inside
    // "Person" in "ENTITY Employee SUBTYPE OF (Person);" (line 3, 0-based).
    const staleHover = await hoverProvider.getHoverContent(langiumDocuments.getDocument(staleUri)!, {
      textDocument: { uri: staleUri.toString() },
      position: { line: 3, character: 30 },
    });
    expect(staleHover).toBeUndefined();
  });

  test("outline, folding and completion on the placeholder document do not throw", async () => {
    const document = langiumDocuments.getDocument(openedUri)!;
    const params = { textDocument: { uri: openedUri.toString() } };
    const symbols = await services.ExpressP11.lsp.DocumentSymbolProvider!.getSymbols(document, params);
    expect(symbols).toEqual([]);
    const foldings = await services.ExpressP11.lsp.FoldingRangeProvider!.getFoldingRanges(document, params);
    expect(foldings).toEqual([]);
    const completion = await services.ExpressP11.lsp.CompletionProvider!.getCompletion(document, {
      ...params,
      position: { line: 0, character: 0 },
    });
    expect(completion?.items ?? []).toBeInstanceOf(Array);
  });
});
