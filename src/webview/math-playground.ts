/* AsciiMath playground controller. Renders pure AsciiMath in single-expression
 * mode; if the input contains `stem:[…]` or `latexmath:[…]` wrappers, it
 * switches to prose-with-math mode and renders each math segment in place,
 * passing the surrounding prose through verbatim — mirroring the description
 * preview's behaviour, so the playground doubles as a paragraph previewer.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };

const vscode = (window as any).__vscode ?? acquireVsCodeApi();
(window as any).__vscode = vscode;
const log = (level: "info" | "warn" | "error", message: string) =>
  vscode.postMessage({ kind: "log", level, message });

const DEBOUNCE_MS = 200;
const MAX_EXPR_CHARS = 16_384;

interface RenderedMessage {
  kind: "mathRendered";
  id: number;
  mathml?: string;
  error?: string;
}

interface MathSegment {
  start: number;        // index in source text where the wrapper starts (e.g. `stem:[`)
  end: number;          // index where the wrapper ends (just past the closing `]`)
  expr: string;         // the bare expression inside the brackets
  format: "asciimath" | "latex";
  /** Render request id; becomes a key in `pendingMixed.results`. */
  reqId: number;
}

/** State for a single in-flight render request (one user keystroke). */
interface InflightSingle {
  kind: "single";
  reqId: number;
  t0: number;
}
interface InflightMixed {
  kind: "mixed";
  generation: number;
  raw: string;
  segments: MathSegment[];
  results: Map<number, { mathml?: string; error?: string }>;
  t0: number;
}
type Inflight = InflightSingle | InflightMixed;

let nextId = 1;
let latestGeneration = 0;
const inflight = new Map<number, Inflight>();
// Reverse lookup for mixed: req id → generation
const reqToGen = new Map<number, number>();

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let h: number | undefined;
  return ((...args: any[]) => {
    if (h !== undefined) clearTimeout(h);
    h = setTimeout(() => fn(...args), ms) as unknown as number;
  }) as T;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Scan input for `stem:[…]` / `latexmath:[…]` wrappers, balanced-bracket aware.
 * Returns segments in source order.
 */
function findSegments(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  const re = /\b(stem|latexmath):\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const macroStart = m.index;
    const exprStart = m.index + m[0].length;
    // Balanced-bracket scan from exprStart.
    let depth = 1;
    let i = exprStart;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) break; }
      i++;
    }
    if (depth !== 0) continue; // unbalanced; skip
    const expr = text.slice(exprStart, i);
    const format: "asciimath" | "latex" = m[1] === "latexmath" ? "latex" : "asciimath";
    out.push({ start: macroStart, end: i + 1, expr, format, reqId: 0 });
    re.lastIndex = i + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const src = document.getElementById("src") as HTMLTextAreaElement;
  const out = document.getElementById("out") as HTMLDivElement;
  const status = document.getElementById("status") as HTMLSpanElement;
  const insertBtn = document.getElementById("insert") as HTMLButtonElement;

  // Plurimath emits `<math display="block">`, which makes each glyph stack
  // as a block. In mixed-prose mode we want inline flow, so strip that
  // attribute and force inline display on the wrapping element.
  const inlineifyMath = (mathml: string): string => {
    const stripped = mathml.replace(/(<math\b[^>]*?)\s+display="block"/, "$1");
    return `<span class="m">${stripped}</span>`;
  };

  const finishMixed = (job: InflightMixed): void => {
    if (job.generation !== latestGeneration) return; // stale
    let html = "";
    let cursor = 0;
    for (const seg of job.segments) {
      // Append prose between cursor and seg.start, preserving newlines.
      if (cursor < seg.start) {
        html += escapeHtml(job.raw.slice(cursor, seg.start)).replace(/\n/g, "<br>");
      }
      const r = job.results.get(seg.reqId);
      if (r?.mathml) {
        html += inlineifyMath(r.mathml);
      } else {
        // Render failed; show the source verbatim in code form.
        const label = seg.format === "latex" ? "latexmath" : "stem";
        html += `<code>${label}:[${escapeHtml(seg.expr)}]</code>`;
      }
      cursor = seg.end;
    }
    if (cursor < job.raw.length) html += escapeHtml(job.raw.slice(cursor)).replace(/\n/g, "<br>");
    out.innerHTML = html;
    const ms = performance.now() - job.t0;
    const failed = job.segments.filter((s) => !job.results.get(s.reqId)?.mathml).length;
    status.textContent =
      `rendered ${job.segments.length} segment(s)` +
      (failed > 0 ? ` · ${failed} failed` : "") +
      ` in ${ms.toFixed(0)}ms`;
  };

  const requestRender = (): void => {
    const raw = src.value;
    if (raw.length === 0) {
      out.innerHTML = "<em>Empty.</em>";
      status.textContent = "";
      return;
    }
    if (raw.length > MAX_EXPR_CHARS) {
      out.innerHTML = `<div class="err">Input exceeds ${MAX_EXPR_CHARS} chars</div>`;
      status.textContent = "rejected";
      return;
    }
    const generation = ++latestGeneration;
    const segments = findSegments(raw);

    if (segments.length === 0) {
      // Single-expression mode: render the whole input as one AsciiMath expr.
      const id = nextId++;
      const job: InflightSingle = { kind: "single", reqId: id, t0: performance.now() };
      inflight.set(id, job);
      reqToGen.set(id, generation);
      status.textContent = "rendering…";
      vscode.postMessage({ kind: "renderMath", id, expr: raw, format: "asciimath" });
      return;
    }

    // Mixed mode: render each segment, then splice.
    const job: InflightMixed = {
      kind: "mixed",
      generation,
      raw,
      segments,
      results: new Map(),
      t0: performance.now(),
    };
    for (const seg of segments) {
      seg.reqId = nextId++;
      reqToGen.set(seg.reqId, generation);
      inflight.set(seg.reqId, job);
      vscode.postMessage({ kind: "renderMath", id: seg.reqId, expr: seg.expr, format: seg.format });
    }
    status.textContent = `rendering ${segments.length} segment(s)…`;
  };

  const debouncedRequest = debounce(requestRender, DEBOUNCE_MS);
  src.addEventListener("input", debouncedRequest);

  window.addEventListener("message", (ev: MessageEvent) => {
    const raw = ev.data as { kind?: string; [k: string]: unknown };
    if (!raw || typeof raw.kind !== "string") return;
    if (raw.kind === "setSource" && typeof raw.text === "string") {
      src.value = raw.text;
      requestRender();
      return;
    }
    if (raw.kind !== "mathRendered" || typeof raw.id !== "number") return;
    const data = raw as unknown as RenderedMessage;
    const job = inflight.get(data.id);
    if (!job) return;
    inflight.delete(data.id);
    const gen = reqToGen.get(data.id);
    reqToGen.delete(data.id);
    if (gen !== undefined && gen !== latestGeneration) return; // stale

    if (job.kind === "single") {
      const ms = performance.now() - job.t0;
      if (data.error) {
        out.innerHTML = `<div class="err">${escapeHtml(data.error)}</div>`;
        status.textContent = `error in ${ms.toFixed(0)}ms`;
      } else if (data.mathml) {
        out.innerHTML = data.mathml;
        status.textContent = `rendered in ${ms.toFixed(0)}ms`;
      }
      return;
    }

    // Mixed job: collect, finalize when all in.
    job.results.set(data.id, { mathml: data.mathml, error: data.error });
    if (job.results.size === job.segments.length) {
      finishMixed(job);
    }
  });

  insertBtn.addEventListener("click", () => {
    const text = src.value.trim();
    if (text.length === 0) return;
    if (text.length > 4096) {
      log("warn", "math input exceeds 4096-char insert cap");
      return;
    }
    // If the input already contains stem:[…] or latexmath:[…] wrappers, insert
    // verbatim — the user pasted prose and editing it would be surprising.
    // Otherwise wrap as stem:[…].
    const segs = findSegments(text);
    const payload = segs.length > 0 ? text : `stem:[${text}]`;
    vscode.postMessage({ kind: "insert", text: payload });
  });

  requestRender();
  log("info", "math playground ready");
}

try {
  main();
} catch (err) {
  log("error", `controller threw: ${(err as Error).message}`);
}
