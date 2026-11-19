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
/** Why a file is left out: the setting, and the entry of its list that the file's path or name meets. */
export type Exclusion = { setting: "excludedFolders" | "excludedFiles"; entry: string };

/**
 * Why the workspace does not read the file, or `undefined` when it does. With
 * `expresssuite.useOptimizedConfiguration` off, every file is read. With it on, a file is left out
 * when a folder between its workspace folder and itself is named in `expresssuite.excludedFolders`,
 * or when its name holds a keyword of `expresssuite.excludedFiles` ({@link nameHasKeyword}).
 *
 * For the folders, those above the workspace folder do not count: where a user keeps a workspace
 * says nothing about its content. Of nested workspace folders the innermost is taken, so a folder
 * opened as a workspace folder is read whatever its name. A file outside every workspace folder is
 * in no excluded folder.
 */
export function exclusionOf(filepath: URI, configuration: Configuration): Exclusion | undefined {
  if (!configuration.useOptimizedConfiguration) return undefined;
  const folder = excludedFolderOf(filepath, configuration);
  if (folder !== undefined) return { setting: "excludedFolders", entry: folder };
  const filename = filepath.path.split("/").pop();
  if (!filename) return undefined;
  const keyword = configuration.excludedFiles.find((entry) => nameHasKeyword(filename, entry));
  return keyword === undefined ? undefined : { setting: "excludedFiles", entry: keyword };
}

/** Whether the workspace reads the file ({@link exclusionOf}). */
export function isAllowedFile(filepath: URI, configuration: Configuration): boolean {
  if (!configuration.useOptimizedConfiguration) return true;
  if (!filepath.path.split("/").pop()) return false;
  return exclusionOf(filepath, configuration) === undefined;
}

/** Whether no folder between the file's workspace folder and the file is named in `expresssuite.excludedFolders`. */
export function isAllowedFolder(path: URI, configuration: Configuration): boolean {
  if (!configuration.useOptimizedConfiguration) return true;
  return excludedFolderOf(path, configuration) === undefined;
}

function excludedFolderOf(path: URI, configuration: Configuration): string | undefined {
  const file = path.toString();
  let root: string | undefined;
  for (const candidate of rootsOf(configuration.workspaceFolders)) {
    if (file.startsWith(candidate) && (root === undefined || candidate.length > root.length)) root = candidate;
  }
  if (root === undefined) return undefined;
  const folders = file.slice(root.length).split("/").slice(0, -1);
  return folders.map(decoded).find((folder) => configuration.excludedFolders.includes(folder));
}

/**
 * Whether `keyword` stands in `filename` as a part of the name: where the keyword begins or ends
 * with a letter or a digit, the name does not continue there with another one. `lf` is in
 * `mim_lf.exp` and in `ap242_mim_lf_2026-11-11.exp`, not in `shelf_schema.exp`.
 */
export function nameHasKeyword(filename: string, keyword: string): boolean {
  if (!keyword) return false;
  const before = /^[A-Za-z0-9]/.test(keyword) ? "(?<![A-Za-z0-9])" : "";
  const after = /[A-Za-z0-9]$/.test(keyword) ? "(?![A-Za-z0-9])" : "";
  return new RegExp(before + keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + after).test(filename);
}

const roots = new WeakMap<readonly string[], string[]>();

/** The workspace folders as URI prefixes, each ending in `/`, spelled as `URI.toString()` spells a file in them. */
function rootsOf(folders: readonly string[] | undefined): string[] {
  if (!folders) return [];
  let known = roots.get(folders);
  if (!known) {
    known = folders.map((folder) => URI.parse(folder).toString().replace(/\/*$/, "/"));
    roots.set(folders, known);
  }
  return known;
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
