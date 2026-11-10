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

The command writes no wording of its own, with one exception: the sentence
`The value of this attribute need not be specified.` at the end of the
description of an OPTIONAL attribute.

## Before you start

1. Open the folder `docs/tutorial/demo/` in VS Code (File > Open Folder).
2. Open `demo_widgets.exp`. `demo_support.exp` stays in the workspace so that
   links to it can be checked.
3. Run the command from the right-click menu (**Describe Declaration**) or
   from the command palette (**EXPRESSsuite: Describe Declaration**).

Every edit the command makes is shown in VS Code's refactor preview first.
Nothing is written until you press **Apply**. After applying, one undo (Ctrl+Z
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

The check has twelve codes. All are warnings except
`annotation-link-unverified`, which is information:

| Code | Meaning |
|---|---|
| `annotation-link-undeclared` | the target of an `<<express:...>>` link is not declared in the schema it names |
| `annotation-link-unverified` (information) | the schema named is not in the workspace, or the link has a shape the check cannot verify; it is not an error |
| `annotation-link-space` | a link target contains a space |
| `annotation-self-link` | the block links to its own subject |
| `annotation-orphan-key` | no declaration has the key |
| `annotation-duplicate-key` | an earlier block in the same schema has the same key |
| `annotation-unkeyed-remark` | a plain remark after `END_SCHEMA;` |
| `annotation-non-ascii` | a character outside ASCII in the text |
| `annotation-first-sentence-attribute-link` | the first sentence of a declaration's block links one of its attributes |
| `annotation-optional-sentence` | the description of an OPTIONAL attribute does not end with the sentence above |
| `annotation-bare-subtype` | the description of an entity only says "A **x** is a type of <<express:...>>." |
| `annotation-inside-schema` | a keyed block between `SCHEMA` and `END_SCHEMA;` |

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
7. VS Code opens the refactor preview. Press **Apply**.

Expected:

- After `END_SCHEMA;` a block `(*"demo_widgets.tagged_widget"` appears with the
  comment text on one line. The name of the subject is in bold:
  `A **tagged widget** is a widget with a tag, ...`.
- The comment above `tagged_widget` is gone.
- One undo brings back the comment and removes the block.

A selection used as the source is removed from the comment when the edit is
applied. If the selection runs from a comment into EXPRESS code, the command
refuses it and changes nothing.

## 3. Describe an OPTIONAL attribute by typed text

1. Put the cursor on `size` in the entity `widget`; select nothing.
2. Run **Describe Declaration** and pick **Type the text**.
3. Type `The largest extent of a widget.` and press Enter.
4. The target list starts with `demo_widgets.widget.size`. Pick it, then
   **Description**, then accept the links step with none ticked.
5. Press **Apply** in the preview.

Expected: the block `(*"demo_widgets.widget.size"` holds

```
The largest extent of a widget. The value of this attribute need not be specified.
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
5. Accept the links steps and press **Apply**.

Expected: two blocks, `(*"demo_widgets.scaled_size"` and
`(*"demo_widgets.scaled_size.w"`. There is none for `factor`.

Parameter texts (and the texts of enumeration items, for a TYPE) are blocks of
their own, written in the same step as the function, so the tool never asks for
them later. The block of the function itself holds no argument list.

## 5. Describe a WHERE rule from the clipboard

The command describes a rule that already exists; it does not write rules.
Here `limit_gauge` has the rule `positive_limit`. Its English statement is the
description.

1. Copy this sentence to the clipboard:
   `The upper limit of a limit_gauge is greater than zero.`
2. Put the cursor in the line `positive_limit : upper > 0.0;`.
3. Run **Describe Declaration** and pick **Use the clipboard**.
4. Pick `demo_widgets.limit_gauge.wr:positive_limit` and **Description**.
5. The link list offers the entity name, none ticked. Tick `limit_gauge` if you
   want it linked, and accept.
6. Press **Apply**.

Expected: the block `(*"demo_widgets.limit_gauge.wr:positive_limit"` holds the
sentence you copied.

The clipboard is read once. Nothing leaves your machine.

## 6. Notes and examples

1. Put the cursor in `widget`, run the command, and type
   `A widget can be fitted to more than one mount.`
2. Pick `demo_widgets.widget` and **Note**.
3. Press **Apply**.

Expected: a block `(*"demo_widgets.widget.__note"`. The key ends in `.__note`;
**Example** gives `.__example`. A Note or an Example takes no parameter or item
texts, so the function steps of flow 4 do not appear.

## 7. Append or replace

`widget` already has a description. Run the command on it again (typed text,
`demo_widgets.widget`, **Description**).

The command asks **Append** or **Replace**:

- **Append** adds the new text to the existing block after a blank line. If
  the block is the description of an OPTIONAL attribute, the sentence
  `The value of this attribute need not be specified.` stays the last
  sentence.
- **Replace** swaps the old text for the new one.

If you cancel here, nothing is written.

## 8. Use a comment piece by piece

The comment above `mount` covers two declarations:

```
(* The next two entities cover the fixed parts of an assembly.
   A mount holds a widget in place.
   A bracket carries a mount. *)
```

1. Select the line `A mount holds a widget in place.` (only that line).
2. Run **Describe Declaration**, pick `demo_widgets.mount`, **Description**,
   and accept the clean-ups and links.
3. Apply. The line leaves the comment; the rest of the comment stays.
4. Select `A bracket carries a mount.`, run the command, and pick
   `demo_widgets.bracket`.
5. Apply.

Expected: two new blocks, and a comment with its first sentence only. Delete
the comment by hand if you do not need it.

## 9. What the command checks before it writes

Before the preview opens, the command runs the same check as the Problems
panel on the text it will write. If it finds something, a dialog lists the
messages and offers **Apply** or cancel. The block is not written without your
answer. Try typing `See <<express:demo_widgets.nothing,nothing>>.` as a
description: the dialog reports that the target is not declared.

Rules for the text of a description:

| Rule | The check reports |
|---|---|
| Links name declared items, as `<<express:schema.name,text>>` or `<<express:schema.owner.member,text>>` | `annotation-link-undeclared` |
| No space in the link target | `annotation-link-space` |
| A block does not link to its own subject | `annotation-self-link` |
| ASCII only | `annotation-non-ascii` |
| The first sentence of an entity's description does not link its attributes | `annotation-first-sentence-attribute-link` |
| An OPTIONAL attribute's description ends with the standard sentence | `annotation-optional-sentence` |
| An entity's description says more than that it is a subtype | `annotation-bare-subtype` |
| One block per key; every key has a declaration | `annotation-duplicate-key`, `annotation-orphan-key` |
| Working notes stay inside the schema as `--` lines | `annotation-unkeyed-remark` |
| No description block inside `SCHEMA ... END_SCHEMA;` | `annotation-inside-schema` |

The clean-up step is where non-ASCII characters (typographic quotes, dashes,
ligatures from a PDF) can be replaced, so that pasted text passes the check.
