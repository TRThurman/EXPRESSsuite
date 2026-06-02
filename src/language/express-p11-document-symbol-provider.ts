import { LangiumDocument, MaybePromise } from "langium";
import { DefaultDocumentSymbolProvider } from "langium/lsp";
import { DocumentSymbol } from "vscode-languageserver";
import { ExpressFile } from "./generated/ast.js";
import { getSchemaDeclarations, getSchemaDocumentSymbol } from "../utils/schema-helpers.js";
export class ExpressP11DocumentSymbolProvider extends DefaultDocumentSymbolProvider {
  override getSymbols(document: LangiumDocument<ExpressFile>): MaybePromise<DocumentSymbol[]> {
    // const symbols: DocumentSymbol[] = [];
    // for (const schema of document.parseResult.value.schemas) {
    //   symbols.push(...this.getSymbol(document, schema));
    // }
    // return symbols;
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
