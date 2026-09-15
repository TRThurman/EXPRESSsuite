import { EmptyFileSystem } from "langium";
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
});
