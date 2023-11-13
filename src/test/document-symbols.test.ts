import { EmptyFileSystem } from "langium";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language-server/express-p11-module";
import { expectSymbols } from "langium/test";
import { DocumentSymbol } from "vscode-languageserver";
import { ExpressKind } from "../utils/general";

describe("Symbol provider", async () => {
  const text = `SCHEMA Nist;
  
    TYPE TSelect = SELECT(EntA, EntB);
    END_TYPE;

    ENTITY EntA;
    attributeA: STRING;
    END_ENTITY;

    ENTITY EntB;
    END_ENTITY;

    END_SCHEMA;`;

  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const symbols = expectSymbols(services);
  test("All document symbols are found", async () => {
    await symbols({
      text,
      assert: (symbols: DocumentSymbol[]) => {
        expect(symbols.length).toBe(1);
        expect(symbols[0].children?.length).toBe(3);
      },
    });
  });
  test("All document symbols are identified properly", async () => {
    await symbols({
      text,
      assert: (symbols: DocumentSymbol[]) => {
        expect(symbols[0].kind).toBe(ExpressKind.Namespace);
        const [EntA, EntB, TSelect] = [...symbols[0].children!];
        expect(TSelect.kind).toBe(ExpressKind.Type);
        expect(EntA.kind).toBe(ExpressKind.Entity);
        expect(EntB.kind).toBe(ExpressKind.Entity);
      },
    });
  });
  test("All document symbols are named properly", async () => {
    await symbols({
      text,
      assert: (symbols: DocumentSymbol[]) => {
        expect(symbols[0].name).toBe("Nist");
        const [EntA, EntB, TSelect] = [...symbols[0].children!];
        expect(TSelect.name).toBe("TSelect");
        expect(EntA.name).toBe("EntA");
        expect(EntB.name).toBe("EntB");
      },
    });
  });
});
