import { EmptyFileSystem, URI } from "langium";
import type { BuildOptions, LangiumDocument } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

describe("workspace readiness", () => {
  test("does not allow language requests before the initial build completes", async () => {
    const { shared } = createExpressP11Services(EmptyFileSystem);
    const manager = shared.workspace.WorkspaceManager;
    const builder = shared.workspace.DocumentBuilder;
    await shared.workspace.ConfigurationProvider.initialized({});
    const originalBuild = builder.build.bind(builder);

    let finishBuild!: () => void;
    const buildGate = new Promise<void>((resolve) => {
      finishBuild = resolve;
    });
    builder.build = async () => buildGate;

    let ready = false;
    void manager.ready.then(() => {
      ready = true;
    });

    const initialization = manager.initializeWorkspace([]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(ready).toBe(false);

    finishBuild();
    await initialization;
    await manager.ready;
    expect(ready).toBe(true);

    builder.build = originalBuild;
  });

  test("validates open documents before reporting the workspace ready", async () => {
    const { shared } = createExpressP11Services(EmptyFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    const uri = URI.parse("file:///open.exp");
    const document = shared.workspace.LangiumDocumentFactory.fromString(
      "SCHEMA open_schema; END_SCHEMA;",
      uri
    );
    shared.workspace.LangiumDocuments.addDocument(document);

    const textDocuments = shared.workspace.TextDocuments;
    const originalKeys = textDocuments.keys.bind(textDocuments);
    textDocuments.keys = () => [uri.toString()];
    const builder = shared.workspace.DocumentBuilder;
    const originalBuild = builder.build.bind(builder);
    const builds: Array<{ documents: LangiumDocument[]; options?: BuildOptions }> = [];
    builder.build = async (documents, options) => {
      builds.push({ documents, options });
    };

    await shared.workspace.WorkspaceManager.initializeWorkspace([]);

    expect(builds).toHaveLength(2);
    expect(builds[1].documents).toEqual([document]);
    expect(builds[1].options).toBe(builder.updateBuildOptions);
    builder.build = originalBuild;
    textDocuments.keys = originalKeys;
  });
});
