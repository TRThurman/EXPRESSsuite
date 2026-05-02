/* EXPRESS-G SVG preview controller. Sanitizes inline SVG via DOMPurify
 * and intercepts <a href="N"> hot-spot clicks → postMessage navigate.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const DOMPurify: any;
declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };

const vscode = acquireVsCodeApi();
const log = (level: "info" | "warn" | "error", message: string) =>
  vscode.postMessage({ kind: "log", level, message });

interface Payload {
  svg: string;
}

const PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: false },
  ALLOWED_TAGS: [
    "svg", "g", "rect", "path", "text", "tspan", "a", "image", "defs",
    "marker", "line", "circle", "ellipse", "polygon", "polyline", "title",
  ],
  ALLOWED_ATTR: [
    "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry",
    "x1", "y1", "x2", "y2", "points", "d",
    "fill", "stroke", "stroke-width", "stroke-dasharray", "opacity",
    "transform", "viewBox", "xmlns", "xmlns:xlink", "preserveAspectRatio",
    "href", "xlink:href", "class", "id", "style",
    "font-family", "font-size", "text-anchor", "dominant-baseline",
  ],
  ALLOWED_URI_REGEXP: /^(#|data:image\/(gif|png|jpeg|jpg|svg\+xml);base64,|[0-9]+)$/,
  FORBID_TAGS: ["script", "foreignObject", "use", "iframe", "object", "embed"],
  FORBID_ATTR: ["onload", "onclick", "onerror", "onmouseover", "onmouseout", "onfocus", "onblur"],
};

function isHotspotName(s: string): boolean {
  // Hot-spot href is a small integer in the annotated-express format.
  return /^[0-9]{1,4}$/.test(s);
}

function entityNameForHotspot(_hotspotIndex: string): string | null {
  // Phase 2 POC: not yet wired — the index → entity-name mapping needs the
  // [.svgmap] block from the corresponding __expressg remark. Returning the
  // hotspot index unchanged so the host can decide how to resolve it.
  return null;
}

function main(): void {
  const payloadEl = document.getElementById("payload");
  const host = document.getElementById("host")!;
  if (!payloadEl?.textContent) {
    host.textContent = "No SVG payload";
    return;
  }
  const payload: Payload = JSON.parse(payloadEl.textContent);

  const clean = DOMPurify.sanitize(payload.svg, PURIFY_CONFIG);
  host.innerHTML = clean;

  // Wire hot-spot clicks
  host.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!isHotspotName(href)) return;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const targetName = entityNameForHotspot(href);
      if (targetName) {
        vscode.postMessage({ kind: "navigate", targetName });
      } else {
        log("info", `clicked hot-spot href="${href}" — name resolution pending Phase 2 follow-up`);
      }
    });
  });

  log("info", `rendered SVG with ${host.querySelectorAll("a[href]").length} hot-spot anchors`);
}

main();
