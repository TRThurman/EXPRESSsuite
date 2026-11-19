import { EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

function setup() {
  const services = createExpressP11Services(EmptyFileSystem);
  return { services, validate: validationHelper(services.ExpressP11) };
}

type Found = { code: string; severity?: number; message: string; line: number; data?: unknown };

async function found(validate: ReturnType<typeof setup>["validate"], text: string): Promise<Found[]> {
  const result = await validate(text);
  return result.diagnostics
    .filter((d) => String(d.code).startsWith("annotation-"))
    .map((d) => ({ code: String(d.code), severity: d.severity, message: String(d.message), line: d.range.start.line, data: d.data }));
}

const SCHEMA = `SCHEMA demo_schema;
ENTITY widget;
  size : INTEGER;
END_ENTITY;
END_SCHEMA;
`;

const withBlock = (body: string): string => `${SCHEMA}(*"demo_schema.widget"\n${body}\n*)\n`;

describe("publication checks through the document validator", () => {
  const { validate } = setup();

  test("XS-PUB-001 and -002 are warnings, -006 and -007 information, on the lines of the file", async () => {
    const list = await found(validate, withBlock("Para.\n+\nimage::a.gif[]+\n--\n. item\n+\nimage::b.gif[]"));
    expect(list.map((f) => [f.code, f.severity, f.line])).toEqual([
      ["annotation-continuation-without-list", 2, 7],
      ["annotation-glued-continuation", 2, 8],
      ["annotation-open-block-delimiter", 3, 9],
      ["annotation-list-chain-macro", 3, 10],
    ]);
    expect(list[3].message).toContain("line 12");
  });

  test("the quick fix of a warning rides in the diagnostic's data", async () => {
    const [first] = await found(validate, withBlock("Para.\n+\nimage::a.gif[]"));
    expect(first.data).toMatchObject({ fix: { title: 'Replace the "+" with a blank line', newText: "", range: { start: { line: 7, character: 0 }, end: { line: 7, character: 1 } } } });
  });

  test("a diagnostic of Class B carries no fix", async () => {
    const [first] = await found(validate, withBlock("--\ntext\n--"));
    expect(first.code).toBe("annotation-open-block-delimiter");
    expect((first.data as { fix?: unknown } | undefined)?.fix).toBeUndefined();
  });

  test("an empty body draws nothing", async () => {
    expect(await found(validate, withBlock(""))).toEqual([]);
  });
});

describe("expresssuite.annotations.publicationHazards", () => {
  const body = "--\ntext\n--\n. item\n+\nimage::a.gif[]";

  test("on by default", async () => {
    const { validate } = setup();
    expect((await found(validate, withBlock(body))).map((f) => f.code)).toEqual([
      "annotation-open-block-delimiter",
      "annotation-open-block-delimiter",
      "annotation-list-chain-macro",
    ]);
  });

  test("off switches off Class B and keeps Class A", async () => {
    const { validate, services } = setup();
    services.shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { expresssuite: { annotations: { publicationHazards: false } } } });
    expect(await found(validate, withBlock(`${body}\n\nPara.\n+\nimage::b.gif[]`))).toMatchObject([{ code: "annotation-continuation-without-list" }]);
  });

  test("on, explicitly", async () => {
    const { validate, services } = setup();
    services.shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { expresssuite: { annotations: { publicationHazards: true } } } });
    expect(await found(validate, withBlock("--"))).toHaveLength(1);
  });
});

describe("a change of expresssuite.annotations.publicationHazards", () => {
  const body = "--\ntext\n--";
  const codes = (document: { diagnostics?: Array<{ code?: unknown }> }): string[] =>
    (document.diagnostics ?? []).map((d) => String(d.code)).filter((code) => code.startsWith("annotation-"));
  const change = (services: ReturnType<typeof setup>["services"], publicationHazards: boolean): Promise<void> => {
    services.shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { expresssuite: { annotations: { publicationHazards } } } });
    // The validation runs under the workspace lock; a read waits for it (a write would cancel it).
    return services.shared.workspace.WorkspaceLock.read(async () => undefined);
  };

  test("an open document is validated again, a document that is not open keeps its findings", async () => {
    const { validate, services } = setup();
    const open = (await validate(withBlock(body))).document;
    const closed = (await validate(withBlock(body))).document;
    services.shared.workspace.TextDocuments.keys = () => [open.textDocument.uri];
    expect(codes(open)).toEqual(["annotation-open-block-delimiter", "annotation-open-block-delimiter"]);

    await change(services, false);
    expect(codes(open)).toEqual([]);
    expect(codes(closed)).toEqual(["annotation-open-block-delimiter", "annotation-open-block-delimiter"]);

    await change(services, true);
    expect(codes(open)).toEqual(["annotation-open-block-delimiter", "annotation-open-block-delimiter"]);
  });

  test("a change of another setting validates nothing again", async () => {
    const { validate, services } = setup();
    const open = (await validate(withBlock(body))).document;
    services.shared.workspace.TextDocuments.keys = () => [open.textDocument.uri];
    const before = open.diagnostics;
    services.shared.workspace.ConfigurationProvider.updateConfiguration({ settings: { expresssuite: { useOptimizedConfiguration: false } } });
    await services.shared.workspace.WorkspaceLock.read(async () => undefined);
    expect(open.diagnostics).toBe(before);
  });
});

describe("a key qualified with another schema's name (XS-PUB-005)", () => {
  const { validate } = setup();
  const schemas = (extra: string): string => `SCHEMA geometric_model_schema;
ENTITY solid;
END_ENTITY;
END_SCHEMA;
(*"geometric_model_schema.solid"
A solid.
*)
${extra}`;

  test("a key of a schema that is not in the file is an orphan, role suffix included", async () => {
    const list = await found(validate, schemas(`(*"geometry_schema.__fund_cons"\nText.\n*)`));
    expect(list.map((f) => f.code)).toEqual(["annotation-orphan-key"]);
  });

  test("a key of another schema of the same file, after this schema's END_SCHEMA, is reported too", async () => {
    const text = `SCHEMA geometry_schema;
ENTITY point;
END_ENTITY;
END_SCHEMA;
${schemas(`(*"geometry_schema.point"\nText.\n*)\n(*"geometry_schema.__fund_cons"\nText.\n*)`)}`;
    const list = await found(validate, text);
    expect(list.map((f) => f.code)).toEqual(["annotation-orphan-key", "annotation-orphan-key"]);
    expect(list[0].message).toContain("geometric_model_schema");
  });
});
