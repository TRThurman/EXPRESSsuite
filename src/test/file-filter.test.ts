import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { afterAll, describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { isAllowedFile, nameHasKeyword } from "../utils/file-filter.js";
import { defaultSettings } from "./smrlv8-corpus-support.js";

/**
 * `expresssuite.excludedFolders` and `expresssuite.excludedFiles` (GitHub issue 120): the folder
 * names apply inside the workspace folder, not above it, and a file keyword is a part of the file
 * name, not any run of its letters.
 */
const settings = (workspaceFolders: string[] | undefined) => ({ ...defaultSettings(), workspaceFolders });
const allowed = (file: string, folders: string[] | undefined) => isAllowedFile(URI.parse(file), settings(folders));

describe("excludedFolders: folders inside the workspace folder", () => {
  test("a folder above the workspace folder does not count", () => {
    expect(allowed("file:///home/me/library/schemas/a.exp", ["file:///home/me/library/schemas"])).toBe(true);
    expect(allowed("file:///home/me/doc/step/modules/x/arm.exp", ["file:///home/me/doc/step"])).toBe(true);
  });

  test("a folder inside the workspace folder counts, at any depth", () => {
    expect(allowed("file:///home/me/step/library/a.exp", ["file:///home/me/step"])).toBe(false);
    expect(allowed("file:///home/me/step/data/modules/x/dvlp/a.exp", ["file:///home/me/step"])).toBe(false);
    expect(allowed("file:///home/me/step/data/modules/x/arm.exp", ["file:///home/me/step"])).toBe(true);
  });

  test("the name of the workspace folder itself does not count, with or without a closing slash", () => {
    expect(allowed("file:///home/me/library/a.exp", ["file:///home/me/library"])).toBe(true);
    expect(allowed("file:///home/me/library/a.exp", ["file:///home/me/library/"])).toBe(true);
  });

  test("a workspace folder is not the prefix of a sibling's name", () => {
    expect(allowed("file:///home/me/step2/library/a.exp", ["file:///home/me/step"])).toBe(true);
  });

  test("of nested workspace folders the innermost is taken, in either order", () => {
    const folders = ["file:///home/me/step", "file:///home/me/step/library"];
    expect(allowed("file:///home/me/step/library/a.exp", folders)).toBe(true);
    expect(allowed("file:///home/me/step/library/a.exp", [...folders].reverse())).toBe(true);
    expect(allowed("file:///home/me/step/library/doc/a.exp", folders)).toBe(false);
    expect(allowed("file:///home/me/step/utils/a.exp", folders)).toBe(false);
  });

  test("a file outside every workspace folder, or with no workspace folder, is in no excluded folder", () => {
    expect(allowed("file:///home/me/library/a.exp", ["file:///work"])).toBe(true);
    expect(allowed("file:///home/me/library/a.exp", [])).toBe(true);
    expect(allowed("file:///home/me/library/a.exp", undefined)).toBe(true);
  });

  test("a Windows drive and a space in a path are read as the client and the server spell them", () => {
    expect(allowed("file:///d%3A/doc/step/a.exp", ["file:///D:/doc/step"])).toBe(true);
    expect(allowed("file:///d%3A/doc/step/utils/a.exp", ["file:///D:/doc/step"])).toBe(false);
    const spaced = { ...settings(["file:///home/me/my%20step"]), excludedFolders: ["old schemas"] };
    expect(isAllowedFile(URI.parse("file:///home/me/my%20step/old%20schemas/a.exp"), spaced)).toBe(false);
    expect(isAllowedFile(URI.parse("file:///home/me/my%20step/schemas/a.exp"), spaced)).toBe(true);
  });

  test("with the optimized configuration off, nothing is left out", () => {
    const off = { ...settings(["file:///home/me/step"]), useOptimizedConfiguration: false };
    expect(isAllowedFile(URI.parse("file:///home/me/step/library/mim_lf.exp"), off)).toBe(true);
  });
});

describe("excludedFiles: a keyword is a part of the file name", () => {
  test.each(["mim_lf.exp", "arm_lf.exp", "mim_lf-pretty.exp", "mim_lf_patched.exp", "ap242_mim_lf_2026-11-11.exp", "arm_concatenated.exp", "concatenated_mim.exp", "mim_concatenated_lf.exp"])(
    "%s is left out",
    (name) => {
      expect(allowed(`file:///work/${name}`, ["file:///work"])).toBe(false);
    }
  );

  test.each(["shelf_schema.exp", "half_space_schema.exp", "self_reference.exp", "elf.exp", "lfs_notes.exp", "mim.exp"])("%s is read", (name) => {
    expect(allowed(`file:///work/${name}`, ["file:///work"])).toBe(true);
  });

  test("a keyword that begins or ends with another character is matched as written", () => {
    expect(nameHasKeyword("mim_lf.exp", "_lf")).toBe(true);
    expect(nameHasKeyword("shelf.exp", "_lf")).toBe(false);
    expect(nameHasKeyword("draft.bak.exp", ".bak")).toBe(true);
    expect(nameHasKeyword("draft.baked.exp", ".bak")).toBe(false);
    expect(nameHasKeyword("a+b.exp", "a+b")).toBe(true);
    expect(nameHasKeyword("anything.exp", "")).toBe(false);
  });
});

describe("a workspace under a folder named in excludedFolders", () => {
  const top = mkdtempSync(join(tmpdir(), "expresssuite-filter-"));
  afterAll(() => rmSync(top, { recursive: true, force: true }));

  const load = async (folder: string): Promise<string[]> => {
    const { shared } = createExpressP11Services(NodeFileSystem);
    await shared.workspace.ConfigurationProvider.initialized({});
    shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { expresssuite: defaultSettings() } });
    await shared.workspace.WorkspaceManager.initializeWorkspace([{ uri: URI.file(folder).toString(), name: "demo" }]);
    await shared.workspace.WorkspaceManager.ready;
    const root = URI.file(folder).toString();
    return shared.workspace.LangiumDocuments.all
      .map((document) => document.uri.toString())
      .filter((uri) => uri.startsWith(root))
      .map((uri) => uri.slice(root.length + 1))
      .toArray()
      .sort();
  };

  test("the tutorial demo is read the same under library/ as elsewhere, and a doc/ folder inside it is left out", async () => {
    const demo = join(process.cwd(), "docs", "tutorial", "demo");
    const plain = join(top, "a", "demo");
    const under = join(top, "library", "demo");
    for (const folder of [plain, under]) {
      mkdirSync(folder, { recursive: true });
      cpSync(demo, folder, { recursive: true });
      mkdirSync(join(folder, "doc"));
      cpSync(join(demo, "demo_widgets.exp"), join(folder, "doc", "copy.exp"));
    }
    const expected = await load(plain);
    expect(expected.filter((name) => name.endsWith(".exp")).length).toBeGreaterThan(0);
    expect(expected.some((name) => name.startsWith("doc/"))).toBe(false);
    expect(await load(under)).toEqual(expected);
  });
});
