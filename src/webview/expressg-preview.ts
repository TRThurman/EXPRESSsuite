/* EXPRESS-G SVG preview controller. Loads DOMPurify via dynamic import. */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };

const vscode = (window as any).__vscode ?? acquireVsCodeApi();
const log = (level: "info" | "warn" | "error", message: string) =>
  vscode.postMessage({ kind: "log", level, message });

interface Payload {
  svg: string;
  dompurifyUrl: string;
  hotspotMap: Record<string, string>;
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
  return /^[0-9]{1,4}$/.test(s);
}

function entityNameForHotspot(hotspotIndex: string, map: Record<string, string>): string | null {
  return map[hotspotIndex] ?? null;
}

async function main(): Promise<void> {
  const payloadEl = document.getElementById("payload");
  const host = document.getElementById("host")!;
  if (!payloadEl?.textContent) {
    host.textContent = "No SVG payload";
    return;
  }
  const payload: Payload = JSON.parse(payloadEl.textContent);

  const dompurifyMod = await import(/* @vite-ignore */ payload.dompurifyUrl);
  const DOMPurify = (dompurifyMod as any).default;

  const clean = DOMPurify.sanitize(payload.svg, PURIFY_CONFIG);
  host.innerHTML = clean;

  host.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!isHotspotName(href)) return;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const targetName = entityNameForHotspot(href, payload.hotspotMap);
      if (targetName) {
        log("info", `hot-spot ${href} → navigate(${targetName})`);
        vscode.postMessage({ kind: "navigate", targetName });
      } else {
        log("info", `clicked hot-spot href="${href}" — no entity mapped`);
      }
    });
  });

  log("info", `rendered SVG with ${host.querySelectorAll("a[href]").length} hot-spot anchors`);
}

main().catch((err) => log("error", `controller threw: ${(err as Error).message}`));
