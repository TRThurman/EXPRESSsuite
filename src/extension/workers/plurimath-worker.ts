/**
 * Plurimath render worker (DESIGN §3.2.4).
 *
 * Runs in a node:worker_threads worker so a pathological AsciiMath input
 * cannot block the extension event loop. Listens for {id, expr} messages
 * and posts back {id, mathml} on success or {id, error} on failure.
 *
 * @plurimath/plurimath is loaded lazily on first render to keep cold-start
 * worker spawn cheap (the Opal blob is ~3 MB to parse).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { parentPort } from "node:worker_threads";

interface RenderRequest {
  id: number;
  expr: string;
}

interface RenderResponseOk { id: number; mathml: string }
interface RenderResponseErr { id: number; error: string }

let Plurimath: any | undefined;

function loadPlurimath(): any {
  if (!Plurimath) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    Plurimath = require("@plurimath/plurimath").default;
  }
  return Plurimath;
}

if (!parentPort) {
  throw new Error("plurimath-worker must run as a worker_threads worker");
}

parentPort.on("message", (msg: RenderRequest) => {
  if (!msg || typeof msg.id !== "number" || typeof msg.expr !== "string") return;
  try {
    const PM = loadPlurimath();
    const mathml = new PM(msg.expr, "asciimath").toMathml();
    const reply: RenderResponseOk = { id: msg.id, mathml };
    parentPort!.postMessage(reply);
  } catch (err) {
    const reply: RenderResponseErr = { id: msg.id, error: (err as Error).message };
    parentPort!.postMessage(reply);
  }
});
