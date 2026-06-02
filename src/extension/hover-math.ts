/**
 * Lazy MathJax v4 (input/asciimath + output/svg) renderer for HoverProvider use.
 * Plurimath remains the renderer for description-preview/math-playground webviews;
 * MathJax is used here only because hovers cannot host MathML or scripts (DESIGN
 * §1.2.4, §M5). Output is a standalone <svg> string suitable for embedding as a
 * data URI in `<img src>`.
 *
 * Resource limits (DESIGN §1.2.8.10):
 *   - per-expression char cap (rejects oversized inputs at the gate)
 *   - 2-second async render timeout (prevents pathological hangs)
 *   - LRU cache eviction (bounds memory growth across long sessions)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_EXPR_CHARS = 16_384;
const RENDER_TIMEOUT_MS = 2000;
const CACHE_MAX_ENTRIES = 1000;

let mathjaxPromise: Promise<any> | null = null;
const cache = new Map<string, string>();
const SVG_OPEN_RE = /<svg\b[\s\S]*?<\/svg>/i;

function getMathJax(): Promise<any> {
  if (!mathjaxPromise) {
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

/** Move `key` to the most-recently-used position, evicting oldest if over cap. */
function touchCache(key: string, value: string): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`render timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Render an AsciiMath expression to a standalone <svg> string.
 * Returns undefined if MathJax is not yet ready (caller should fall back to
 * code-styled text). The first call kicks off init; subsequent calls are sync
 * once cached.
 */
export function renderAsciiMathSvg(expr: string): string | undefined {
  return cache.get(expr);
}

/**
 * Pre-warm: render an expression and populate the cache. Returns the SVG, or
 * undefined on cap/timeout/render failure.
 */
export async function renderAsciiMathSvgAsync(expr: string): Promise<string | undefined> {
  if (expr.length > MAX_EXPR_CHARS) {
    console.warn(`[easyEXPRESS hover-math] expr exceeds ${MAX_EXPR_CHARS} chars; skipping`);
    return undefined;
  }
  const cached = cache.get(expr);
  if (cached !== undefined) {
    // touch (LRU)
    cache.delete(expr);
    cache.set(expr, cached);
    return cached;
  }
  try {
    const MathJax = await getMathJax();
    const node = await withTimeout(MathJax.asciimath2svgPromise(expr), RENDER_TIMEOUT_MS);
    const outer: string = MathJax.startup.adaptor.outerHTML(node);
    const svg = extractSvg(outer);
    if (!svg) {
      console.warn(`[easyEXPRESS hover-math] no <svg> in MathJax output for "${expr}"`);
      return undefined;
    }
    const themed = svg.replace(/<svg\b/, '<svg fill="currentColor"');
    touchCache(expr, themed);
    return themed;
  } catch (e) {
    console.error(`[easyEXPRESS hover-math] render failed for "${expr.slice(0, 60)}":`, e);
    return undefined;
  }
}

export function svgToDataUri(svg: string): string {
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}
