import * as vscode from "vscode";
import { AnnotationIndex, type RemarkAnnotation } from "./annotation-index.js";
import { renderAsciiMathSvgAsync, svgToDataUri } from "./hover-math.js";

const HOVER_PREVIEW_CHAR_LIMIT = 360;

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

/* ----- preview & inline transforms -------------------------------------- */

const STEM_RE = /stem:\[((?:\\.|[^\]])*)\]/g;
const XREF_RE = /<<express:([^,>]+?)(?:,\s*([^>]+?))?>>/g;
const STRONG_RE = /\*([^\s*][^*\n]*[^\s*]|[^\s*])\*/g; // asciidoc *strong* (single-asterisk)

/** Truncate text-content while preserving inline markdown tokens we just produced. */
function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit).replace(/\s+\S*$/, "") + "…";
}

interface InlineTransformOptions {
  mathSvgs: Map<string, string>; // expr → already-rendered svg
}

function transformInline(body: string, opts: InlineTransformOptions): string {
  let out = body;

  // 1) Asciidoc *strong* → markdown **strong** (do this BEFORE other transforms
  //    so we don't mangle within URLs etc.)
  out = out.replace(STRONG_RE, (_m, inner) => `**${inner}**`);

  // 2) <<express:tag,label>> → markdown command link
  out = out.replace(XREF_RE, (_m, tag: string, label?: string) => {
    const text = (label ?? tag).trim();
    const cmd = `command:express.showDescription?${encodeURIComponent(JSON.stringify({ path: tag.trim() }))}`;
    return `[${text}](${cmd})`;
  });

  // 3) stem:[expr] → <img src="data:image/svg+xml;base64,..."> if rendered, else `code` fallback
  out = out.replace(STEM_RE, (_m, expr: string) => {
    const svg = opts.mathSvgs.get(expr);
    if (svg) {
      const uri = svgToDataUri(svg);
      const alt = expr.replace(/"/g, "&quot;");
      return `<img src="${uri}" alt="${alt}" title="stem:[${alt}]" style="vertical-align: middle;">`;
    }
    return `\`stem:[${expr}]\``;
  });

  // Collapse whitespace globally for the truncation step.
  return out.replace(/[ \t]+\n/g, "\n").trim();
}

async function gatherMathRenders(body: string): Promise<Map<string, string>> {
  const exprs = new Set<string>();
  STEM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STEM_RE.exec(body)) !== null) exprs.add(m[1]);

  const out = new Map<string, string>();
  await Promise.all(
    Array.from(exprs).map(async (e) => {
      const svg = await renderAsciiMathSvgAsync(e);
      if (svg) out.set(e, svg);
    }),
  );
  return out;
}

function pickPrimary(anns: readonly RemarkAnnotation[], path: string): RemarkAnnotation | undefined {
  if (anns.length === 0) return undefined;
  const exact = anns.find((a) => a.tag === path);
  if (exact) return exact;
  const note = anns.find((a) => a.tag === `${path}.__note`);
  if (note) return note;
  return anns[0];
}

export class ExpressHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][A-Za-z0-9_]*/);
    if (!wordRange) return undefined;
    const word = document.getText(wordRange);

    const idx = getIndex(document);
    const matches = idx.byEntityName(word);
    if (matches.length === 0) return undefined;

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

    // Truncate the source body BEFORE inline transforms so we don't slice in
    // the middle of an xref or a stem:[]. Add a small budget for transform output.
    const truncated = truncate(primary.body, HOVER_PREVIEW_CHAR_LIMIT);
    const mathSvgs = await gatherMathRenders(truncated);
    const transformed = transformInline(truncated, { mathSvgs });

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
    md.appendMarkdown(transformed);

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
