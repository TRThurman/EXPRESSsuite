import { EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

describe("full interface imports", () => {
  test("a full USE FROM makes every declaration in the schema available", async () => {
    const result = await validate(`
      SCHEMA Value_with_unit_arm;
      ENTITY Unit;
      END_ENTITY;
      ENTITY Value_with_unit;
        unit : Unit;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA Currency_arm;
      USE FROM Value_with_unit_arm;
      ENTITY Currency
        ABSTRACT SUPERTYPE
        SUBTYPE OF (Unit);
      END_ENTITY;
      ENTITY Currency_value
        SUBTYPE OF (Value_with_unit);
        SELF\\Value_with_unit.unit : Currency;
      END_ENTITY;
      END_SCHEMA;
    `);

    const importDiagnostics = result.diagnostics.filter((diagnostic) =>
      diagnostic.code === ExpressP11Issues.ReferenceStatementMissing ||
      diagnostic.code === ExpressP11Issues.ReferenceStatementIncomplete
    );
    expect(importDiagnostics).toEqual([]);
  });
});
