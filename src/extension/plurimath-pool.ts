/**
 * Plurimath worker pool (DESIGN §3.2.4).
 *
 * Pool size 1: math rendering is already batched per-document/per-keystroke.
 * Each render is given a 2-second hard timeout; on timeout the worker is
 * terminated and a fresh one is spawned for the next request — Plurimath's
 * Opal runtime cannot be cancelled mid-evaluation, so termination is the
 * only way to reclaim a hung worker.
 *
 * The 16 KB per-expression character cap from §1.2.8.10 is enforced before
 * the request leaves the host; the timeout is the second-line defence.
 */

import { Worker } from "node:worker_threads";
import * as path from "node:path";
import * as vscode from "vscode";

const RENDER_TIMEOUT_MS = 2000;
const MAX_EXPR_CHARS = 16_384;

interface PendingRender {
  resolve: (result: { mathml?: string; error?: string }) => void;
  timer: NodeJS.Timeout;
}

let extensionContext: vscode.ExtensionContext | undefined;
let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, PendingRender>();

export function initPlurimathPool(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

function spawnWorker(): Worker {
  if (!extensionContext) {
    throw new Error("plurimath-pool: initPlurimathPool not called");
  }
  const workerPath = path.join(
    extensionContext.extensionUri.fsPath,
    "out",
    "extension",
    "workers",
    "plurimath-worker.cjs",
  );
  const w = new Worker(workerPath);
  w.on("message", (msg: { id: number; mathml?: string; error?: string }) => {
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    clearTimeout(slot.timer);
    slot.resolve({ mathml: msg.mathml, error: msg.error });
  });
  w.on("error", (err) => {
    // Drain pending: any in-flight request gets an error response.
    for (const [, slot] of pending) {
      clearTimeout(slot.timer);
      slot.resolve({ error: `worker error: ${err.message}` });
    }
    pending.clear();
    if (worker === w) worker = undefined;
  });
  w.on("exit", (code) => {
    for (const [, slot] of pending) {
      clearTimeout(slot.timer);
      slot.resolve({ error: `worker exited (code ${code})` });
    }
    pending.clear();
    if (worker === w) worker = undefined;
  });
  return w;
}

function getWorker(): Worker {
  if (!worker) worker = spawnWorker();
  return worker;
}

export async function renderMath(expr: string): Promise<{ mathml?: string; error?: string }> {
  if (expr.length === 0) return { error: "empty expression" };
  if (expr.length > MAX_EXPR_CHARS) return { error: `expression exceeds ${MAX_EXPR_CHARS} chars` };

  const id = nextId++;
  const w = getWorker();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // Hung — terminate worker and let the next call spawn a new one.
      try {
        w.terminate();
      } catch { /* ignore */ }
      if (worker === w) worker = undefined;
      resolve({ error: `render timeout after ${RENDER_TIMEOUT_MS}ms` });
    }, RENDER_TIMEOUT_MS);

    pending.set(id, { resolve, timer });
    w.postMessage({ id, expr });
  });
}

export async function renderMathBatch(exprs: Iterable<string>): Promise<Record<string, string>> {
  const results = await Promise.all(
    Array.from(exprs).map(async (e) => [e, await renderMath(e)] as const),
  );
  const out: Record<string, string> = {};
  for (const [e, r] of results) {
    if (r.mathml) out[e] = r.mathml;
  }
  return out;
}

export function shutdownPlurimathPool(): void {
  if (worker) {
    worker.terminate().catch(() => { /* ignore */ });
    worker = undefined;
  }
  for (const [, slot] of pending) {
    clearTimeout(slot.timer);
    slot.resolve({ error: "pool shut down" });
  }
  pending.clear();
}
