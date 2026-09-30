import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { ExpressFile } from "../language/generated/ast.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
const parse = parseHelper<ExpressFile>(services);

// ISO 10303-11 simple string literals have no backslash escapes; an embedded
// apostrophe is written by doubling it. A backslash is an ordinary character,
// and appears in real schemas because qualified attribute names use it.
const errorsFor = async (body: string) => {
  const doc = await parse(`SCHEMA s;\n${body}\nEND_SCHEMA;\n\n(*"s.t"\nProse with 'quotes', a period '.' and a backslash.\n*)\n`);
  return {
    parser: doc.parseResult.parserErrors.map((e) => String(e.token?.image)),
    lexer: ((doc.parseResult as unknown as { lexerErrors?: unknown[] }).lexerErrors ?? []).length,
  };
};

const CHARSET = String.raw`['0','1','2','_','[',']','.','\']`;

describe("simple string literal lexing", () => {
  test("a string holding a literal backslash does not run on", async () => {
    // Verbatim shape of parameterization_schema.exp's attribute_identifier rule.
    expect(await errorsFor(`TYPE t = STRING;\nWHERE\n  WR1: SELF IN ${CHARSET};\nEND_TYPE;`)).toEqual({ parser: [], lexer: 0 });
  });

  test("a doubled apostrophe is an escaped apostrophe", async () => {
    expect(await errorsFor(String.raw`TYPE t = STRING;
WHERE
  WR1: SELF <> 'it''s';
END_TYPE;`)).toEqual({ parser: [], lexer: 0 });
  });

  test("ordinary strings still lex", async () => {
    expect(await errorsFor(`TYPE t = STRING;\nWHERE\n  WR1: SELF <> 'PLAIN.NAME';\nEND_TYPE;`)).toEqual({ parser: [], lexer: 0 });
  });
});
