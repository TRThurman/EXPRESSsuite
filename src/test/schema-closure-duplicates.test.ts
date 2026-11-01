import { AstNode, EmptyFileSystem, LangiumDocument } from "langium";
import { parseDocument } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { SchemaClosureDuplicateAnalyzer } from "../language/schema-closure-duplicates.js";

/**
 * The command is the on-demand form of `duplicate-interfaced-declaration` and
 * shares its scope index, so these cases state scope semantics (ISO
 * 10303-11:2004 10.1 b, clause 11), not closure semantics.
 */
async function analyze(source: string, schemaName = "current") {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const document: LangiumDocument<AstNode> = await parseDocument(services, source);
  await services.shared.workspace.DocumentBuilder.build([document]);
  const offset = source.indexOf(`SCHEMA ${schemaName}`) + 8;
  const position = document.textDocument.positionAt(offset);
  return new SchemaClosureDuplicateAnalyzer(services).analyze(document.uri.toString(), position);
}

describe("schema closure duplicate declarations", () => {
  const useAndReference = `
      SCHEMA source_b;
      ENTITY datum;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA source_c;
      ENTITY datum;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA intermediate;
      USE FROM source_b;
      REFERENCE FROM source_c;
      END_SCHEMA;

      SCHEMA current;
      USE FROM intermediate;
      END_SCHEMA;
    `;

  test("reports the clash where both declarations are visible", async () => {
    const result = await analyze(useAndReference, "intermediate");
    expect(result.schema).toBe("intermediate");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ category: "ENTITY", name: "datum" });
    expect(result.conflicts[0].locations.map((location) => location.schema).sort()).toEqual(["source_b", "source_c"]);
  });

  test("does not report a REFERENCE'd item further along a USE chain (11.3)", async () => {
    const result = await analyze(useAndReference, "current");
    expect(result.schema).toBe("current");
    expect(result.conflicts).toHaveLength(0);
  });

  test("keeps entity names case-significant in a short form", async () => {
    const result = await analyze(useAndReference.replace("SCHEMA source_c;\n      ENTITY datum;", "SCHEMA source_c;\n      ENTITY Datum;"), "intermediate");
    expect(result.conflicts).toHaveLength(0);
  });

  test("handles interface cycles and excludes schemas outside the scope", async () => {
    const result = await analyze(`
      SCHEMA first;
      USE FROM second;
      TYPE shared = STRING;
      END_TYPE;
      END_SCHEMA;

      SCHEMA second;
      REFERENCE FROM first;
      TYPE shared = STRING;
      END_TYPE;
      END_SCHEMA;

      SCHEMA outside;
      ENTITY outside_only;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA current;
      USE FROM first;
      ENTITY outside_only;
      END_ENTITY;
      END_SCHEMA;
    `);

    expect(result.conflicts.map((conflict) => conflict.name)).toEqual(["shared"]);
  });

  test("uses a direct renamed resource's effective visible name", async () => {
    const result = await analyze(`
      SCHEMA first;
      ENTITY datum;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA second;
      ENTITY datum;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA current;
      USE FROM first (datum AS first_datum);
      USE FROM second (datum);
      END_SCHEMA;
    `);

    expect(result.conflicts).toHaveLength(0);
  });

  test("reports each declaration location once", async () => {
    const result = await analyze(`
      SCHEMA first;
      ENTITY datum;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA current;
      USE FROM first;
      ENTITY datum;
      END_ENTITY;
      END_SCHEMA;
    `);

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].locations).toHaveLength(2);
    expect(result.conflicts[0].locations.every((location) => location.range.start.line >= 0)).toBe(true);
  });
});

describe("documents without a schema", () => {
  // Such a document parses to a root without a schema list; the command
  // used to throw on it, which surfaced as "Could not detect duplicate
  // declarations".
  test.each([
    ["empty", ""],
    ["a remark only", "(* nothing but a remark *)"],
  ])("reports no conflicts for a document that is %s", async (_label, source) => {
    await expect(analyze(source)).resolves.toEqual({ conflicts: [] });
  });
});
