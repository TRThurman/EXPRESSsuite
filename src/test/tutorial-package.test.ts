import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { describe, expect, test } from "vitest";
import { TUTORIAL_DEMO_FILE, TUTORIAL_DEMO_PATH, TUTORIAL_TEXT_PATH } from "../shared/tutorial.js";

/**
 * The tutorial is in the package: `.vscodeignore` leaves out `docs/` and takes the tutorial, its
 * demo and the walkthrough pages back in. What Open Tutorial and the walkthrough read exists, and
 * the tutorial links to no file that is left out.
 */
const root = process.cwd();
const ignore = readFileSync(join(root, ".vscodeignore"), "utf8").split(/\r?\n/).map((line) => line.trim());
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** Whether the package holds `path`, by the last rule of `.vscodeignore` that speaks of `docs/`. */
function shipped(path: string): boolean {
  let kept = true;
  for (const rule of ignore) {
    if (rule === "docs/**") kept = false;
    else if (rule.startsWith("!docs/")) {
      const pattern = rule.slice(1);
      if (pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern) kept = true;
    }
  }
  return kept;
}

describe("the tutorial in the package", () => {
  test("the tutorial text and the demo schemas exist and are shipped", () => {
    const text = TUTORIAL_TEXT_PATH.join("/");
    const demo = [...TUTORIAL_DEMO_PATH, TUTORIAL_DEMO_FILE].join("/");
    for (const path of [text, demo, [...TUTORIAL_DEMO_PATH, "demo_support.exp"].join("/")]) {
      expect(existsSync(join(root, path)), path).toBe(true);
      expect(shipped(path), path).toBe(true);
    }
    expect(shipped("docs/smoke-test-checklist.md")).toBe(false);
    expect(shipped("docs/tutorial/storyboard.md")).toBe(false);
  });

  test("the rules that take the tutorial back in follow the rule that leaves docs out", () => {
    const out = ignore.indexOf("docs/**");
    expect(out).toBeGreaterThanOrEqual(0);
    for (const rule of ignore.filter((line) => line.startsWith("!docs/"))) expect(ignore.indexOf(rule)).toBeGreaterThan(out);
  });

  test("each page of the walkthrough exists and is shipped, and its command is contributed", () => {
    const commands = manifest.contributes.commands.map((entry: { command: string }) => entry.command);
    for (const walkthrough of manifest.contributes.walkthroughs) {
      for (const step of walkthrough.steps) {
        const page = step.media.markdown as string;
        expect(existsSync(join(root, page)), page).toBe(true);
        expect(shipped(page), page).toBe(true);
        for (const [, command] of (step.description as string).matchAll(/\(command:(expresssuite\.[A-Za-z]+)\)/g)) expect(commands).toContain(command);
      }
    }
  });

  test("the tutorial links to no file that the package leaves out", () => {
    const text = readFileSync(join(root, ...TUTORIAL_TEXT_PATH), "utf8");
    const links = [...text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((match) => match[1]).filter((link) => !/^[a-z]+:/i.test(link));
    for (const link of links) {
      // Paths in .vscodeignore are written with "/", on every platform.
      const path = posix.join("docs/tutorial", link).replace(/\/$/, "");
      expect(existsSync(join(root, path)), link).toBe(true);
      expect(shipped(link.endsWith("/") ? `${path}/x` : path), link).toBe(true);
    }
  });
});
