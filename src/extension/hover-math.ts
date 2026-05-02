/**
 * Lazy MathJax v4 (input/asciimath + output/svg) renderer for HoverProvider use.
 * Plurimath remains the renderer for description-preview/math-playground webviews;
 * MathJax is used here only because hovers cannot host MathML or scripts (DESIGN
 * §1.2.4, §M5). Output is a standalone <svg> string suitable for embedding as a
 * data URI in `<img src>`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

let mathjaxPromise: Promise<any> | null = null;
const cache = new Map<string, string>();
const SVG_OPEN_RE = /<svg\b[\s\S]*?<\/svg>/i;

function getMathJax(): Promise<any> {
  if (!mathjaxPromise) {
    // No published @types/mathjax for v4; use require + any.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mj = require("mathjax");
    mathjaxPromise = mj.init({ loader: { load: ["input/asciimath", "output/svg"] } });
  }
  return mathjaxPromise!;
}

function extractSvg(outer: string): string | undefined {
  const m = outer.match(SVG_OPEN_RE);
  return m ? m[0] : undefined;
}

/**
 * Render an AsciiMath expression to a standalone <svg> string.
 * Returns undefined if MathJax is not yet ready (caller should fall back to
 * code-styled text). The first call kicks off init; subsequent calls are sync
 * once cached.
 */
export function renderAsciiMathSvg(expr: string): string | undefined {
  const cached = cache.get(expr);
  if (cached !== undefined) return cached;
  return undefined;
}

/**
 * Pre-warm: render a batch of expressions and populate the cache. Returns once
 * all are rendered. Caller should await this before producing the hover.
 */
export async function renderAsciiMathSvgAsync(expr: string): Promise<string | undefined> {
  const cached = cache.get(expr);
  if (cached !== undefined) return cached;
  try {
    const MathJax = await getMathJax();
    const node = await MathJax.asciimath2svgPromise(expr);
    const outer: string = MathJax.startup.adaptor.outerHTML(node);
    const svg = extractSvg(outer);
    if (!svg) {
      console.warn(`[easyEXPRESS hover-math] no <svg> in MathJax output for "${expr}"`);
      return undefined;
    }
    const themed = svg.replace(/<svg\b/, '<svg fill="currentColor"');
    cache.set(expr, themed);
    return themed;
  } catch (e) {
    console.error(`[easyEXPRESS hover-math] render failed for "${expr}":`, e);
    return undefined;
  }
}

export function svgToDataUri(svg: string): string {
  // Use base64 to avoid percent-encoding pitfalls with non-ASCII glyphs.
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}
