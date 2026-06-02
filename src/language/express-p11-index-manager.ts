import { DefaultIndexManager } from "langium";

export class ExpressP11IndexManager extends DefaultIndexManager {
  //   protected override isAffected(document: LangiumDocument<AstNode>, changed: URI): boolean {
  //     // Cache the uri string
  //     const changedUriString = changed.toString();
  //     const documentUri = document.uri.toString();
  //     // // The document is affected if it contains linking errors
  //     // if (document.references.some((e) => e.error !== undefined)) {
  //     //   return true;
  //     // }
  //     const references = this.referenceIndex.get(documentUri);
  //     // ...or if it contains a reference to the changed file
  //     if (references) {
  //       return references.filter((e) => !e.local).some((e) => equalURI(e.targetUri, changedUriString));
  //     }
  //     return false;
  //   }
}
