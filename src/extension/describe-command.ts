import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { BlockRole, DescribeEditResult, DescribeRequest, DescribeTargetsResult, MemberText } from "../language/annotation/describe.js";
import type { LinkProposal } from "../language/annotation/proposals.js";
import type { DescribeTarget } from "../language/annotation/keys.js";
import { EXPRESSSUITE_COMMANDS } from "../shared/commands.js";
import { applyCleanups, findCleanups } from "../shared/description-cleanup.js";
import type { CleanupId } from "../shared/description-cleanup.js";
import { splitMembers } from "../shared/describe-members.js";

/** Everything the command needs after the source and target steps. */
interface Chosen {
  text: string;
  accepted: LinkProposal[];
}

const ROLE_SUFFIX: Readonly<Record<BlockRole, string>> = { description: "", note: ".__note", example: ".__example" };
const TITLE = "Describe Declaration";

export function registerDescribeCommand(context: vscode.ExtensionContext, client: LanguageClient): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(EXPRESSSUITE_COMMANDS.describeDeclaration, async () => {
      try {
        await describeDeclaration(client);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`${TITLE} failed: ${reason}`);
      }
    }),
  );
}

async function describeDeclaration(client: LanguageClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "express") {
    void vscode.window.showInformationMessage("Open an EXPRESS file first.");
    return;
  }
  if (!client.isRunning()) {
    void vscode.window.showErrorMessage("The EXPRESSsuite language server is not running.");
    return;
  }
  const document = editor.document;
  const uri = document.uri.toString();
  const start = document.offsetAt(editor.selection.start);
  const end = document.offsetAt(editor.selection.end);

  const source = await pickSource(document, editor.selection);
  if (!source) return;

  const targets = await client.sendRequest<DescribeTargetsResult | null>("express/describeTargets", { uri, start, end });
  // A selection the edit could not remove stops the command here, before any choice (ruling R14).
  if (targets?.sourceRefusal) {
    void vscode.window.showErrorMessage(`${TITLE}: ${targets.sourceRefusal}`);
    return;
  }
  if (!targets || targets.targets.length === 0) {
    void vscode.window.showInformationMessage("This file has no declaration that can be described.");
    return;
  }
  const target = await pickTarget(targets);
  if (!target) return;

  const role = await pickRole();
  if (!role) return;

  const memberTexts = role === "description" ? await askMembers(target, targets.existing) : [];
  if (!memberTexts) return;

  const main = await prepareText(client, uri, target.key, "Description text", source.text);
  if (!main) return;
  const members: MemberText[] = [];
  for (const member of memberTexts) {
    const prepared = await prepareText(client, uri, member.key, `Text for ${member.key}`, member.text);
    if (!prepared) return;
    members.push({ key: member.key, text: prepared.text, accepted: prepared.accepted });
  }

  const roleKey = target.key + ROLE_SUFFIX[role];
  const exists = targets.existing.some((key) => key.toLowerCase() === roleKey.toLowerCase());
  const mode = exists ? await pickMode(roleKey, role) : "new";
  if (!mode) return;

  const request: DescribeRequest = {
    uri,
    version: targets.version,
    key: target.key,
    role,
    text: main.text,
    accepted: main.accepted,
    members,
    mode,
    source: source.kind === "selection" ? { kind: "selection", start, end } : { kind: source.kind },
  };
  const result = await client.sendRequest<DescribeEditResult>("express/describeEdit", request);
  if (result.refused) {
    void vscode.window.showErrorMessage(`${TITLE}: ${result.refused}`);
    return;
  }
  if (result.edits.length === 0) {
    void vscode.window.showInformationMessage(`${TITLE}: nothing to write.`);
    return;
  }
  if (result.findings.length > 0 && !(await confirmFindings(result))) return;

  if (document.version !== targets.version) {
    void vscode.window.showWarningMessage(`${TITLE}: the file changed while you were working; nothing was written. Run the command again.`);
    return;
  }
  await applyEdits(document.uri, result);
}

// ------------------------------------------------------------------ steps

interface Source {
  kind: "selection" | "typed" | "clipboard";
  text: string;
}

/** Step 1: the selection, or typed text, or the clipboard. */
async function pickSource(document: vscode.TextDocument, selection: vscode.Selection): Promise<Source | undefined> {
  if (!selection.isEmpty) return { kind: "selection", text: document.getText(selection) };
  const choice = await vscode.window.showQuickPick(["Type the text", "Use the clipboard"], {
    title: TITLE,
    placeHolder: "Where does the description text come from?",
  });
  if (!choice) return undefined;
  let text: string | undefined;
  let kind: "typed" | "clipboard";
  if (choice === "Type the text") {
    kind = "typed";
    text = await vscode.window.showInputBox({ title: TITLE, prompt: "Description text" });
  } else {
    kind = "clipboard";
    text = await vscode.env.clipboard.readText();
  }
  if (text === undefined) return undefined;
  if (text.trim() === "") {
    void vscode.window.showInformationMessage(`${TITLE}: there is no text to use.`);
    return undefined;
  }
  return { kind, text };
}

/** Step 2: the declaration or member to describe, the default first. */
async function pickTarget(result: DescribeTargetsResult): Promise<DescribeTarget | undefined> {
  const ordered = [...result.targets];
  const at = ordered.findIndex((target) => target.key === result.defaultKey);
  if (at > 0) ordered.unshift(...ordered.splice(at, 1));
  const picked = await vscode.window.showQuickPick(
    ordered.map((target) => ({ label: target.key, description: target.kind, target })),
    { title: TITLE, placeHolder: "Which declaration does the text describe?", matchOnDescription: true },
  );
  return picked?.target;
}

/** Step 3. */
async function pickRole(): Promise<BlockRole | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "Description", role: "description" as const },
      { label: "Note", role: "note" as const },
      { label: "Example", role: "example" as const },
    ],
    { title: TITLE, placeHolder: "What kind of block?" },
  );
  return picked?.role;
}

/**
 * Step 4: one input box per parameter or item that has no block yet; empty means no block. The
 * members that have one are named and skipped (ruling R13). Undefined means cancelled.
 */
async function askMembers(target: DescribeTarget, existing: readonly string[]): Promise<Array<{ key: string; text: string }> | undefined> {
  const { ask, described } = splitMembers(target.members ?? [], existing);
  if (described.length > 0) {
    const one = described.length === 1;
    void vscode.window.showInformationMessage(
      `${TITLE}: ${described.join(", ")} already ${one ? "has a description and is" : "have descriptions and are"} skipped; ` +
        `describe ${one ? "it" : "each"} on its own to change it.`,
    );
  }
  const result: Array<{ key: string; text: string }> = [];
  for (const key of ask) {
    const text = await vscode.window.showInputBox({
      title: TITLE,
      prompt: `Text for ${key} (leave empty for no block)`,
    });
    if (text === undefined) return undefined;
    if (text.trim() !== "") result.push({ key, text });
  }
  return result;
}

/** Steps 5 and 6 for one text: clean-ups, then link proposals. Undefined means cancelled. */
async function prepareText(client: LanguageClient, uri: string, key: string, what: string, original: string): Promise<Chosen | undefined> {
  let text = original;
  const cleanups = findCleanups(text);
  if (cleanups.length > 0) {
    const picked = await vscode.window.showQuickPick(
      cleanups.map((cleanup) => ({ label: cleanup.label, id: cleanup.id, picked: true })),
      { title: `${TITLE}: clean up (${what})`, placeHolder: "Apply these clean-ups?", canPickMany: true },
    );
    if (!picked) return undefined;
    text = applyCleanups(text, new Set<CleanupId>(picked.map((item) => item.id)));
  }
  if (text.trim() === "") {
    void vscode.window.showInformationMessage(`${TITLE}: no text is left after the clean-ups.`);
    return undefined;
  }
  const proposals = await client.sendRequest<LinkProposal[]>("express/describeProposals", { uri, key, text });
  const accepted = await pickProposals(proposals ?? [], what);
  if (!accepted) return undefined;
  return { text, accepted };
}

/** Step 6: the author ticks the proposed links; auto and subject links are the server's. */
async function pickProposals(proposals: LinkProposal[], what: string): Promise<LinkProposal[] | undefined> {
  const proposed = proposals.filter((proposal) => proposal.status === "proposed");
  const ambiguous = proposals.filter((proposal) => proposal.status === "ambiguous");
  if (proposed.length === 0) return [];
  const ambiguousNote =
    ambiguous.length > 0 ? `Not linked, ambiguous: ${ambiguous.map((p) => `${p.text} (${(p.schemas ?? []).join(", ")})`).join("; ")}` : undefined;
  const picked = await vscode.window.showQuickPick(
    proposed.map((proposal) => ({
      label: proposal.text,
      description: proposal.schema ? `${proposal.schema}.${proposal.name}` : proposal.name,
      detail: ambiguousNote,
      picked: false,
      proposal,
    })),
    { title: `${TITLE}: links (${what})`, placeHolder: "Tick the words to link", canPickMany: true },
  );
  return picked?.map((item) => item.proposal);
}

/** Step 7: a note or an example may also get another block of its own (ruling R12). */
async function pickMode(roleKey: string, role: BlockRole): Promise<DescribeRequest["mode"] | undefined> {
  const choices: Array<{ label: string; mode: DescribeRequest["mode"] }> = [
    { label: "Append", mode: "append" },
    { label: "Replace", mode: "replace" },
  ];
  if (role !== "description") choices.push({ label: "Add another", mode: "add" });
  const picked = await vscode.window.showQuickPick(choices, {
    title: TITLE,
    placeHolder: `"${roleKey}" already has a block`,
  });
  return picked?.mode;
}

/** Step 8: findings carry no block key, so each message is listed. */
async function confirmFindings(result: DescribeEditResult): Promise<boolean> {
  const lines = result.findings.map((finding) => `- ${finding.message}`).join("\n");
  const answer = await vscode.window.showWarningMessage(
    `The new text has findings:\n${lines}`,
    { modal: true },
    "Apply",
  );
  return answer === "Apply";
}

/** Step 9: one WorkspaceEdit, shown in VS Code's refactor preview, one undo. */
async function applyEdits(uri: vscode.Uri, result: DescribeEditResult): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  const metadata: vscode.WorkspaceEditEntryMetadata = { label: TITLE, needsConfirmation: true };
  for (const change of result.edits) {
    const range = new vscode.Range(change.range.start.line, change.range.start.character, change.range.end.line, change.range.end.character);
    edit.replace(uri, range, change.newText, metadata);
  }
  await vscode.workspace.applyEdit(edit);
}
