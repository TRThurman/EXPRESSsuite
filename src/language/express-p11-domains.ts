import type { LangiumDocument } from "langium";
import { isExpressFile } from "./generated/ast.js";
import { nameHasKeyword, workspaceFolderOf } from "../utils/file-filter.js";

/**
 * The domain of a document: the documents among which its EXPRESS names resolve. A schema
 * interfaces, and a reference finds, only schemas and declarations of its own domain.
 *
 * A stepmod / SMRL module tree holds several domains that reuse the same schema names:
 *
 * - the ARM short forms: every `arm.exp` of one workspace folder;
 * - the MIM short forms and the resource schemas: every other file of that workspace folder
 *   (`mim.exp`, the files under `resources/`, and any file that is none of the kinds here);
 * - each concatenated file (`arm_concatenated.exp`, `mim_concatenated.exp`, `concatenated_mim.exp`):
 *   a domain of its own, whose schemas are copies, not the short forms;
 * - each long form (`arm_lf.exp`, `mim_lf.exp`, or a schema whose name ends in `_lf`): a domain of
 *   its own.
 *
 * Each workspace folder is one checkout, so two checkouts opened together (two branches or
 * worktrees) never share a domain. A file outside every workspace folder is taken with the other
 * files outside every workspace folder.
 *
 * In SMRL v8 no `arm.exp` interfaces a schema outside the ARM short forms and no `mim.exp`
 * interfaces an ARM schema, so no interface crosses the split. What it changes there is the
 * last resort of a lookup: a reference spelled with another case than its declaration no longer
 * binds to an exact-case declaration of the other domain (40 references with the default
 * settings, test-fixtures/smrlv8-baseline/README.md). It also keeps a concatenated copy, a long
 * form or a second checkout from replacing a same-named schema of another domain.
 */
export function domainOf(document: LangiumDocument, workspaceFolders: readonly string[] | undefined): string {
  const uri = document.uri;
  const filename = (uri.path.split("/").pop() ?? "").toLowerCase();
  if (isOwnDomain(filename, document)) return `document ${uri.toString()}`;
  const folder = workspaceFolderOf(uri, workspaceFolders) ?? "";
  return filename === "arm.exp" ? `${folder} ARM short forms` : `${folder} short forms`;
}

/** A concatenated file or a long form: the document is a domain by itself. */
function isOwnDomain(filename: string, document: LangiumDocument): boolean {
  if (nameHasKeyword(filename, "concatenated") || nameHasKeyword(filename, "lf")) return true;
  const file = document.parseResult?.value;
  return isExpressFile(file) && (file.schemas ?? []).some((schema) => /_lf$/i.test(schema.name ?? ""));
}
