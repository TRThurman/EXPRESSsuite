import { AstNode, EmptyFileSystem, LangiumDocument, streamAllContents } from "langium";
import { describe, test, expect } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { expectCompletion, parseDocument } from "langium/test";
import { CompletionList } from "vscode-languageserver";

describe("Basic completion", async () => {
  const text = `SCHEMA Nist;
  
    ENTITY Person;
    firstname:STRING;
    lastname:STRING;
    END_ENTITY;

    ENTITY Employee SUBTYPE OF(Person);
    isPermanent:BOOLEAN;
    END_ENTITY;

    ENTITY Fed SUBTYPE OF(Employee);
    WHERE
    WR1:SELF\\<|>Employee.is<|> = TRUE;
    WR2:SELF\\Person.f<|> ;
    WR3:SELF\\Person.l<|> ;
    END_ENTITY;

    ENTITY Guest SUBTYPE OF(Employee);
    WHERE
    WR1: GetSupervisor(SELF)\\<|>;
    WR2: GetSupervisor(SELF).<|>;
    END_ENTITY;

    FUNCTION GetSupervisor(t:Guest): Fed;
    IF (TRUE) THEN
    RETURN(TRUE);
    ELSE
    RETURN(FALSE);
    END_IF;
    END_FUNCTION;

    END_SCHEMA;`;

  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const completion = expectCompletion(services);
  test("All supertypes are suggested in GROUP qualifier", async () => {
    await completion({ text, index: 0, expectedItems: ["Fed", "Employee", "Person"] });
  });

  test("Direct supertype attribute is suggested in ATTRIBUTE qualifier", async () => {
    await completion({ text, index: 1, expectedItems: ["isPermanent"] });
  });
  test("Higher supertype attributes are suggested in ATTRIBUTE qualifier", async () => {
    await completion({ text, index: 2, expectedItems: ["firstname"] });
    await completion({ text, index: 3, expectedItems: ["lastname"] });
  });

  test("FunctionCall return type types are suggested in GROUP qualifier", async () => {
    await completion({
      text,
      index: 4,
      assert: (completions) => {
        assertCompletionListIsComplete(completions, ["Fed", "Employee", "Person"]);
      },
    });
  });
  test("FunctionCall return type attributes are suggested in ATTRIBUTE qualifier", async () => {
    await completion({
      text,
      index: 5,
      assert: (completions) => {
        assertCompletionListIsComplete(completions, ["isPermanent", "firstname", "lastname"]);
      },
    });
  });
});

describe("Completion with SELECT TYPE attribute", async () => {
  const text = `
    SCHEMA Nist;

    TYPE TBase = EXTENSIBLE SELECT (EntB) ;
    END_TYPE;

    TYPE TExtend = SELECT BASED_ON TBase WITH (EntC) ;
    END_TYPE;

    ENTITY EntA;
    END_ENTITY;

    ENTITY EntB SUBTYPE OF(EntA);
    END_ENTITY;

    ENTITY EntC;
    attributeC: TBase;
    WHERE
    wr1: SELF.attributeC\\<|>;
    END_ENTITY;

    ENTITY EntD;
    attributeD:TExtend;
    WHERE
    wr1: SELF.attributeD\\<|> ;
    END_ENTITY;

    END_SCHEMA;
    
    SCHEMA NistExtension;

    USE FROM Nist;

    TYPE TExtendWithExternalBase = SELECT BASED_ON TBase WITH (EntE) ;
    END_TYPE;

    ENTITY EntE;
    END_ENTITY;

    ENTITY EntF;
    attributeF:TExtendWithExternalBase;
    WHERE
    wr1: SELF.attributeF\\<|> ;
    END_ENTITY;

    END_SCHEMA;
    `;

  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const completion = expectCompletion(services);

  test("SELECT TYPE entities are suggested", async () => {
    await completion({ text, index: 0, expectedItems: ["EntB", "EntA"] });
  });
  test("Extended SELECT TYPE entities are suggested", async () => {
    await completion({ text, index: 1, expectedItems: ["EntC", "EntB", "EntA"] });
  });

  test("Extended SELECT TYPE entities from interface specifications are suggested", async () => {
    await completion({ text, index: 2, expectedItems: ["EntE", "EntB", "EntA"] });
  });
});

describe("Completion with ENUM TYPE attribute", async () => {
  const text = `
    SCHEMA Nist;

    TYPE TBaseColor = EXTENSIBLE ENUMERATION OF (Red, Blue, White) ;
    END_TYPE;

    TYPE TExtendColor = ENUMERATION BASED_ON TBaseColor WITH (Yellow, Purple) ;
    END_TYPE;

    ENTITY Test;
    attributeOne: TBaseColor;
    attributeTwo: TExtendColor;
    WHERE
    WR1: SELF.attributeOne = TBaseColor.<|>;
    WR2: SELF.attributeTwo = TExtendColor.<|>;
    END_ENTITY;

    END_SCHEMA;
    `;

  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const completion = expectCompletion(services);

  test("ENUM TYPE values are suggested", async () => {
    await completion({
      text,
      index: 0,
      assert: (completionList) => {
        assertCompletionListIsComplete(completionList, ["Red", "Blue", "White"]);
      },
    });
  });
  test("Extended ENUM TYPE values are suggested", async () => {
    await completion({
      text,
      index: 1,
      assert: (completionList) => {
        assertCompletionListIsComplete(completionList, ["Yellow", "Red", "Blue", "White", "Purple"]);
      },
    });
  });
});

const assertCompletionListIsComplete = (actualList: CompletionList, expectedList: string[]): void => {
  expect(actualList.items.length).toBe(expectedList.length);
  while (expectedList.length > 0) {
    const elt = expectedList.pop();
    expect(actualList.items.find((i) => i.label === elt)).toBeDefined();
  }
};
