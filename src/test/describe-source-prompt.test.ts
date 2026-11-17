import { describe, expect, test } from "vitest";
import { SOURCE_CHOICES, SOURCE_PLACEHOLDER, sourceKind } from "../extension/describe-source-prompt.js";

/**
 * With nothing selected, Describe Declaration first asks where the text of the block comes from. The prompt has
 * to say so by itself: a first-time user sees it before anything else of the command.
 */
describe("the source prompt of Describe Declaration", () => {
  test("the two choices keep the labels the tutorial, the storyboard and smoke S7 name", () => {
    expect(SOURCE_CHOICES.map((choice) => choice.label)).toEqual(["Type the text", "Use the clipboard"]);
  });

  test("each choice says in a sentence of its own what it does", () => {
    for (const choice of SOURCE_CHOICES) {
      expect(choice.detail, choice.label).toMatch(/^[A-Z].{20,}\.$/);
    }
    expect(SOURCE_CHOICES[0].detail).toContain("next box");
    expect(SOURCE_CHOICES[1].detail).toContain("copied");
  });

  test("the placeholder asks the question and names the third way in, a selected comment", () => {
    expect(SOURCE_PLACEHOLDER.startsWith("Where does the description text come from?")).toBe(true);
    expect(SOURCE_PLACEHOLDER).toContain("select a comment");
    // The quick pick is about 600 px wide; a longer placeholder is cut off.
    expect(SOURCE_PLACEHOLDER.length).toBeLessThanOrEqual(80);
  });

  test("a picked choice gives its kind; a cancelled pick gives none", () => {
    expect(sourceKind(SOURCE_CHOICES[0])).toBe("typed");
    expect(sourceKind(SOURCE_CHOICES[1])).toBe("clipboard");
    expect(sourceKind({ label: "Use the clipboard" })).toBe("clipboard");
    expect(sourceKind(undefined)).toBeUndefined();
    expect(sourceKind({ label: "something else" })).toBeUndefined();
  });
});
