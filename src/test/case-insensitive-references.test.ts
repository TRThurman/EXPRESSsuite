import { EmptyFileSystem } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

describe("case-insensitive EXPRESS references", () => {
  test("resolves imported supertypes and qualified attributes regardless of case", async () => {
    const result = await validate(`
      SCHEMA value_with_unit_arm;
      ENTITY unit;
      END_ENTITY;
      ENTITY value_with_unit;
        unit : unit;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA currency_arm;
      USE FROM VALUE_WITH_UNIT_ARM;
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

    const linkingDiagnostics = result.diagnostics.filter(
      ({ message }) => /could not be found|not available and may require an interface/.test(String(message)),
    );
    expect(linkingDiagnostics).toEqual([]);
  });
});
