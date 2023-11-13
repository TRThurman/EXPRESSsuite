import {
  DefaultDocumentSymbolProvider,
  DocumentSymbolProvider,
  LangiumDocument,
  LangiumServices,
  MaybePromise,
  interruptAndCheck,
} from "langium";
import { DocumentSymbolParams, CancellationToken, DocumentSymbol } from "vscode-languageserver";
import { ExpressFile } from "./generated/ast";
import { getSchemaDeclarations, getSchemaDocumentSymbol } from "../utils/schema-helpers";
import { ExpressP11Services } from "./express-p11-module";
export class ExpressP11DocumentSymbolProvider implements DocumentSymbolProvider {
  constructor(services: LangiumServices) {}
  getSymbols(
    document: LangiumDocument<ExpressFile>,
    params: DocumentSymbolParams,
    cancelToken?: CancellationToken
  ): MaybePromise<DocumentSymbol[]> {
    const symbols: DocumentSymbol[] = [];

    for (const schema of getSchemaDeclarations(document)) {
      const symbol = getSchemaDocumentSymbol(schema);
      if (symbol) symbols.push(symbol);
    }
    return symbols;
  }

  //   override getSymbols(document: LangiumDocument<ExpressFile>): MaybePromise<DocumentSymbol[]> {
  //     const symbols: DocumentSymbol[] = [];
  //     for (const schema of document.parseResult.value.schemas) {
  //       symbols.push(...this.getSymbol(document, schema));
  //     }
  //     return symbols;
  //   }
}
