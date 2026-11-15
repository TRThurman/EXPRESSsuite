# Tutorial: Describe Declaration

This tutorial shows the **Describe Declaration** command of EXPRESSsuite and
the description check that goes with it. It uses the two schemas in
[`demo/`](demo/). All names in them are made up.

EXPRESS keeps the published description of a declaration in a block after
`END_SCHEMA;`:

```
(*"demo_widgets.widget"
A **widget** is a part that is fitted to a <<express:demo_widgets.mount,mount>>.
*)
```

The first line holds the key (`schema.declaration`, or
`schema.declaration.member`). The key and the closing `*)` each stand alone on
a line. The command writes such blocks for you, checks the links in them, and
never puts one inside `SCHEMA ... END_SCHEMA;`.

Where a new block goes: directly after the block of the nearest earlier
declaration in the file that already has one; if no earlier declaration has a
block, directly after `END_SCHEMA;`.

When the text names the declaration being described (for a member, the
declaration that owns it), the name is written in bold, `**name**`. Other
words that name declarations are offered as links in a list with nothing
ticked; that list appears only when there is at least one such word.

The command writes no wording of its own, with one exception: the sentence
`The value of this attribute need not be specified.` at the end of the
description of an OPTIONAL attribute.

## Before you start

### A build with the command

Describe Declaration is not in EXPRESSsuite 0.5.1 or earlier. Until a release
has it, build it from a clone of the repository:

```
git clone https://github.com/TRThurman/EXPRESSsuite.git
cd EXPRESSsuite
npm ci
npm run langium:generate
npm run build
```

### The demo in a window of its own

From the same directory, open the demo folder in a VS Code window that runs
this build in a profile of its own:

```
code --user-data-dir out/demo-profile \
     --extensions-dir out/demo-extensions \
     --extensionDevelopmentPath="$PWD" \
     docs/tutorial/demo
```

Use `code-insiders` for VS Code Insiders; in PowerShell, put the command on
one line without the `\`. The profile of its own keeps an EXPRESSsuite
installed from the Marketplace, and any other extension for EXPRESS files,
out of this window: otherwise both would check the same file. `out/` is not
tracked by git. VS Code asks whether you trust the folder; it is the demo
from your clone.

Your other VS Code windows stay open beside the demo window and can look the
same, with the same file open. Check that you are in the demo window:

- The title bar begins `[Extension Development Host]` and names `demo`.
- With `demo_widgets.exp` open, the Problems panel lists the four warnings of
  section 1, each with a code starting `annotation-`. If it lists
  `The schema 'demo_support' could not be found`, the window has the file
  open but not the folder: use File > Open Folder and pick
  `docs/tutorial/demo/`.
- The right-click menu in `demo_widgets.exp` has **Describe Declaration**. If
  it does not, the window is running a build without the command.

Close the demo window when you are done; it does not close your other
windows.

### Running the command

1. Open `demo_widgets.exp`. `demo_support.exp` stays in the workspace so that
   links to it can be checked.
2. Run the command from the right-click menu (**Describe Declaration**) or
   from the command palette (**EXPRESSsuite: Describe Declaration**).

Every edit the command makes is shown in VS Code's refactor preview first.
The preview lists the change unticked, because the command asks VS Code for
your confirmation, and **Apply** stays disabled until you tick it (the file's
checkbox ticks every change in the file). Nothing is written until you tick
the change and press **Apply**. After applying, one undo (Ctrl+Z
or Cmd+Z) reverts the whole edit. Pressing Escape at any step writes nothing.

If you try a flow and want the demo back as it was, use `git restore` on
`docs/tutorial/demo/` or undo the edit.

## 1. The check in the Problems panel

Open the Problems panel (View > Problems) with `demo_widgets.exp` active. It
lists four warnings from the description check, each with a code starting
`annotation-`:

| Where | Code | What it says |
|---|---|---|
| the `plate` block after `END_SCHEMA;` | `annotation-link-undeclared` | `demo_widgets.coating_rule` is not declared in its schema |
| the remark that begins `Check the wording` | `annotation-unkeyed-remark` | a remark after `END_SCHEMA;` is published as documentation; keep working notes inside the schema as `--` lines |
| the `rail` block | `annotation-first-sentence-attribute-link` | the first sentence links an attribute; it should describe the declaration alone |
| the `limit_gauge` block, which sits between two declarations | `annotation-inside-schema` | a description block belongs after `END_SCHEMA;` |

The `widget` block is clean and draws nothing.

The check offers quick fixes for two codes only, `annotation-continuation-without-list`
and `annotation-glued-continuation` (section 10). A lightbulb on any other row
comes from VS Code's own chat, if it is enabled, not from EXPRESSsuite.

The check has seventeen codes. The five added last are the publication checks
of section 10. All are warnings except `annotation-link-unverified`,
`annotation-open-block-delimiter` and `annotation-list-chain-macro`, which
are information:

| Code | Meaning |
|---|---|
| `annotation-link-undeclared` | the target of an `<<express:...>>` link is not declared in the schema it names |
| `annotation-link-unverified` (information) | the schema named is not in the workspace, or the link has a shape the check cannot verify; it is not an error |
| `annotation-link-space` | a link target contains a space |
| `annotation-self-link` | the block links to its own subject |
| `annotation-orphan-key` | no declaration has the key |
| `annotation-duplicate-key` | an earlier block in the same schema has the same key; notes, examples and other `.__` blocks may repeat |
| `annotation-unkeyed-remark` | a plain remark after `END_SCHEMA;` |
| `annotation-non-ascii` | a character outside ASCII in the text |
| `annotation-first-sentence-attribute-link` | the first sentence of a declaration's description links an attribute of an entity, its own or any other |
| `annotation-optional-sentence` | the description of an OPTIONAL attribute does not end with the sentence above |
| `annotation-bare-subtype` | the description of an entity only says "A **x** is a type of <<express:...>>." |
| `annotation-inside-schema` | a keyed block between `SCHEMA` and `END_SCHEMA;` |
| `annotation-continuation-without-list` | a `+` line whose continuation chain does not start at a list item |
| `annotation-glued-continuation` | a `+` written straight after the `]` of a block macro |
| `annotation-block-macro-inline` | a block macro that does not start its line, or sits in a table cell that is not an `a\|` cell |
| `annotation-open-block-delimiter` (information) | a line that is exactly `--` |
| `annotation-list-chain-macro` (information) | a list item whose `+` chain attaches a macro, which metanorma-plugin-lutaml 0.7.68 and later detaches |

Keys and link targets compare without regard to case. Long-form schemas get no
check. Global rules and their WHERE rules are not described by the command.

To see a fix, change the `plate` link target to `demo_support.finish` or remove
the link: the warning goes away. This is the same check the command runs on
the text it is about to write.

## 2. Describe an entity from its comment

The comment above `tagged_widget` says why the subtype exists. Make it the
description.

1. Select the whole comment, from `(*` to `*)`.
2. Run **Describe Declaration**.
3. Pick the declaration. The list starts with `demo_widgets.tagged_widget`,
   the declaration under the selection.
4. Pick **Description**.
5. The clean-up list offers to remove the comment markers and to join hard-wrapped
   lines. Leave both ticked.
6. The link list offers words that name declarations (`widget`, `widgets`).
   Nothing is ticked. Tick none, or tick the words you want linked, and accept.
7. VS Code opens the refactor preview with the change unticked. Tick it,
   then press **Apply**.

Expected:

- A block `(*"demo_widgets.tagged_widget"` appears directly after the
  `demo_widgets.widget` block, the nearest earlier declaration with a block.
  The text is on one line and the subject is in bold:
  `A **tagged widget** is a widget with a tag, ...`.
- The comment above `tagged_widget` is gone.
- One undo brings back the comment and removes the block.

A selection used as the source is removed from the comment when the edit is
applied. If the selection runs from a comment into EXPRESS code, the command
refuses it at once, before the target list, and changes nothing.

## 3. Describe an OPTIONAL attribute by typed text

1. Put the cursor on `size` in the entity `widget`; select nothing.
2. Run **Describe Declaration** and pick **Type the text**.
3. Type `The largest extent of a widget.` and press Enter.
4. The target list starts with `demo_widgets.widget.size`. Pick it, then
   **Description**. No links step appears: the only declared name in the text
   is `widget`, the owner of the attribute, which is written in bold.
5. Tick the change in the preview and press **Apply**.

Expected: the block `(*"demo_widgets.widget.size"` is inserted directly after
the `demo_widgets.widget` block and holds

```
The largest extent of a **widget**. The value of this attribute need not be specified.
```

The second sentence is the one thing the tool adds. It goes after one space at
the end. It is added only for an OPTIONAL explicit attribute. Describe
`count`, which is mandatory, and nothing is added.

An empty text is refused: pressing Enter with nothing typed shows
"there is no text to use" and writes nothing.

## 4. Describe a function with a parameter text left empty

1. Put the cursor in the function `scaled_size`.
2. Run **Describe Declaration**, pick **Type the text**, and type
   `Scales the size of a widget by a factor.`
3. Pick `demo_widgets.scaled_size` and **Description**.
4. One input box asks for each parameter. For `demo_widgets.scaled_size.w`
   type `The widget to scale.` For `demo_widgets.scaled_size.factor` leave the
   box empty and press Enter. An empty box means no block.
5. Each text names `widget`, which is offered as a link; tick nothing and
   accept both links steps. Tick the change and press **Apply**.

Expected: two blocks, `(*"demo_widgets.scaled_size"` and
`(*"demo_widgets.scaled_size.w"`, one after the other, placed after the
block of the nearest earlier declaration that has one. There is none for
`factor`.

Parameter texts (and the texts of enumeration items, for a TYPE) are blocks of
their own, written in the same step as the function. The block of the function
itself holds no argument list.

## 5. Describe a WHERE rule from the clipboard

The command describes a rule that already exists; it does not write rules.
Here `limit_gauge` has the rule `positive_limit`. Its English statement is the
description.

1. Copy this sentence to the clipboard:
   `The upper limit of a limit_gauge is greater than zero.`
2. Put the cursor in the line `positive_limit : upper > 0.0;`.
3. Run **Describe Declaration** and pick **Use the clipboard**.
4. Pick `demo_widgets.limit_gauge.wr:positive_limit` and **Description**.
5. No links step appears: `limit_gauge`, the only declared name in the
   sentence, is the owner of the rule and is written in bold.
6. Tick the change and press **Apply**.

Expected: the block `(*"demo_widgets.limit_gauge.wr:positive_limit"` holds

```
The upper limit of a **limit_gauge** is greater than zero.
```

## 6. Notes and examples

1. Put the cursor in `widget`, run the command, and type
   `A widget can be fitted to more than one mount.`
2. Pick `demo_widgets.widget` and **Note**.
3. The links step offers `mount`; tick nothing. Tick the change in the
   preview and press **Apply**.

Expected: a block `(*"demo_widgets.widget.__note"` directly after the
`demo_widgets.widget` block, with `A **widget** can be fitted to more than one
mount.` The key ends in `.__note`;
**Example** gives `.__example`. A Note or an Example takes no parameter or item
texts, so the function steps of flow 4 do not appear.

Run it again with another note for `widget`. The note now exists, so the
command asks **Append**, **Replace** or **Add another**. **Add another** writes
a second `(*"demo_widgets.widget.__note"` block directly after the first; a
declaration may have several notes and examples, but one description.

## 7. Append or replace

`widget` already has a description. Run the command on it again (typed text,
`demo_widgets.widget`, **Description**; the links step offers any other
declared names in your text).

The command asks **Append** or **Replace**:

- **Append** adds the new text to the existing block after a blank line. If
  the block is the description of an OPTIONAL attribute, the sentence
  `The value of this attribute need not be specified.` stays the last
  sentence.
- **Replace** swaps the old text for the new one.

If you cancel here, nothing is written.

Parameter and item blocks are not appended to or replaced with their owner's.
Run the command again on `scaled_size` with a description: the input box for
`factor` appears, but `w`, which already has a block, gets none, and a message
names it. To change the text of `w`, describe `demo_widgets.scaled_size.w`
itself.

## 8. Use a comment piece by piece

The comment above `mount` covers two declarations:

```
(* The next two entities cover the fixed parts of an assembly.
   A mount holds a widget in place.
   A bracket carries a mount. *)
```

1. Select the sentence `A mount holds a widget in place.` (only the sentence,
   not the spaces before it or the line break after it).
2. Run **Describe Declaration**, pick `demo_widgets.mount`, **Description**.
   There is nothing to clean up in a plain sentence, so no clean-up list
   appears. The links step offers `widget`; tick nothing.
3. Tick the change and apply. The sentence leaves the comment; its line stays, blank, and the rest
   of the comment stays.
4. Select `A bracket carries a mount.`, run the command, and pick
   `demo_widgets.bracket`. The links step offers `mount`; tick nothing.
5. Tick the change and apply.

Expected: two new blocks, `demo_widgets.mount` and `demo_widgets.bracket`,
with `A **mount** holds a widget in place.` and `A **bracket** carries a
mount.`. The first is directly after `END_SCHEMA;` unless an earlier
declaration has a block (none does here); the second follows it. The comment
keeps its first sentence, then a blank line where the mount sentence was, and
its closing `*)` on a line of its own:

```
(* The next two entities cover the fixed parts of an assembly.

    *)
```

Delete the comment by hand if you do not need it.

## 9. What the command checks before it writes

Before the preview opens, the command runs the same check as the Problems
panel on the text it will write. If it finds something, a dialog lists the
messages and offers **Apply** or cancel. The block is not written without your
answer. Try typing `See <<express:demo_widgets.nothing,nothing>>.` as a
description: the dialog reports that the target is not declared.

Rules for the text of a description:

| Rule | The check reports |
|---|---|
| Links name declared items, as `<<express:schema.name,text>>` or `<<express:schema.owner.member,text>>`, or a schema, as `<<express:schema,text>>` | `annotation-link-undeclared` |
| No space in the link target | `annotation-link-space` |
| A block does not link to its own subject | `annotation-self-link` |
| ASCII only | `annotation-non-ascii` |
| The first sentence of a declaration's description links no attribute of any entity | `annotation-first-sentence-attribute-link` |
| An OPTIONAL attribute's description ends with the standard sentence | `annotation-optional-sentence` |
| An entity's description says more than that it is a subtype | `annotation-bare-subtype` |
| One block per key, except notes, examples and other `.__` blocks; every key has a declaration | `annotation-duplicate-key`, `annotation-orphan-key` |
| Working notes stay inside the schema as `--` lines | `annotation-unkeyed-remark` |
| No description block inside `SCHEMA ... END_SCHEMA;` | `annotation-inside-schema` |
| A key names the schema its block follows | `annotation-orphan-key` |
| `+` lines, block macros and `--` lines as section 10 describes | the five publication codes |

The clean-up step is where non-ASCII characters (typographic quotes, dashes,
ligatures from a PDF) can be replaced, so that pasted text passes the check.

## 10. The publication checks

A description block is AsciiDoc. The ISO 10303 publication pipeline (suma,
metanorma-plugin-lutaml, expressir, Asciidoctor) wraps it in AsciiDoc of its
own and rewrites some of its lines without parsing it, so a construct can mean
something else in the published document than it meant to the author. Five
codes show those constructs while the block is written. They read the block
through a classifier that knows list markers, continuation chains, delimited
blocks (`----`, `....`, `====`, `****`, `____`, `--`, `++++`, `////`,
`|===`) and table cell styles; none decides from one line alone. Inside
listing, literal, passthrough and comment blocks only `annotation-open-block-delimiter`
applies. The examples below are synthetic.

**Class A, source errors** (warning). The construct is wrong AsciiDoc whatever
the pipeline does. Where the correction is unambiguous the check offers a quick
fix.

`annotation-continuation-without-list`. Source: AsciiDoc itself (TCSC410303-3232).
A `+` line attaches the block that follows it to a list item. When the chain of
`+` lines does not start at a list item, Asciidoctor prints the `+` and the
macro as one paragraph of text. The check follows the chain back, through the
`+` lines and the blocks they attach (paragraphs, block macros, delimited
blocks), to the line that starts it. Every AsciiDoc list form counts as a list
item: `*` to `*****`, `-`, `.` to `.....`, `1.`, `a.`, `A.`, `i)`, `I)`, `1)`,
checklist items and `term::`, `term:::`, `term::::`, `term;;`. A delimited block
written directly under a list item's text, with no blank line, is part of the
item. Quick fix: replace the `+` with a blank line.

```
A paragraph, not a list item.
+
image::figure_1.gif[]
```

reports the `+` (and each further `+` of the chain); `. A step` in place of the
paragraph reports nothing.

`annotation-glued-continuation`. Source: AsciiDoc itself. A `+` written
directly after the closing `]` of a block macro, `image::figure_1.gif[]+`, is
printed as text. Quick fix: remove the `+`; when the macro belongs to a list
item's chain, put the `+` on a line of its own instead.

`annotation-block-macro-inline`. Source: AsciiDoc itself (TCSC410303-3233). A
block macro (`image::`, `video::`, `audio::`, `toc::`) is recognised only at
the start of a line, and in a table only at the start of the content of a cell
that holds AsciiDoc. It is reported when it follows other text on its line
(`See image::figure_1.gif[] here.`, `. image::figure_1.gif[]`), or sits in a cell
that is not an `a|` cell. A cell holds AsciiDoc when its specifier has the
style `a` (`a|`, `2+a|`) or the table's `[cols=...]` gives its column the
style `a` (`[cols="1,2a"]`, `[cols="2*a,1"]`). Limits: a `cols` value the
check cannot read leaves the columns plain, so only cells written `a|` count;
the rowspans of a table are not tracked when the cells of a row are counted
against the columns; a macro inside backticks is text and is not reported.
There is no quick fix.

**Class B, publication hazards** (information). The construct is valid
AsciiDoc that the current toolchain mishandles. Each message names the
upstream issue and the versions, and the check is retired when the defect is
fixed and the WG 12 output gate that covers it passes with the construct
present. EXPRESSsuite never rewrites these constructs. The setting
`expresssuite.annotations.publicationHazards` (default on) switches both off;
the new value is read at the next validation of a document.

`annotation-open-block-delimiter`. Source: metanorma/iso-10303 issue 857 (suma
0.5.42 schema template). suma wraps each schema listing in `[source]` ...
`--`, so a line that is exactly `--` anywhere in a remark, also inside a
nested block, closes that listing and the rest of the schema page is rendered as
AsciiDoc.

```
[NOTE]
--
A note written as an open block.
--
```

reports both `--` lines.

`annotation-list-chain-macro`. Source: metanorma/iso-10303 issue 862
(metanorma-plugin-lutaml 0.7.68 and later). The plugin blanks a `+` line before
a macro line (`link`, `image`, `video`, `audio`, `include`) unless the line
before the `+` matches its regular expression for a list item: `*` or `-` and a
space, a number or letter and `.` or `)` and a space, or a term, `::` and a
space. Inside the chain of a `. ` item, a `**` item or a `term:::` item, and
after an attached macro or paragraph, it does not match, the `+` is lost and the
macro is detached from the item. The check reports the list item once and
names the `+` lines.

```
. A step
+
image::figure_1.gif[]
+
image::figure_2.gif[]
```

reports the item and its two `+` lines; with `* A step` the first `+` survives
but the second, which follows a macro line, does not.

**Key of another schema.** `annotation-orphan-key` also reports a block whose
key names another schema than the one whose `END_SCHEMA;` it follows, role
suffix included (`other_schema.__note` after `demo_schema`): the text is
printed in no listing.
