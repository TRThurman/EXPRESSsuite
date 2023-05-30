import { DocumentSymbolProvider, LangiumDocument } from "langium";
import { DocumentSymbolParams, CancellationToken, DocumentSymbol } from "vscode-languageserver";
import { ExpressFile } from "./generated/ast";
import { getSchemaDeclarations, getSchemaDocumentSymbol } from "../utils/schema-helpers";
import { ExpressP11Services } from "./express-p-11-module";
export class ExpressP11DocumentSymbolProvider implements DocumentSymbolProvider {
  constructor(services: ExpressP11Services) {}

  getSymbols(
    document: LangiumDocument<ExpressFile>,
    params: DocumentSymbolParams,
    cancelToken?: CancellationToken | undefined
  ): DocumentSymbol[] {
    const symbols: DocumentSymbol[] = [];
    getSchemaDeclarations(document).forEach((schema) => {
      const symbol = getSchemaDocumentSymbol(schema);
      if (symbol) symbols.push(symbol);
    });
    // var schema = document.parseResult.value.schema;
    // if (schemaHasBody(schema)) {
    //   const symbol = getSchemaDocumentSymbol(schema);
    //   if (symbol) symbols.push(symbol);
    // }
    return symbols;
  }
}
