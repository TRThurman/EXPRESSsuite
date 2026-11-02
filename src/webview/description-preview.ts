/* Description preview controller. Loads vendor ESMs via dynamic import().
 * CSP allows 'unsafe-eval' (Opal). Asciidoctor + Plurimath + DOMPurify are
 * served as webview assets and imported at runtime — bundling breaks Opal.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { expressTagFromHref } from "../shared/express-xref.js";

declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };

const vscode = (window as any).__vscode ?? acquireVsCodeApi();
const log = (level: "info" | "warn" | "error", message: string) =>
  vscode.postMessage({ kind: "log", level, message });

interface Payload {
  tag: string;
  body: string;
  baseHref: string;
  asciidoctorUrl: string;
  dompurifyUrl: string;
  /** Map from AsciiMath expression text → MathML pre-rendered by host Plurimath. */
  mathRenders: Record<string, string>;
}

const HTML_PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "div", "p", "span", "a", "strong", "em", "code", "pre", "kbd", "mark",
    "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
    "img", "figure", "figcaption",
    "math", "mi", "mo", "mn", "ms", "mtext", "mrow", "msup", "msub", "msubsup",
    "mfrac", "mroot", "msqrt", "munder", "mover", "munderover", "mstyle",
    "mspace", "mtable", "mtr", "mtd", "mlabeledtr", "merror", "mphantom",
    "mfenced", "menclose", "mpadded", "maction", "semantics", "annotation",
  ],
  ALLOWED_ATTR: [
    "href", "title", "alt", "src", "class", "id", "lang",
    "rowspan", "colspan", "scope",
    "display", "displaystyle", "mathvariant", "mathcolor", "mathbackground",
    "fontfamily", "fontstyle", "fontweight", "fontsize",
    "linethickness", "form", "fence", "separator", "lspace", "rspace",
    "stretchy", "symmetric", "maxsize", "minsize", "largeop", "movablelimits",
    "accent", "accentunder", "frame", "framespacing", "rowalign", "columnalign",
    "xmlns",
  ],
  ALLOWED_URI_REGEXP: /^(https?:|mailto:|#|command:vscode\.open|command:expresssuite\.)/,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
  FORBID_ATTR: [
    "onload", "onclick", "onerror", "onmouseover", "onmouseout", "onfocus",
    "onblur", "oninput", "onchange", "onsubmit", "style",
  ],
};

const STEM_RE = /stem:\[((?:\\.|[^\]])*)\]/g;
const LATEXMATH_RE = /latexmath:\[((?:\\.|[^\]])*)\]/g;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function main(): Promise<void> {
  const payloadEl = document.getElementById("payload");
  if (!payloadEl?.textContent) {
    document.getElementById("content")!.textContent = "No content";
    return;
  }
  const payload: Payload = JSON.parse(payloadEl.textContent);
  document.getElementById("tag")!.textContent = payload.tag;

  log("info", "loading dompurify");
  const dompurifyMod = await import(/* @vite-ignore */ payload.dompurifyUrl);
  const DOMPurify = (dompurifyMod as any).default;
  log("info", "loading asciidoctor");
  const asciidoctorMod = await import(/* @vite-ignore */ payload.asciidoctorUrl);
  const convert = (asciidoctorMod as any).convert as
    (input: string, options?: object) => Promise<unknown>;
  log("info", "vendor modules loaded; using host-prerendered math");

  // Use the host-prerendered MathML map (no Plurimath in webview).
  const placeholders: string[] = [];
  const splice = (label: string) => (_full: string, expr: string) => {
    const html = payload.mathRenders[expr];
    if (html) {
      const id = placeholders.length;
      placeholders.push(html);
      return ` STEM_PLACEHOLDER_${id} `;
    }
    return `\`${label}:[${expr}]\``;
  };
  const preprocessed = payload.body
    .replace(STEM_RE, splice("stem"))
    .replace(LATEXMATH_RE, splice("latexmath"));

  let html: string;
  try {
    const doc = await convert(preprocessed, {
      safe: "secure",
      doctype: "article",
      attributes: { showtitle: false, noheader: true, "skip-front-matter": true },
    });
    const sanitized = DOMPurify.sanitize(String(doc), HTML_PURIFY_CONFIG);
    html = sanitized.replace(/ STEM_PLACEHOLDER_(\d+) /g, (_full: string, idx: string) => {
      const i = parseInt(idx, 10);
      return placeholders[i] ?? "";
    });
  } catch (err) {
    log("error", `render failure: ${(err as Error).message}`);
    document.getElementById("content")!.innerHTML =
      `<pre class="err">Render failed:\n${escapeHtml((err as Error).message)}</pre>`;
    return;
  }

  const content = document.getElementById("content")!;
  content.innerHTML = html;
  // An `<<express:tag,label>>` cross-reference renders as an in-page anchor
  // (`href="#express:tag"`) with no target in this page. A click opens that
  // tag's description on the host, which is what the same link does from a
  // hover; every other link keeps its default behaviour.
  content.addEventListener("click", (ev) => {
    const anchor = (ev.target as Element | null)?.closest?.("a");
    if (!anchor) return;
    const tag = expressTagFromHref(anchor.getAttribute("href"));
    if (!tag) return;
    ev.preventDefault();
    log("info", `xref -> navigate(${tag})`);
    vscode.postMessage({ kind: "navigate", targetName: tag });
  });
  log("info", "render complete");
}

main().catch((err) => {
  log("error", `controller threw: ${(err as Error).message} ${(err as Error).stack ?? ""}`);
  const el = document.getElementById("content");
  if (el) el.innerHTML = `<pre class="err">${escapeHtml((err as Error).message)}</pre>`;
});
