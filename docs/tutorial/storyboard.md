# Storyboard: Describe Declaration

Input for the screencast. One scene per section of
[describe-declarations.md](describe-declarations.md). Target length: about
eight minutes. No music. Narration is read at a calm pace; the screen is
recorded at 1920 x 1080 with the editor font at 16 pt and the light theme.

Setup for every take: `git restore docs/tutorial/demo/`, open the folder
`docs/tutorial/demo/` in a fresh VS Code window, open `demo_widgets.exp`,
close the side bar, keep the Problems panel open at the bottom. "Palette"
means Cmd+Shift+P (Ctrl+Shift+P on Windows and Linux); the command is
**EXPRESSsuite: Describe Declaration**, also in the right-click menu.

## Scene 1: The check (about 60 s)

Actions:
1. Show `demo_widgets.exp` from the top; scroll slowly to `END_SCHEMA;` and
   the blocks below it.
2. Click the Problems tab. Click each of the four entries in turn: the
   `plate` link, the `Check the wording` remark, the `rail` block, the
   `limit_gauge` block (inside the schema).

Narration: "EXPRESSsuite now checks the description blocks that follow
END_SCHEMA. This demo has four problems: a link to a declaration that does not
exist, a plain remark that would be published, a first sentence that links an
attribute, and a block inside the schema. Each one shows up in the Problems
panel."

Expected screen: the Problems panel lists four warnings with the codes
`annotation-link-undeclared`, `annotation-unkeyed-remark`,
`annotation-first-sentence-attribute-link` and `annotation-inside-schema`; the
editor shows the highlighted range of the last one clicked.

## Scene 2: Describe an entity from its comment (about 90 s)

Actions:
1. Scroll to the comment above `tagged_widget`. Select it from `(*` to `*)`.
2. Open the Palette, type `Describe Declaration`, press Enter.
3. In the list of declarations, show that `demo_widgets.tagged_widget` is
   first. Press Enter.
4. Pick **Description**.
5. In the clean-up list leave both items ticked (comment markers, hard-wrapped
   lines); press Enter.
6. In the links list (`widget`, `widgets`) tick nothing; press Enter.
7. In the refactor preview, pause, then click **Apply**.
8. Scroll to the `widget` block after END_SCHEMA and show the new block
   directly below it. Show that the comment above `tagged_widget` is gone.
9. Press Cmd+Z once and show the comment back and the block gone. Press
   Cmd+Shift+Z to redo.

Narration: "Select the comment that already explains the subtype and run
Describe Declaration. The tool offers to clean the text and proposes links,
but links nothing unless you tick it. VS Code shows the whole edit before it is
written. The block goes after the nearest block already there, the comment is
gone, and one undo restores both."

Expected screen: the file with the block `(*"demo_widgets.tagged_widget"`
directly after the `demo_widgets.widget` block, `A **tagged widget** is a
widget with a tag, so that it can be counted apart from the plain widgets in a
parts list.` on one line, and no comment above `tagged_widget`.

## Scene 3: An OPTIONAL attribute by typed text (about 60 s)

Actions:
1. Click on `size` in `widget`.
2. Open the Palette and run **Describe Declaration**.
3. Pick **Type the text**. Type `The largest extent of a widget.` Press
   Enter.
4. Confirm the first entry, `demo_widgets.widget.size`. Pick **Description**.
   No links step appears. Click **Apply** in the preview.
5. Scroll to the new block.

Narration: "With nothing selected, the text can be typed. The name of the
widget that owns the attribute is set in bold. This attribute is OPTIONAL, so
the tool adds one sentence at the end: the value of this attribute need not be
specified. It is the only wording the tool writes."

Expected screen: the block `(*"demo_widgets.widget.size"` directly after the
`demo_widgets.widget` block (above the `tagged_widget` block) with the text
`The largest extent of a **widget**. The value of this attribute need not be
specified.` on one line.

## Scene 4: A function, with one parameter left empty (about 75 s)

Actions:
1. Click inside the function `scaled_size`.
2. Run **Describe Declaration**; pick **Type the text**; type `Scales the size
   of a widget by a factor.` Press Enter.
3. Confirm `demo_widgets.scaled_size`; pick **Description**.
4. First input box (`w`): type `The widget to scale.` Press Enter.
5. Second input box (`factor`): press Enter with nothing typed.
6. Two links steps follow (each offers `widget`): tick nothing, press Enter
   each time; click **Apply**.
7. Show the two new blocks.

Narration: "A function asks for each parameter in turn. Parameter text goes into
a block of its own, in the same step. An empty box means no block, so the
second parameter gets none."

Expected screen: the blocks `demo_widgets.scaled_size` and
`demo_widgets.scaled_size.w`, one after the other directly after the
`demo_widgets.tagged_widget` block; no block for `factor`.

## Scene 5: A WHERE rule from the clipboard (about 60 s)

Actions:
1. Off camera, copy `The upper limit of a limit_gauge is greater than zero.`
   to the clipboard.
2. Click on the line `positive_limit : upper > 0.0;`.
3. Run **Describe Declaration**; pick **Use the clipboard**.
4. Confirm `demo_widgets.limit_gauge.wr:positive_limit`; pick **Description**.
   No links step appears. Click **Apply**.

Narration: "The rule is already written. Its English statement, copied from
wherever it lives, becomes the description. The entity that owns the rule is
set in bold. The tool never translates a rule and never describes a global
rule."

Expected screen: the block `(*"demo_widgets.limit_gauge.wr:positive_limit"`
directly after the `demo_widgets.scaled_size.w` block, holding `The upper
limit of a **limit_gauge** is greater than zero.`

## Scene 6: A note (about 40 s)

Actions:
1. Click in `widget`. Run **Describe Declaration**; **Type the text**; type
   `A widget can be fitted to more than one mount.`
2. Confirm `demo_widgets.widget`; pick **Note**. Point out that there are no
   parameter boxes.
3. In the links step (`mount`) tick nothing. Click **Apply**.

Narration: "A note has its own key, which ends in dot, underscore underscore
note, and takes no member texts. Examples work the same way."

Expected screen: a block `(*"demo_widgets.widget.__note"` directly after the
`demo_widgets.widget` block, with `A **widget** can be fitted to more than one
mount.`

## Scene 7: Append or replace (about 40 s)

Actions:
1. Run **Describe Declaration** on `widget` again with typed text `Widgets are
   counted in a parts list.`; pick `demo_widgets.widget` and **Description**.
2. In the links step (`Widgets`) tick nothing.
3. The list offers **Append** and **Replace**. Pick **Append**; click **Apply**.

Narration: "When a block already exists the tool asks whether to append or
replace. It never overwrites without asking."

Expected screen: the `demo_widgets.widget` block with its first text, a blank
line, and the new text.

## Scene 8: A comment used piece by piece (about 60 s)

Actions:
1. Scroll to the comment above `mount`.
2. Select the line `A mount holds a widget in place.` Run the command; the
   first entry is `demo_widgets.mount`. Pick **Description**. No clean-up list
   appears. In the links step (`widget`) tick nothing. Apply.
3. Select `A bracket carries a mount.`; run the command; pick
   `demo_widgets.bracket`; links step (`mount`), tick nothing. Apply.

Narration: "One comment can cover several declarations. Select a sentence at a
time. Each selection leaves the comment when its edit is applied, and what is
not selected stays."

Expected screen: the comment above `mount` with only its first sentence; the
block `demo_widgets.mount` (`A **mount** holds a widget in place.`) directly
after `END_SCHEMA;`, and `demo_widgets.bracket` (`A **bracket** carries a
mount.`) directly after it.

## Scene 9: What is checked before writing (about 60 s)

Actions:
1. Click in `rail`; run the command; **Type the text**; type
   `See <<express:demo_widgets.nothing,nothing>>.`
2. Pick `demo_widgets.rail.reach`, **Description**. The dialog "The new text has
   findings" appears; read the message aloud; press Escape.
3. Show the Problems panel again.

Narration: "Before the preview, the same check runs on the new text. Here it
reports a link to a declaration that does not exist, and nothing is written
until you decide. The tutorial lists every rule the check applies."

Expected screen: the modal dialog with the message `"demo_widgets.nothing" is
not declared in its schema.`; after cancelling, the file is unchanged.
