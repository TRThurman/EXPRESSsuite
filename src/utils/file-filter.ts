import { LangiumDocument } from "langium";
import { URI } from "vscode-uri";
import { Configuration } from "../language/express-p11-workspace-manager.js";

export function allowedDocuments(documents: LangiumDocument[], configuration: Configuration): LangiumDocument[] {
  return documents.filter((d) => isAllowedFile(d.uri, configuration));
}
/**
 * Orders documents by URI (code-unit order, not locale order) so that whatever
 * is computed over a whole workspace does not depend on the order in which the
 * file system listed it, which differs between platforms and runs.
 */
export function byUri(left: LangiumDocument, right: LangiumDocument): number {
  const l = left.uri.toString();
  const r = right.uri.toString();
  return l < r ? -1 : l > r ? 1 : 0;
}
export function isAllowedFile(filepath: URI, configuration: Configuration): boolean {
  if (!configuration.useOptimizedConfiguration) return true;

  const isInAllowedFolder = isAllowedFolder(filepath, configuration);
  if (!isInAllowedFolder) return false;
  const filename = filepath.toString().split("/").pop();
  if (!filename) return false;
  const exception = configuration.excludedFiles.find((elt) => filename.includes(elt));
  if (!exception) return true;
  return false;
  //   if (filename.includes("lf") || filename.includes("concatenated")) return false;
  //   return true;
}
export function isAllowedFolder(path: URI, configuration: Configuration): boolean {
  if (!configuration.useOptimizedConfiguration) return true;

  const exception = path
    .toString()
    .split("/")
    .find((elt) => configuration.excludedFolders.includes(elt));
  if (exception) return false;
  return true;

  //   if (path.toString().includes("dvlp") || path.toString().includes("nav") || path.toString().includes("sys")) {
  //     return false;
  //   }
  //   return true;
}
