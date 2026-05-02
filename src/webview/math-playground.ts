/* AsciiMath playground controller. Loads Plurimath via dynamic import(). */
/* eslint-disable @typescript-eslint/no-explicit-any */

declare function acquireVsCodeApi(): { postMessage: (m: unknown) => void };

const vscode = (window as any).__vscode ?? acquireVsCodeApi();
const log = (level: "info" | "warn" | "error", message: string) =>
  vscode.postMessage({ kind: "log", level, message });

interface Payload {
  plurimathUrl: string;
}

const DEBOUNCE_MS = 200;

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

async function main(): Promise<void> {
  const payloadEl = document.getElementById("payload");
  const payload: Payload = payloadEl?.textContent ? JSON.parse(payloadEl.textContent) : { plurimathUrl: "" };

  const plurimathMod = await import(/* @vite-ignore */ payload.plurimathUrl);
  const Plurimath = (plurimathMod as any).default;

  const src = document.getElementById("src") as HTMLTextAreaElement;
  const out = document.getElementById("out") as HTMLDivElement;
  const status = document.getElementById("status") as HTMLSpanElement;
  const insertBtn = document.getElementById("insert") as HTMLButtonElement;

  const render = (asciimath: string): { html?: string; error?: string; ms: number } => {
    const t0 = performance.now();
    try {
      const p = new Plurimath(asciimath, "asciimath");
      const mml = p.toMathml();
      return { html: mml, ms: performance.now() - t0 };
    } catch (err) {
      return { error: (err as Error).message, ms: performance.now() - t0 };
    }
  };

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

  update();
  log("info", "math playground ready");
}

main().catch((err) => log("error", `controller threw: ${(err as Error).message}`));
