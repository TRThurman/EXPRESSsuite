import { EmptyFileSystem } from "langium";
import { expectIssue, expectNoIssues, validationHelper } from "langium/test";
import { DiagnosticSeverity } from "vscode-languageserver";
import { describe, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressP11Issues } from "../language/express-p11-validator.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const validate = validationHelper(services);

describe("duplicate loop index declarations", () => {
  test("reports a local variable that is implicitly declared by a repeat loop", async () => {
    const result = await validate(`
      SCHEMA example;
      FUNCTION make_numeric_set(incs : INTEGER) : INTEGER;
      LOCAL
        i : INTEGER;
      END_LOCAL;
      REPEAT i := 2 TO incs;
        RETURN(i);
      END_REPEAT;
      RETURN(0);
      END_FUNCTION;
      END_SCHEMA;
    `);

    expectIssue(result, {
      code: ExpressP11Issues.DuplicateLoopIndex,
      message: "Local variable 'i' duplicates an implicitly declared loop index.",
      severity: DiagnosticSeverity.Error,
    });
  });

  test("compares EXPRESS identifiers without regard to case", async () => {
    const result = await validate(`
      SCHEMA example;
      PROCEDURE iterate;
      LOCAL
        Index : INTEGER;
      END_LOCAL;
      REPEAT index := 1 TO 3;
        SKIP;
      END_REPEAT;
      END_PROCEDURE;
      END_SCHEMA;
    `);

    expectIssue(result, { code: ExpressP11Issues.DuplicateLoopIndex });
  });

  test("accepts local variables that are not repeat-loop indices", async () => {
    const result = await validate(`
      SCHEMA example;
      FUNCTION calculate : INTEGER;
      LOCAL
        total : INTEGER;
      END_LOCAL;
      REPEAT i := 1 TO 3;
        total := total + i;
      END_REPEAT;
      RETURN(total);
      END_FUNCTION;
      END_SCHEMA;
    `);

    expectNoIssues(result, { code: ExpressP11Issues.DuplicateLoopIndex });
  });
});
