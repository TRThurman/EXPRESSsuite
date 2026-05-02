/**
 * Lightweight performance instrumentation for DESIGN §4.2.2.
 *
 * `time(label)` returns a stop function. The stop function records the
 * elapsed milliseconds, logs to OutputChannel "easyEXPRESS Viewers", and
 * — if a threshold is provided and exceeded — also surfaces a warning so
 * regressions show up immediately in the smoke-test runs.
 *
 * Designed to be cheap (single performance.now() at start and stop) and
 * always-on; no flag-gating because the overhead is < 10 µs per call.
 */

import * as vscode from "vscode";

let logChannel: vscode.OutputChannel | undefined;
function getLog(): vscode.OutputChannel {
  if (!logChannel) {
    logChannel = vscode.window.createOutputChannel("easyEXPRESS Viewers");
  }
  return logChannel;
}

export interface TimingMarker {
  /** Stop the timer; logs `label: <ms>ms` and returns the elapsed milliseconds. */
  (thresholdMs?: number): number;
}

export function time(label: string): TimingMarker {
  const t0 = performance.now();
  return (thresholdMs?: number): number => {
    const elapsed = performance.now() - t0;
    const ch = getLog();
    const ts = new Date().toISOString().slice(11, 23);
    const flag = thresholdMs !== undefined && elapsed > thresholdMs ? " ⚠ over budget" : "";
    ch.appendLine(`[${ts}] [perf] ${label}: ${elapsed.toFixed(1)}ms${flag}`);
    return elapsed;
  };
}

/** Convenience: time an async block. */
export async function timeAsync<T>(
  label: string,
  fn: () => Promise<T>,
  thresholdMs?: number,
): Promise<T> {
  const stop = time(label);
  try {
    return await fn();
  } finally {
    stop(thresholdMs);
  }
}
