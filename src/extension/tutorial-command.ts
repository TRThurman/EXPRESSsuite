import * as vscode from "vscode";
import { EXPRESSSUITE_COMMANDS } from "../shared/commands.js";
import { TUTORIAL_DEMO_FILE, TUTORIAL_DEMO_FOLDER, TUTORIAL_DEMO_PATH, TUTORIAL_TEXT_PATH } from "../shared/tutorial.js";

/* Open Tutorial: the tutorial text and its demo schemas are in the package. The demo is edited
 * by whoever follows the tutorial, so it is copied to the extension's own storage folder first
 * (the installed package is replaced at every update) and opened in a window of its own, with
 * the tutorial beside the schema.
 */

/** Set once the note on Restricted Mode has been shown. */
const TRUST_EXPLAINED = "expresssuite.tutorial.trustExplained";
const OPEN = "Open the demo";

const CONTINUE = "Continue with my copy of the demo";
const START_OVER = "Start over with a fresh copy of the demo";

export function registerTutorialCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(EXPRESSSUITE_COMMANDS.openTutorial, () => openTutorial(context)),
  );
  void resumeTutorial(context);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function isOpenFolder(folder: vscode.Uri): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some((open) => open.uri.toString() === folder.toString());
}

/**
 * The user's copy of the demo. A file: URI, whatever scheme VS Code gives its storage folder
 * (`vscode-userdata:` in a profile of its own): the language server reads the workspace from disk.
 */
function demoCopy(context: vscode.ExtensionContext): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(context.globalStorageUri.fsPath), TUTORIAL_DEMO_FOLDER);
}

async function openTutorial(context: vscode.ExtensionContext): Promise<void> {
  const packaged = vscode.Uri.joinPath(context.extensionUri, ...TUTORIAL_DEMO_PATH);
  const copy = demoCopy(context);
  try {
    let fresh = true;
    if (await exists(vscode.Uri.joinPath(copy, TUTORIAL_DEMO_FILE))) {
      const picked = await vscode.window.showQuickPick([CONTINUE, START_OVER], {
        placeHolder: "The tutorial's demo schemas are already on this computer",
      });
      if (!picked) return;
      fresh = picked === START_OVER;
    }
    if (fresh) {
      // Files of the demo are written over; anything else in the folder is left alone.
      await vscode.workspace.fs.createDirectory(copy);
      for (const [name, type] of await vscode.workspace.fs.readDirectory(packaged)) {
        if (type !== vscode.FileType.File) continue;
        await vscode.workspace.fs.copy(vscode.Uri.joinPath(packaged, name), vscode.Uri.joinPath(copy, name), { overwrite: true });
      }
    }
    if (isOpenFolder(copy)) {
      await showTutorial(context, copy);
      return;
    }
    // VS Code opens a folder it has not seen before in Restricted Mode, in which this extension
    // does not run: nothing would happen in the new window, with no word of why. Say it first.
    const trustEnabled = vscode.workspace.getConfiguration("security.workspace.trust").get<boolean>("enabled", true);
    if (trustEnabled && !context.globalState.get<boolean>(TRUST_EXPLAINED)) {
      const answer = await vscode.window.showInformationMessage(
        "The demo opens in a new window.",
        {
          modal: true,
          detail:
            "If that window shows \"Restricted Mode\" in its status bar, click it and choose Trust. " +
            "EXPRESSsuite does not run in a folder until it is trusted.",
        },
        OPEN,
      );
      if (answer !== OPEN) return;
      await context.globalState.update(TRUST_EXPLAINED, true);
    }
    // The schema is opened with the folder: an EXPRESS file in an editor starts the extension in
    // the new window, which finds itself on the demo copy and shows the tutorial (resumeTutorial).
    await vscode.commands.executeCommand("vscode.openFolder", copy, {
      forceNewWindow: true,
      filesToOpen: [vscode.Uri.joinPath(copy, TUTORIAL_DEMO_FILE)],
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`EXPRESSsuite: the tutorial could not be opened: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * When the extension starts in a window on the demo copy, the tutorial is shown beside the schema,
 * unless a Markdown preview is already there (a restored window). The folder is the signal: state
 * written by the window that ran the command may not have reached this one yet.
 */
async function resumeTutorial(context: vscode.ExtensionContext): Promise<void> {
  const copy = demoCopy(context);
  if (!isOpenFolder(copy)) return;
  if (previewIsOpen()) return;
  try {
    await showTutorial(context, copy);
  } catch {
    /* the folder is open; the command shows the tutorial when run again */
  }
}

/** Whether a Markdown preview, which in the demo window is the tutorial, is among the tabs. */
function previewIsOpen(): boolean {
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes("markdown.preview")),
  );
}

async function showTutorial(context: vscode.ExtensionContext, folder: vscode.Uri): Promise<void> {
  await vscode.window.showTextDocument(vscode.Uri.joinPath(folder, TUTORIAL_DEMO_FILE), {
    viewColumn: vscode.ViewColumn.One,
    preview: false,
  });
  if (previewIsOpen()) return;
  await vscode.commands.executeCommand("markdown.showPreviewToSide", vscode.Uri.joinPath(context.extensionUri, ...TUTORIAL_TEXT_PATH));
}
