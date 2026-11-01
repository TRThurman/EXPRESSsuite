import { EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { InformalPropositionIssues } from "../language/informal-proposition-validator.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

function ipIssues(diagnostics: Awaited<ReturnType<typeof validate>>["diagnostics"]) {
  return diagnostics.filter((diagnostic) => String(diagnostic.code).startsWith("informal-proposition-"));
}

describe("informal proposition signatures", () => {
  test("accepts matching signatures and annotation blocks", async () => {
    const result = await validate(`
      SCHEMA example_schema;
      ENTITY datum;
      WHERE
        wr1: TRUE;
      --IP1:
      END_ENTITY;
      (*"example_schema.datum.wr:IP1" Informal proposition text. *)
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics)).toHaveLength(0);
  });

  test("reports an annotation block without a signature", async () => {
    const result = await validate(`
      SCHEMA example_schema;
      ENTITY datum;
      END_ENTITY;
      (*"example_schema.datum.wr:IP1" Informal proposition text. *)
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
      InformalPropositionIssues.MissingSignature,
    ]);
  });

  test.each(["-- IP1 :", "--IP1 :", "--IP1", "--IP1;"])("reports malformed signature %s", async (signature) => {
    const result = await validate(`
      SCHEMA example_schema;
      TYPE datum = STRING;
      ${signature}
      END_TYPE;
      (*"example_schema.datum.wr:IP1" Informal proposition text. *)
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
      InformalPropositionIssues.MalformedSignature,
    ]);
  });

  test("reports signatures placed after the declaration", async () => {
    const result = await validate(`
      SCHEMA example_schema;
      ENTITY datum;
      END_ENTITY;
      --IP1:
      (*"example_schema.datum.wr:IP1" Informal proposition text. *)
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
      InformalPropositionIssues.MisplacedSignature,
    ]);
  });

  test.each(["IP1", "ip1"])("reports malformed annotation key suffix .%s", async (suffix) => {
    const result = await validate(`
      SCHEMA example_schema;
      ENTITY datum;
      --IP1:
      END_ENTITY;
      (*"example_schema.datum.${suffix}" Informal proposition text. *)
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
      InformalPropositionIssues.MalformedAnnotationKey,
    ]);
  });

  test("reports a signature without an annotation block", async () => {
    const result = await validate(`
      SCHEMA example_schema;
      ENTITY datum;
      --IP6:
      END_ENTITY;
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
      InformalPropositionIssues.MissingAnnotation,
    ]);
  });

  test("reports signatures that are not the final declaration entries", async () => {
    const result = await validate(`
      SCHEMA example_schema;
      ENTITY datum;
      --IP1:
      WHERE
        wr1: TRUE;
      END_ENTITY;
      (*"example_schema.datum.wr:IP1" Informal proposition text. *)
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics).map((diagnostic) => diagnostic.code)).toEqual([
      InformalPropositionIssues.MisplacedSignature,
    ]);
  });

  test("does not interpret signature-like text inside block comments", async () => {
    const result = await validate(`
      SCHEMA example_schema;
      ENTITY datum;
      END_ENTITY;
      (*"example_schema.datum.__note" Example text containing --IP1: only. *)
      END_SCHEMA;
    `);

    expect(ipIssues(result.diagnostics)).toHaveLength(0);
  });
});

describe("documents without a schema", () => {
  afterEach(() => vi.restoreAllMocks());

  // The grammar requires a schema, so these parse to a root without a schema
  // list. The check used to iterate it and throw, which aborted the whole
  // document's validation with "An error occurred during validation".
  test.each([
    ["empty", ""],
    ["whitespace only", "   \n\n"],
    ["a remark only", "(* nothing but a remark *)\n"],
    ["a tagged remark only", '(*"example_schema.datum" A description. *)\n'],
  ])("validates a document that is %s without throwing", async (_label, text) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await validate(text);
    expect(logged).not.toHaveBeenCalled();
    expect(ipIssues(result.diagnostics)).toHaveLength(0);
    expect(result.diagnostics.map((diagnostic) => diagnostic.data?.code)).toEqual(["parsing-error"]);
  });
});
