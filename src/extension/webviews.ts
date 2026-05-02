import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { RemarkAnnotation } from "./annotation-index.js";
import { validateMessage } from "./webview-message.js";

/* ----- Shared CSP / nonce helpers --------------------------------------- */

function nonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function localResourceRoots(context: vscode.ExtensionContext, docUri?: vscode.Uri): vscode.Uri[] {
  const roots: vscode.Uri[] = [context.extensionUri];
  if (docUri) {
    const folder = vscode.workspace.getWorkspaceFolder(docUri);
    if (folder) roots.push(folder.uri);
    else roots.push(vscode.Uri.file(path.dirname(docUri.fsPath)));
  }
  return roots;
}

function vendor(context: vscode.ExtensionContext, ...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, "out", "webview", "vendor", ...segments);
}

function controllerJs(context: vscode.ExtensionContext, name: string): vscode.Uri {
  return vscode.Uri.joinPath(context.extensionUri, "out", "webview", `${name}.js`);
}

/* ----- Description preview ---------------------------------------------- */

function descriptionHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  ann: RemarkAnnotation,
  baseDirUri: vscode.Uri,
): string {
  const n = nonce();
  const cspSrc = webview.cspSource;
  const asciidoctorJs = webview.asWebviewUri(vendor(context, "asciidoctor.min.js"));
  const asciidoctorCss = webview.asWebviewUri(vendor(context, "asciidoctor.css"));
  const plurimathWrapper = webview.asWebviewUri(vendor(context, "plurimath.js"));
  const plurimathOpal = webview.asWebviewUri(vendor(context, "plurimath-opal.js"));
  const dompurify = webview.asWebviewUri(vendor(context, "dompurify.min.js"));
  const ctrl = webview.asWebviewUri(controllerJs(context, "description-preview"));
  const baseHref = webview.asWebviewUri(baseDirUri).toString();

  // Embed source as a JSON-encoded data block read by the controller.
  const payload = JSON.stringify({ tag: ann.tag, body: ann.body, baseHref });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src ${cspSrc} 'unsafe-eval' 'nonce-${n}';
               style-src ${cspSrc} 'unsafe-inline';
               img-src ${cspSrc} data: https:;
               font-src ${cspSrc};
               connect-src 'none';">
<link rel="stylesheet" href="${asciidoctorCss}">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; padding: 16px; max-width: 900px; }
  body { color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  pre { background: var(--vscode-editorWidget-background); padding: 8px; }
  math { font-size: 1.1em; }
  a { color: var(--vscode-textLink-foreground); }
  .err { color: var(--vscode-errorForeground); }
  h1 { font-size: 16px; color: var(--vscode-descriptionForeground); margin-top: 0; }
</style>
</head>
<body>
<h1 id="tag"></h1>
<div id="content">Loading…</div>
<script type="application/json" id="payload">${payload}</script>
<script src="${plurimathOpal}" nonce="${n}"></script>
<script src="${plurimathWrapper}" nonce="${n}"></script>
<script src="${asciidoctorJs}" nonce="${n}"></script>
<script src="${dompurify}" nonce="${n}"></script>
<script type="module" src="${ctrl}" nonce="${n}"></script>
</body>
</html>`;
}

export async function showDescriptionPreview(
  context: vscode.ExtensionContext,
  ann: RemarkAnnotation,
  sourceUri: vscode.Uri,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "express.descriptionPreview",
    `Description · ${ann.tag}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: localResourceRoots(context, sourceUri),
    },
  );
  const baseDirUri = vscode.Uri.file(path.dirname(sourceUri.fsPath));
  panel.webview.html = descriptionHtml(context, panel.webview, ann, baseDirUri);

  panel.webview.onDidReceiveMessage((raw) => {
    const msg = validateMessage(raw);
    if (!msg) return;
    if (msg.kind === "log") {
      console.log(`[descriptionPreview ${msg.level}] ${msg.message}`);
    }
  });
}

/* ----- EXPRESS-G SVG preview -------------------------------------------- */

export async function showExpressGPreview(
  context: vscode.ExtensionContext,
  svgUri: vscode.Uri,
  schemaSourceUri: vscode.Uri,
  resolveTarget: (name: string) => Promise<{ uri: vscode.Uri; range: vscode.Range } | undefined>,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "express.expressGPreview",
    `EXPRESS-G · ${path.basename(svgUri.fsPath)}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: localResourceRoots(context, schemaSourceUri),
    },
  );

  const svgText = await fs.readFile(svgUri.fsPath, "utf8");
  const ctrl = panel.webview.asWebviewUri(controllerJs(context, "expressg-preview"));
  const dompurify = panel.webview.asWebviewUri(vendor(context, "dompurify.min.js"));
  const n = nonce();
  const cspSrc = panel.webview.cspSource;
  const payload = JSON.stringify({ svg: svgText });

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src ${cspSrc} 'nonce-${n}';
               style-src ${cspSrc} 'unsafe-inline';
               img-src ${cspSrc} data:;
               connect-src 'none';">
<style>
  body { margin: 0; background: var(--vscode-editor-background); }
  #host { width: 100vw; height: 100vh; overflow: auto; padding: 16px; box-sizing: border-box; }
  #host svg { max-width: 100%; height: auto; cursor: default; }
  #host a[href] { cursor: pointer; }
</style>
</head>
<body>
<div id="host">Rendering…</div>
<script type="application/json" id="payload">${payload}</script>
<script src="${dompurify}" nonce="${n}"></script>
<script type="module" src="${ctrl}" nonce="${n}"></script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(async (raw) => {
    const msg = validateMessage(raw);
    if (!msg) return;
    if (msg.kind === "navigate") {
      const target = await resolveTarget(msg.targetName);
      if (target) {
        const editor = await vscode.window.showTextDocument(target.uri, {
          selection: target.range,
          preview: true,
          viewColumn: vscode.ViewColumn.One,
        });
        editor.revealRange(target.range, vscode.TextEditorRevealType.InCenter);
      } else {
        vscode.window.showInformationMessage(`No definition found for ${msg.targetName}`);
      }
    } else if (msg.kind === "log") {
      console.log(`[expressGPreview ${msg.level}] ${msg.message}`);
    }
  });
}

/* ----- Math playground -------------------------------------------------- */

export function openMathPlayground(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    "express.mathPlayground",
    "AsciiMath Playground",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [context.extensionUri],
    },
  );
  const ctrl = panel.webview.asWebviewUri(controllerJs(context, "math-playground"));
  const plurimathWrapper = panel.webview.asWebviewUri(vendor(context, "plurimath.js"));
  const plurimathOpal = panel.webview.asWebviewUri(vendor(context, "plurimath-opal.js"));
  const n = nonce();
  const cspSrc = panel.webview.cspSource;

  panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src ${cspSrc} 'unsafe-eval' 'nonce-${n}';
               style-src ${cspSrc} 'unsafe-inline';
               connect-src 'none';">
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px; height: 100vh; box-sizing: border-box; }
  textarea { width: 100%; height: 100%; resize: none; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; padding: 8px;
             background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
  #out { padding: 12px; overflow: auto; border: 1px solid var(--vscode-input-border); }
  math { font-size: 1.4em; }
  .err { color: var(--vscode-errorForeground); white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 12px; }
  .toolbar { padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; gap: 8px; align-items: center; font-size: 12px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<div class="toolbar">
  <span>AsciiMath input → live MathML render. </span>
  <button id="insert">Insert at cursor</button>
  <span id="status"></span>
</div>
<div class="panes">
  <textarea id="src" spellcheck="false" placeholder="Type AsciiMath, e.g.  sum_(i=1)^n i^3=((n(n+1))/2)^2">sum_(i=1)^n i^3=((n(n+1))/2)^2</textarea>
  <div id="out">Loading…</div>
</div>
<script src="${plurimathOpal}" nonce="${n}"></script>
<script src="${plurimathWrapper}" nonce="${n}"></script>
<script type="module" src="${ctrl}" nonce="${n}"></script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(async (raw) => {
    const msg = validateMessage(raw);
    if (!msg) return;
    if (msg.kind === "insert") {
      const editor = vscode.window.visibleTextEditors.find((e) => e.document.languageId === "express");
      if (editor) {
        await editor.edit((b) => b.insert(editor.selection.active, msg.text));
        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
      } else {
        vscode.window.showInformationMessage("No active EXPRESS editor to insert into.");
      }
    } else if (msg.kind === "log") {
      console.log(`[mathPlayground ${msg.level}] ${msg.message}`);
    }
  });
}
