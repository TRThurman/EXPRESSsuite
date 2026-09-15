import { AstNode, EmptyFileSystem, LangiumDocument } from "langium";
import { parseDocument } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { SchemaClosureDuplicateAnalyzer } from "../language/schema-closure-duplicates.js";

async function analyze(source: string, schemaName = "current") {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const document: LangiumDocument<AstNode> = await parseDocument(services, source);
  await services.shared.workspace.DocumentBuilder.build([document]);
  const offset = source.indexOf(`SCHEMA ${schemaName}`) + 8;
  const position = document.textDocument.positionAt(offset);
  return new SchemaClosureDuplicateAnalyzer(services).analyze(document.uri.toString(), position);
}

describe("schema closure duplicate declarations", () => {
  test("detects case-insensitive duplicates through direct and transitive interfaces", async () => {
    const result = await analyze(`
      SCHEMA source_b;
      ENTITY datum;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA source_c;
      ENTITY Datum;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA intermediate;
      USE FROM source_b;
      REFERENCE FROM source_c;
      END_SCHEMA;

      SCHEMA current;
      USE FROM intermediate;
      END_SCHEMA;
    `);

    expect(result.schema).toBe("current");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ category: "ENTITY", name: "Datum" });
    expect(result.conflicts[0].locations.map((location) => location.schema).sort()).toEqual(["source_b", "source_c"]);
  });

  test("handles interface cycles and excludes schemas outside the closure", async () => {
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
