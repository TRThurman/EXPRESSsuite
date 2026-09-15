import { EmptyFileSystem } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

describe("EXPRESSsuite configuration", () => {
  test("requests the product settings section instead of the language id", async () => {
    const { shared } = createExpressP11Services(EmptyFileSystem);
    const provider = shared.workspace.ConfigurationProvider;
    const requestedSections: string[] = [];

    provider.initialize({
      capabilities: { workspace: { configuration: true } },
    } as Parameters<typeof provider.initialize>[0]);
    await provider.initialized({
      fetchConfiguration: async (items) => {
        requestedSections.push(...items.map(({ section }) => section ?? ""));
        return items.map(() => ({ useOptimizedConfiguration: true }));
      },
    });

    expect(requestedSections).toEqual(["expresssuite"]);
    await expect(provider.getConfiguration("expresssuite", "useOptimizedConfiguration"))
      .resolves.toBe(true);
  });
});
