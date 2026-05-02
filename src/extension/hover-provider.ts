import * as vscode from "vscode";
import { AnnotationIndex, type RemarkAnnotation } from "./annotation-index.js";

const HOVER_PREVIEW_CHAR_LIMIT = 320;

const indexCache = new Map<string, { version: number; index: AnnotationIndex }>();

function getIndex(doc: vscode.TextDocument): AnnotationIndex {
  const key = doc.uri.toString();
  const cached = indexCache.get(key);
  if (cached && cached.version === doc.version) {
    return cached.index;
  }
  const idx = new AnnotationIndex(doc.getText());
  indexCache.set(key, { version: doc.version, index: idx });
  return idx;
}

/** Strip a known prefix; trim trailing/leading whitespace. */
function preview(body: string, limit = HOVER_PREVIEW_CHAR_LIMIT): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}

/** Pick the best annotation for an entity hover: prefer the bare path; else first __note; else any. */
function pickPrimary(anns: readonly RemarkAnnotation[], path: string): RemarkAnnotation | undefined {
  if (anns.length === 0) return undefined;
  const exact = anns.find((a) => a.tag === path);
  if (exact) return exact;
  const note = anns.find((a) => a.tag === `${path}.__note`);
  if (note) return note;
  return anns[0];
}

export class ExpressHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.Hover> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return undefined;
    const word = document.getText(wordRange);

    const idx = getIndex(document);
    const matches = idx.byEntityName(word);
    if (matches.length === 0) return undefined;

    // Prefer matches that are exactly schema.entity (or its __subtypes).
    const candidatePaths = new Set<string>();
    for (const m of matches) {
      if (m.parts.length >= 2 && m.parts[1] === word) {
        candidatePaths.add(`${m.parts[0]}.${m.parts[1]}`);
      }
    }
    const path = candidatePaths.size > 0 ? Array.from(candidatePaths)[0] : undefined;
    if (!path) return undefined;

    const anns = idx.byPath(path);
    const primary = pickPrimary(anns, path);
    if (!primary) return undefined;

    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = {
      enabledCommands: [
        "vscode.open",
        "express.showDescription",
        "express.showExpressG",
      ],
    };

    md.appendMarkdown(`**${path}**\n\n`);
    md.appendMarkdown(preview(primary.body));

    if (anns.length > 1) {
      const subtypes = anns
        .filter((a) => a !== primary && a.parts.length > 2)
        .map((a) => a.parts.slice(2).join("."))
        .filter((s) => s.length > 0);
      if (subtypes.length > 0) {
        md.appendMarkdown(`\n\n*Other annotations: ${subtypes.join(", ")}*`);
      }
    }

    const showCmd = vscode.Uri.parse(
      `command:express.showDescription?${encodeURIComponent(JSON.stringify({ path }))}`,
    );
    md.appendMarkdown(`\n\n[Show full description](${showCmd})`);

    return new vscode.Hover(md, wordRange);
  }
}

export function registerHoverProvider(context: vscode.ExtensionContext): void {
  const provider = new ExpressHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: "file", language: "express" }, provider),
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => indexCache.delete(doc.uri.toString())),
  );
}
