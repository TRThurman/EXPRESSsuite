import { AstUtils, EmptyFileSystem, isReference } from "langium";
import { validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";
import { isExpressFile, isSchemaDefinition } from "../language/generated/ast.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

describe("full interface imports", () => {
  test("a named type resolves inside the ARM closure when an IR has the same name", async () => {
    const result = await validate(`
      SCHEMA measure_schema;
      TYPE measure_value = SELECT;
      END_TYPE;
      END_SCHEMA;

      SCHEMA Value_with_unit_arm;
      ENTITY Unit;
      END_ENTITY;
      TYPE measure_value = SELECT (Unit);
      END_TYPE;
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
        value_component : measure_value;
        SELF\\Value_with_unit.unit : Currency;
      END_ENTITY;
      END_SCHEMA;
    `);

    const importDiagnostics = result.diagnostics.filter((diagnostic) =>
      diagnostic.code === ExpressP11Issues.ReferenceStatementMissing ||
      diagnostic.code === ExpressP11Issues.ReferenceStatementIncomplete
    );
    expect(importDiagnostics).toEqual([]);

    const root = result.document.parseResult.value;
    expect(isExpressFile(root)).toBe(true);
    if (!isExpressFile(root)) return;
    const currencySchema = root.schemas.find(
      (schema) => schema.name === "Currency_arm"
    );
    let measureValueTargetSchema: string | undefined;
    for (const node of AstUtils.streamAst(currencySchema!)) {
      for (const reference of AstUtils.streamReferences(node)) {
        if (reference.reference.$refText !== "measure_value") continue;
        if (!isReference(reference.reference)) continue;
        const target = reference.reference.ref;
        measureValueTargetSchema = target
          ? AstUtils.getContainerOfType(target, isSchemaDefinition)?.name
          : undefined;
      }
    }
    expect(measureValueTargetSchema).toBe("Value_with_unit_arm");
  });

  test("transitive ARM declarations do not require redundant direct imports", async () => {
    const result = await validate(`
      SCHEMA Elemental_geometric_shape_arm;
      ENTITY Axis_placement_3d;
      END_ENTITY;
      ENTITY Geometric_model;
      END_ENTITY;
      END_SCHEMA;

      SCHEMA Basic_geometry_arm;
      USE FROM Elemental_geometric_shape_arm;
      END_SCHEMA;

      SCHEMA Topologically_bounded_surface_arm;
      USE FROM Basic_geometry_arm;
      END_SCHEMA;

      SCHEMA Manifold_surface_arm;
      USE FROM Topologically_bounded_surface_arm;
      END_SCHEMA;

      SCHEMA Manifold_subsurface_arm;
      USE FROM Manifold_surface_arm;
      USE FROM Topologically_bounded_surface_arm;
      TYPE item = SELECT (Axis_placement_3d);
      END_TYPE;
      ENTITY Manifold_subsurface_model
        SUBTYPE OF (Geometric_model);
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
