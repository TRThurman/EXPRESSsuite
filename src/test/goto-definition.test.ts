import { EmptyFileSystem } from "langium";
import { describe, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { expectGoToDefinition } from "langium/test";

describe("Basic Definition provider", async () => {
  const text = `SCHEMA Nist;
  
    TYPE <|TSelect|> = SELECT(En<|>tA, Ent<|>B);
    END_TYPE;

    ENTITY <|EntA|>;
    attributeA: STRING;
    END_ENTITY;

    ENTITY <|EntB|>;
    END_ENTITY;

    ENTITY EntC;
    attributeC:TSe<|>lect;
    attributeC2: En<|>tA;
    END_ENTITY;

    END_SCHEMA;`.trim();

  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const goto = expectGoToDefinition(services);
  test("Can navigate to an ENTITY definition from a SELECT TYPE definition", async () => {
    await goto({ text, index: 0, rangeIndex: 1 });
    await goto({ text, index: 1, rangeIndex: 2 });
  });

  test("Can navigate to a SELECT TYPE definition from an EXPLICIT ATTRIBUTE definition", async () => {
    await goto({ text, index: 2, rangeIndex: 0 });
  });

  test("Can navigate to an ENTITY definition from an EXPLICIT ATTRIBUTE definition", async () => {
    await goto({ text, index: 3, rangeIndex: 1 });
  });
});

describe("Advanced Definition provider", async () => {
  const text = `
    SCHEMA <|Nist|>;

    TYPE <|TBase|> = EXTENSIBLE SELECT (EntB) ;
    END_TYPE;

    TYPE TExtend = SELECT BASED_ON TBa<|>se WITH (EntC) ;
    END_TYPE;

    ENTITY <|EntA|>;
    END_ENTITY;

    ENTITY EntB SUBTYPE OF(EntA);
    END_ENTITY;

    ENTITY EntC;
    attributeC: TBase;
    END_ENTITY;

    ENTITY EntD;
    attributeD:TExtend;
    END_ENTITY;

    END_SCHEMA;
    
    SCHEMA NistExtension;

    USE FROM N<|>ist;

    TYPE TExtendWithExternalBase = SELECT BASED_ON TB<|>ase WITH (EntE) ;
    END_TYPE;

    ENTITY EntE;
    END_ENTITY;

    ENTITY EntF;
    attributeF:TExtendWithExternalBase;
    WHERE
    wr1: SELF.attributeF\\E<|>ntA ;
    END_ENTITY;

    END_SCHEMA;
    `;

  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const goto = expectGoToDefinition(services);
  test("Can navigate to an EXTENSIBLE SELECT TYPE definition from a SELECT TYPE BASED_ON definition", async () => {
    await goto({ text, index: 0, rangeIndex: 1 });
  });
  test("Can navigate to SELECT TYPE being extended from another schema", async () => {
    await goto({ text, index: 2, rangeIndex: 1 });
  });
  test("Can navigate to a SCHEMA referenced in interface specification", async () => {
    await goto({ text, index: 1, rangeIndex: 0 });
  });

  test("Can navigate to an ENTITY from another schema, in a GROUP qualifier", async () => {
    await goto({ text, index: 3, rangeIndex: 2 });
  });
});
