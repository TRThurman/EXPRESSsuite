/* Where the tutorial is in the installed package. `.vscodeignore` keeps these paths in the
 * package; `src/test/tutorial-package.test.ts` checks that it does.
 */
export const TUTORIAL_TEXT_PATH = ["docs", "tutorial", "describe-declarations.md"] as const;
export const TUTORIAL_DEMO_PATH = ["docs", "tutorial", "demo"] as const;
/** The schema the tutorial starts in. */
export const TUTORIAL_DEMO_FILE = "demo_widgets.exp";
/** The folder of the user's copy of the demo, in the extension's storage folder. */
export const TUTORIAL_DEMO_FOLDER = "tutorial-demo";
