import { EmptyFileSystem } from "langium";
import { parseDocument } from "langium/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { createExpressP11Services } from "../language/express-module.js";
import { AnnotationIssues } from "../language/annotation/check.js";
import { DescribeService } from "../language/annotation/describe.js";

const DEMO_DIR = resolve(__dirname, "../../docs/tutorial/demo");

async function build() {
  const services = createExpressP11Services(EmptyFileSystem).ExpressP11;
  const support = readFileSync(resolve(DEMO_DIR, "demo_support.exp"), "utf8");
  const widgets = readFileSync(resolve(DEMO_DIR, "demo_widgets.exp"), "utf8");
  const supportDoc = await parseDocument(services, support);
  const widgetsDoc = await parseDocument(services, widgets);
  await services.shared.workspace.DocumentBuilder.build([supportDoc, widgetsDoc], { validation: true });
  return { services, supportDoc, widgetsDoc, widgets };
}

describe("tutorial demo workspace", () => {
  test("shows exactly the four annotation findings and nothing else", async () => {
    const { supportDoc, widgetsDoc } = await build();
    const diagnostics = [...(supportDoc.diagnostics ?? []), ...(widgetsDoc.diagnostics ?? [])].filter((d) => d.severity === 1 || d.severity === 2);
    const annotation = diagnostics.filter((d) => String(d.code).startsWith("annotation-")).map((d) => String(d.code)).sort();
    expect(annotation).toEqual(
      [AnnotationIssues.LinkUndeclared, AnnotationIssues.UnkeyedRemark, AnnotationIssues.FirstSentenceAttributeLink, AnnotationIssues.InsideSchema].sort()
    );
    expect(diagnostics.filter((d) => !String(d.code).startsWith("annotation-"))).toEqual([]);
  });

  test("the comment above tagged_widget defaults to that entity", async () => {
    const { services, widgetsDoc, widgets } = await build();
    const at = widgets.indexOf("A tagged widget is a widget");
    expect(at).toBeGreaterThan(0);
    const result = new DescribeService(services).targets(widgetsDoc.uri.toString(), at, at + 10);
    expect(result.defaultKey).toBe("demo_widgets.tagged_widget");
  });
});
