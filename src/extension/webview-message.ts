/* Webview→host message validator (DESIGN §1.2.8.6).
 * No vscode imports — pure logic, unit-testable.
 */

export type WebviewMessage =
  | { kind: "navigate"; targetName: string }
  | { kind: "insert"; text: string }
  | { kind: "log"; level: "info" | "warn" | "error"; message: string };

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
    default:
      return null;
  }
}
