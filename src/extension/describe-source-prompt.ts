/* The first prompt of Describe Declaration when nothing is selected: where the text of the block comes from.
 * No vscode imports — pure logic, unit-testable.
 */

/** A source other than the selection. */
export type PromptedSourceKind = "typed" | "clipboard";

/** One entry of the quick pick: a label, and a sentence under it that says what the choice does. */
export interface SourceChoice {
  label: string;
  detail: string;
  kind: PromptedSourceKind;
}

/** The labels are named in the tutorial, the storyboard and smoke section S7; they stay as they are. */
export const SOURCE_CHOICES: readonly SourceChoice[] = [
  { label: "Type the text", detail: "Write the text of the description in the next box.", kind: "typed" },
  { label: "Use the clipboard", detail: "Use the text you last copied, for example a paragraph from a PDF.", kind: "clipboard" },
];

/** A selection is the third source, and with one this prompt is not shown; the placeholder says so. */
export const SOURCE_PLACEHOLDER = "Where does the description text come from? (Or select a comment first.)";

/** The kind of the picked choice, by its label; none for a cancelled pick. */
export function sourceKind(picked: { label: string } | undefined): PromptedSourceKind | undefined {
  return SOURCE_CHOICES.find((choice) => choice.label === picked?.label)?.kind;
}
