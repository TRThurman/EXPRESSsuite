import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  EXPRESSSUITE_COMMANDS,
  EXPRESSSUITE_CONFIGURATION_SECTION,
} from "../shared/commands.js";

type ExtensionManifest = {
  contributes: {
    commands: Array<{ command: string }>;
    menus: Record<string, Array<{ command: string }>>;
    configuration: { properties: Record<string, unknown> };
    languages: Array<{ id: string }>;
  };
};

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as ExtensionManifest;

describe("EXPRESSsuite extension identity", () => {
  test("uses a product-specific namespace for every global command", () => {
    const contributed = manifest.contributes.commands.map(({ command }) => command).sort();
    const implemented = Object.values(EXPRESSSUITE_COMMANDS).sort();

    expect(contributed).toEqual(implemented);
    expect(contributed.every((command) => command.startsWith("expresssuite."))).toBe(true);
    const menuCommands = Object.values(manifest.contributes.menus)
      .flat()
      .map(({ command }) => command);
    const commandsExpectedInMenus = implemented.filter(
      (command) => command !== EXPRESSSUITE_COMMANDS.buildWorkspace
        && command !== EXPRESSSUITE_COMMANDS.buildGraph
        && command !== EXPRESSSUITE_COMMANDS.openMathPlayground,
    );
    expect(menuCommands).toEqual(expect.arrayContaining(commandsExpectedInMenus));
  });

  test("uses product-specific settings while retaining the EXPRESS language id", () => {
    const settings = Object.keys(manifest.contributes.configuration.properties);
    expect(settings.every((setting) => setting.startsWith(`${EXPRESSSUITE_CONFIGURATION_SECTION}.`))).toBe(true);
    expect(manifest.contributes.languages.map(({ id }) => id)).toContain("express");
  });
});
