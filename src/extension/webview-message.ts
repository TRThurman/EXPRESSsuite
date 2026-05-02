/* Webview→host message validator (DESIGN §1.2.8.6).
 * No vscode imports — pure logic, unit-testable.
 */

export const MAX_MATH_EXPR_CHARS = 16_384;

export type WebviewMessage =
  | { kind: "navigate"; targetName: string }
  | { kind: "insert"; text: string }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string }
  | { kind: "renderMath"; id: number; expr: string };

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

export function validateMessage(msg: unknown): WebviewMessage | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  switch (m.kind) {
    case "navigate":
      if (typeof m.targetName !== "string" || !NAME_RE.test(m.targetName)) return null;
      return { kind: "navigate", targetName: m.targetName };
    case "insert":
      if (typeof m.text !== "string" || m.text.length > 4096) return null;
      return { kind: "insert", text: m.text };
    case "log": {
      const lvl = m.level === "info" || m.level === "warn" || m.level === "error" ? m.level : "info";
      if (typeof m.message !== "string" || m.message.length > 1024) return null;
      return { kind: "log", level: lvl, message: m.message };
    }
    case "renderMath":
      if (typeof m.id !== "number" || !Number.isFinite(m.id) || !Number.isInteger(m.id) || m.id < 0) return null;
      if (typeof m.expr !== "string" || m.expr.length === 0 || m.expr.length > MAX_MATH_EXPR_CHARS) return null;
      return { kind: "renderMath", id: m.id, expr: m.expr };
    default:
      return null;
  }
}
