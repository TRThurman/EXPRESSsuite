import { EmptyFileSystem } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";

const services = createExpressP11Services(EmptyFileSystem).ExpressP11;

/**
 * ISO 10303-11:2004 clause 142:
 *   real_literal = integer_literal | ( digits '.' [ digits ] [ 'e' [ sign ] digits ] )
 *
 * The exponent is inside the fraction branch, so a decimal point must precede it.
 * eengine agrees: it accepts 0., 1.5e-3 and 0.5E+2, and rejects 1e10 and .5.
 */
const errorCount = (literal: string): number => {
  const text = `SCHEMA s;\nTYPE t = REAL;\nWHERE\n  WR1: SELF > ${literal};\nEND_TYPE;\nEND_SCHEMA;`;
  const result = (services.parser as unknown as {
    LangiumParser: { parse: (t: string) => { parserErrors: unknown[]; lexerErrors?: unknown[] } };
  }).LangiumParser.parse(text);
  return result.parserErrors.length + (result.lexerErrors?.length ?? 0);
};

describe("numeric literal lexing", () => {
  test.each(["0", "42", "0.", "1.5", "0.0", "1.5e-3", "0.5E+2", "12.34e10"])("%s is a literal", (literal) => {
    expect(errorCount(literal)).toBe(0);
  });

  // Kept as assertions so that loosening the terminal is a deliberate decision
  // rather than an accident: both forms are outside clause 142.
  test.each(["1e10", ".5"])("%s is not a literal", (literal) => {
    expect(errorCount(literal)).toBeGreaterThan(0);
  });
});
