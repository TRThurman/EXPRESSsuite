/* What the status bar says of an EXPRESS file that the settings leave out of the workspace
 * (GitHub issue 120): such a file shows no problems, and nothing else says it was not checked.
 * No `vscode` import here, so that the wording is tested without a window.
 */
import { URI } from "vscode-uri";
import type { Configuration } from "../language/express-p11-workspace-manager.js";
import { exclusionOf } from "../utils/file-filter.js";

export interface ExcludedFileStatus {
  text: string;
  tooltip: string;
}

/** The status of the file at `uri`, or `undefined` when the workspace reads it. */
export function excludedFileStatus(uri: string, configuration: Configuration): ExcludedFileStatus | undefined {
  const exclusion = exclusionOf(URI.parse(uri), configuration);
  if (!exclusion) return undefined;
  const why =
    exclusion.setting === "excludedFolders"
      ? `It is in a folder named "${exclusion.entry}", which expresssuite.excludedFolders lists.`
      : `Its name holds "${exclusion.entry}", a keyword of expresssuite.excludedFiles.`;
  return {
    text: "$(circle-slash) EXPRESS: not checked",
    tooltip: `EXPRESSsuite does not read this file, so it shows no problems, hover or completion. ${why} Click to open these settings; turn expresssuite.useOptimizedConfiguration off to read every file.`,
  };
}
