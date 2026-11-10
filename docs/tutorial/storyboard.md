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
END_SCHEMA. Four things are wrong in this demo. A link points to a
declaration that does not exist. A plain remark would be published as
documentation. The first sentence of a rail's description links one of its
attributes. And one block sits inside the schema, where it does not belong."

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
5. In the clean-up list leave both items ticked; press Enter.
6. In the links list tick nothing; press Enter.
7. In the refactor preview, pause, then click **Apply**.
8. Scroll to the end of the file and show the new block.
9. Press Cmd+Z once and show the comment back and the block gone. Press
   Cmd+Shift+Z to redo.

Narration: "Select the comment that already explains the subtype and run
Describe Declaration. The first entry is the declaration under the selection.
The tool offers to clean the text and proposes links, but links nothing unless
you tick it. VS Code shows the whole edit before it is written. The block is
after END_SCHEMA, the comment is gone, and one undo restores both."

Expected screen: the file with the block `(*"demo_widgets.tagged_widget"`
after the blocks that were already there, `A **tagged widget** is a widget with
a tag, so that it can be counted apart from the plain widgets in a parts
list.` on one line, and no comment above `tagged_widget`.

## Scene 3: An OPTIONAL attribute by typed text (about 60 s)

Actions:
1. Click on `size` in `widget`.
2. Open the Palette and run **Describe Declaration**.
3. Pick **Type the text**. Type `The largest extent of a widget.` Press
   Enter.
4. Confirm the first entry, `demo_widgets.widget.size`. Pick **Description**.
   Tick no links. Press Enter, then **Apply**.
5. Scroll to the new block.

Narration: "With nothing selected, the text can be typed. This attribute is
OPTIONAL, so the tool adds one sentence at the end: the value of this
attribute need not be specified. It is the only wording the tool writes."

Expected screen: the block `(*"demo_widgets.widget.size"` with the text `The
largest extent of a widget. The value of this attribute need not be
specified.` on one line.

## Scene 4: A function, with one parameter left empty (about 75 s)

Actions:
1. Click inside the function `scaled_size`.
2. Run **Describe Declaration**; pick **Type the text**; type `Scales the size
   of a widget by a factor.` Press Enter.
3. Confirm `demo_widgets.scaled_size`; pick **Description**.
4. First input box (`w`): type `The widget to scale.` Press Enter.
5. Second input box (`factor`): press Enter with nothing typed.
6. Accept the links steps; click **Apply**.
7. Show the two new blocks.

Narration: "A function asks for each parameter in turn. Parameter text goes into
a block of its own, in the same step. An empty box means no block, so the
second parameter gets none."

Expected screen: the blocks `demo_widgets.scaled_size` and
`demo_widgets.scaled_size.w`; no block for `factor`.

## Scene 5: A WHERE rule from the clipboard (about 60 s)

Actions:
1. In a text editor off screen, copy `The upper limit of a limit_gauge is
   greater than zero.` (or type it in a scratch tab and copy; say so in the
   narration if shown).
2. Click on the line `positive_limit : upper > 0.0;`.
3. Run **Describe Declaration**; pick **Use the clipboard**.
4. Confirm `demo_widgets.limit_gauge.wr:positive_limit`; pick **Description**.
5. In the links list show that `limit_gauge` is offered and not ticked. Press
   Enter; click **Apply**.

Narration: "The rule is already written. Its English statement, copied from
wherever it lives, becomes the description. The tool never translates a rule
and never describes a global rule."

Expected screen: the block `(*"demo_widgets.limit_gauge.wr:positive_limit"`
holding the copied sentence.

## Scene 6: Note, then append or replace (about 75 s)

Actions:
1. Click in `widget`. Run **Describe Declaration**; **Type the text**; type
   `A widget can be fitted to more than one mount.`
2. Confirm `demo_widgets.widget`; pick **Note**. Point out that there are no
   parameter boxes. Apply.
3. Run the command again on `widget` with typed text `Widgets are counted
   in a parts list.`, pick **Description**.
4. The list offers **Append** and **Replace**. Pick **Append**; Apply.

Narration: "A note has its own key and takes no member texts. When a block
already exists the tool asks whether to append or replace; it never
overwrites without asking."

Expected screen: a block `demo_widgets.widget.__note`, and the
`demo_widgets.widget` block now with its first text, a blank line, and the new
text.

## Scene 7: A comment used piece by piece (about 60 s)

Actions:
1. Scroll to the comment above `mount`.
2. Select the line `A mount holds a widget in place.` Run the command; the
   first entry is `demo_widgets.mount`. Description, accept, Apply.
3. Select `A bracket carries a mount.`; run the command; pick
   `demo_widgets.bracket`; Apply.

Narration: "One comment can cover several declarations. Select a sentence at a
time. Each selection leaves the comment when its edit is applied, and what is
not selected stays."

Expected screen: the comment above `mount` with only its first sentence;
blocks for `demo_widgets.mount` and `demo_widgets.bracket` below END_SCHEMA.

## Scene 8: What is checked before writing (about 60 s)

Actions:
1. Click in `rail`; run the command; **Type the text**; type
   `See <<express:demo_widgets.nothing,nothing>>.`
2. Pick `demo_widgets.rail.reach`, **Description**. The dialog "The new text has
   findings" appears; read the message aloud; click Cancel (Escape).
3. Show the Problems panel again.

Narration: "Before the preview, the same check runs on the new text. Here it
reports a link to a declaration that does not exist, and nothing is written
until you decide. The tutorial lists every rule the check applies."

Expected screen: the modal dialog with the message that
`demo_widgets.nothing` is not declared in its schema; after cancelling, the
file is unchanged.
