/* AsciiMath playground controller. Sends typed-in AsciiMath to the host
 * via debounced postMessage; receives rendered MathML back. No Plurimath
 * in webview — Opal runtime is unreliable here (DESIGN §1.2.4 / §2.2).
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

let nextId = 1;
let latestId = 0;
const pending = new Map<number, { t0: number }>();

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

function main(): void {
  const src = document.getElementById("src") as HTMLTextAreaElement;
  const out = document.getElementById("out") as HTMLDivElement;
  const status = document.getElementById("status") as HTMLSpanElement;
  const insertBtn = document.getElementById("insert") as HTMLButtonElement;

  const requestRender = () => {
    const expr = src.value;
    if (expr.length === 0) {
      out.innerHTML = "<em>Empty.</em>";
      status.textContent = "";
      return;
    }
    if (expr.length > MAX_EXPR_CHARS) {
      out.innerHTML = `<div class="err">Expression exceeds ${MAX_EXPR_CHARS} chars</div>`;
      status.textContent = "rejected";
      return;
    }
    const id = nextId++;
    latestId = id;
    pending.set(id, { t0: performance.now() });
    status.textContent = "rendering…";
    vscode.postMessage({ kind: "renderMath", id, expr });
  };

  const debouncedRequest = debounce(requestRender, DEBOUNCE_MS);
  src.addEventListener("input", debouncedRequest);

  window.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data as RenderedMessage;
    if (!data || data.kind !== "mathRendered" || typeof data.id !== "number") return;
    const meta = pending.get(data.id);
    pending.delete(data.id);
    // Discard stale responses.
    if (data.id !== latestId) return;
    const ms = meta ? performance.now() - meta.t0 : 0;
    if (data.error) {
      out.innerHTML = `<div class="err">${escapeHtml(data.error)}</div>`;
      status.textContent = `error in ${ms.toFixed(0)}ms`;
    } else if (data.mathml) {
      out.innerHTML = data.mathml;
      status.textContent = `rendered in ${ms.toFixed(0)}ms`;
    }
  });

  insertBtn.addEventListener("click", () => {
    const text = src.value.trim();
    if (text.length === 0) return;
    if (text.length > 4096) {
      log("warn", "math input exceeds 4096-char insert cap");
      return;
    }
    vscode.postMessage({ kind: "insert", text: `stem:[${text}]` });
  });

  // Initial render of the placeholder text.
  requestRender();
  log("info", "math playground ready");
}

try {
  main();
} catch (err) {
  log("error", `controller threw: ${(err as Error).message}`);
}
