import { DiagnosticSeverity } from "vscode-languageserver";
import { EmptyFileSystem } from "langium";
import { expectIssue, expectNoIssues, validationHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

describe("SC4 declaration naming convention", () => {
  test("accepts initial-uppercase ARM entities and lowercase types", async () => {
    const result = await validate(`
      SCHEMA structural_shape_representation_arm;
      TYPE shape_type = STRING;
      END_TYPE;
      ENTITY Product_definition;
      END_ENTITY;
      END_SCHEMA;
    `);

    expectNoIssues(result, { code: ExpressP11Issues.DeclarationNameCase });
  });

  test("reports lowercase ARM entity names as information", async () => {
    const result = await validate(`
      SCHEMA structural_shape_representation_ARM;
      ENTITY product_definition;
      END_ENTITY;
      END_SCHEMA;
    `);

    expectIssue(result, {
      code: ExpressP11Issues.DeclarationNameCase,
      message: "Entity name should be 'Product_definition'.",
      severity: DiagnosticSeverity.Information,
      data: { expectedName: "Product_definition" },
    });
  });

  test("requires lowercase entity and type names outside ARM schemas", async () => {
    const result = await validate(`
      SCHEMA support_resource_schema;
      TYPE Product_type = STRING;
      END_TYPE;
      ENTITY Product_definition;
      END_ENTITY;
      END_SCHEMA;
    `);

    const diagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === ExpressP11Issues.DeclarationNameCase
    );
    expect(diagnostics.map((diagnostic) => diagnostic.data)).toEqual([
      { expectedName: "product_type" },
      { expectedName: "product_definition" },
    ]);
    expect(diagnostics.every((diagnostic) => diagnostic.severity === DiagnosticSeverity.Information)).toBe(true);
  });

  test("provides a quick fix for an invalid declaration name", async () => {
    const input = `SCHEMA example_schema;
ENTITY Product_definition;
END_ENTITY;
END_SCHEMA;`;
    const output = `SCHEMA example_schema;
ENTITY product_definition;
END_ENTITY;
END_SCHEMA;`;

    const result = await validate(input);
    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === ExpressP11Issues.DeclarationNameCase
    );
    expect(diagnostic).toBeDefined();

    const actions = await services.lsp.CodeActionProvider?.getCodeActions(
      result.document,
      {
        textDocument: { uri: result.document.uri.toString() },
        range: diagnostic!.range,
        context: { diagnostics: [diagnostic!] },
      }
    );
    const action = actions?.[0];
    expect(action && "edit" in action).toBe(true);
    const edit = action && "edit" in action
      ? action.edit?.changes?.[result.document.uri.toString()]?.[0]
      : undefined;
    expect(edit?.newText).toBe("product_definition");

    const start = result.document.textDocument.offsetAt(edit!.range.start);
    const end = result.document.textDocument.offsetAt(edit!.range.end);
    expect(input.slice(0, start) + edit!.newText + input.slice(end)).toBe(output);
  });
});
