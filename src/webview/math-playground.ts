/* AsciiMath playground controller. Two-pane editor with debounced render. */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Plurimath: any;
declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };

const vscode = acquireVsCodeApi();
const log = (level: "info" | "warn" | "error", message: string) =>
  vscode.postMessage({ kind: "log", level, message });

const DEBOUNCE_MS = 200;

function render(asciimath: string): { html?: string; error?: string; ms: number } {
  const t0 = performance.now();
  try {
    const p = new Plurimath(asciimath, "asciimath");
    const mml = p.toMathml();
    return { html: mml, ms: performance.now() - t0 };
  } catch (err) {
    return { error: (err as Error).message, ms: performance.now() - t0 };
  }
}

function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let h: number | undefined;
  return ((...args: any[]) => {
    if (h !== undefined) clearTimeout(h);
    h = setTimeout(() => fn(...args), ms) as unknown as number;
  }) as T;
}

function main(): void {
  const src = document.getElementById("src") as HTMLTextAreaElement;
  const out = document.getElementById("out") as HTMLDivElement;
  const status = document.getElementById("status") as HTMLSpanElement;
  const insertBtn = document.getElementById("insert") as HTMLButtonElement;

  const update = () => {
    const result = render(src.value);
    if (result.error) {
      out.innerHTML = `<div class="err">${escapeHtml(result.error)}</div>`;
      status.textContent = `error in ${result.ms.toFixed(0)}ms`;
    } else {
      out.innerHTML = result.html ?? "";
      status.textContent = `rendered in ${result.ms.toFixed(0)}ms`;
    }
  };

  const debouncedUpdate = debounce(update, DEBOUNCE_MS);

  src.addEventListener("input", debouncedUpdate);
  insertBtn.addEventListener("click", () => {
    const text = src.value.trim();
    if (text.length === 0) return;
    if (text.length > 4096) {
      log("warn", "math input exceeds 4096-char insert cap");
      return;
    }
    vscode.postMessage({ kind: "insert", text: `stem:[${text}]` });
  });

  update(); // initial render of placeholder content
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

main();
