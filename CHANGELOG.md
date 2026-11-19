# Changelog

## Unreleased

### Features

- **Go to Definition from a description block.** In a keyed description block
  after `END_SCHEMA;`, Go to Definition (F12, Cmd+click or Ctrl+click, Peek
  Definition) goes to the EXPRESS that the text under the cursor names:
  - a part of the block's key: the schema, the declaration (entity, type,
    function, procedure, rule, subtype constraint, constant), the attribute
    (explicit, derived, inverse or redeclared, also written
    `SELF\supertype.attribute`), the enumeration item, the parameter, the
    WHERE rule (`wr:label`) or UNIQUE rule (`ur:label`). A key with `.__note`,
    `.__example`, `.__figure` or `.__table` goes where the key without the
    suffix goes; a schema-level block such as `.__expressg` goes to the schema;
  - an informal proposition (`wr:IPn`): its `--IPn:` line in the entity or
    type;
  - an `<<express:...>>` cross-reference, its display text included, in this
    file or any other file of the workspace;
  - a plain name, the bold subject included: an attribute, parameter or item
    of the block's subject, then a declaration of the schema, then one the
    schema reaches through `USE FROM` or `REFERENCE FROM`, then one declared
    in another schema. A name that several schemas declare lists each.

  A name cited under a schema that does not declare it is followed through
  that schema's interfaces. A key or cross-reference whose last part names
  nothing goes to its owner, or to the schema. Go to Definition in the EXPRESS
  of a schema is unchanged.
- **The status bar says when the open file is not checked.** While the active
  editor holds an EXPRESS file that `expresssuite.excludedFolders` or
  `expresssuite.excludedFiles` leaves out of the workspace, the status bar
  shows **EXPRESS: not checked**. The tooltip names the folder or the keyword
  and the setting that lists it; a click opens these settings. Before, such a
  file showed no problems and nothing said that it had not been read
  ([#120](https://github.com/TRThurman/EXPRESSsuite/issues/120)).
- **Type-ahead in a description block.** In a keyed description block after
  `END_SCHEMA;` the completion list offers what is valid where the cursor
  stands; before, it offered nothing there. It opens after `"`, `.`, `:` and
  `**`.
  - In a key: the schema; after `schema.` its declarations, the ones that
    have no block yet first, then the roles (`.__note`, `.__example`,
    `.__figure`, `.__table`, and for a schema `.__expressg` and
    `.__fund_cons`); after `schema.owner.` the owner's attributes, enumeration
    items or parameters, its rules as `wr:label` and `ur:label`, its informal
    propositions as `wr:IPn`, and the roles.
  - In an `<<express:...>>` cross-reference: the schemas (this one, those it
    interfaces, then the others); after `schema.` what the schema declares,
    then what it reaches through `USE FROM` and `REFERENCE FROM`, written
    under the schema that declares it; after `schema.owner.` the owner's
    attributes, items or parameters. An accepted entry is completed with its
    display text, the name in words, selected for typing over; in a
    `.__expressg` block it ends `>>; ` for the area number.
  - After `**`: the name of the block's subject.
  - Elsewhere in the text, on Ctrl+Space only: the members of the block's
    subject, then the names the schema declares and reaches.

  An entry shows the description of its target when the target has one. The
  completion list in the EXPRESS of a schema is unchanged.
- The **Show Description** panel has a **Go to declaration** link under its
  heading, which opens the EXPRESS that the description is for.
- **Find All References and Rename include the description blocks.** Until
  now both stopped at `END_SCHEMA;`, so renaming an entity left the keys of its
  descriptions and the cross-references to it behind.
  - **Find All References** (Shift+F12) on a schema, declaration, attribute,
    enumeration item, parameter, WHERE rule or UNIQUE rule also lists the part
    of each key that names it (`.__note` and the other role suffixes included),
    the `<<express:...>>` cross-references to it, and its name written in the
    text of a block, in every file of the workspace. It starts from any of
    those places as well as from the EXPRESS.
  - **Rename** (F2) also updates those keys and cross-reference targets, and
    the display text of a cross-reference when it is exactly the old name. The
    name written in the text of a block is not changed: it may be an ordinary
    word. Rename starts from the EXPRESS, from a key or from the target of a
    cross-reference.
  - An attribute and the attributes that redeclare it without `RENAMED` are
    found and renamed together, with the descriptions of each.
  - The label of a WHERE rule can now be renamed, from the rule or from its
    key.
  - Rename refuses a new name that is not an EXPRESS identifier.
- **Open Tutorial** (command palette, and a walkthrough on the Welcome page):
  the tutorial for Describe Declaration and its two demo schemas are now part
  of the extension. The command copies the demo to the extension's storage
  folder and opens it in a window of its own, with the tutorial beside the
  schema; run again, it continues with that copy or starts over with a fresh
  one. The package grows by about 40 KB.
- EXPRESSsuite now runs in **Restricted Mode**, the mode in which VS Code
  opens a folder that is not yet trusted. Until now it was switched off there:
  an EXPRESS file showed as plain text, with no checks, and nothing said why.
  The extension reads the files of the workspace and its own four settings; it
  runs no program and loads no code from the workspace.

### Bug Fixes

- **The editor knows the EXPRESS remark marks.** Toggle Line Comment writes
  `--` and Toggle Block Comment writes `(* *)`; they wrote `//` and `/* */`,
  which are not EXPRESS. Typing `(*` now gives `(* *)` with the cursor inside;
  it gave `(*)`, so that a description block begun with `(*"` was left with a
  stray `)` after its key.
- **A workspace kept under a folder named `doc`, `library`, `utils` and the
  like is checked again.** With `expresssuite.useOptimizedConfiguration` on
  (the default), the names of `expresssuite.excludedFolders` were compared
  with every folder of a file's full path, so a workspace anywhere below a
  folder with one of the default names (for example `/home/me/library/schemas`
  or `D:\doc\step`) got no diagnostics, hover or completion, with no message.
  The names are now compared only with the folders inside the workspace
  folder. Of nested workspace folders the innermost counts, and a file outside
  every workspace folder is in no excluded folder
  ([#120](https://github.com/TRThurman/EXPRESSsuite/issues/120)).
- **`expresssuite.excludedFiles` no longer leaves out a file whose name only
  contains the letters of a keyword.** A keyword is now a part of the file
  name, bounded by a character that is not a letter or a digit: the default
  `lf` leaves out `mim_lf.exp` and `mim_lf_patched.exp` as before, and no
  longer `shelf_schema.exp`
  ([#120](https://github.com/TRThurman/EXPRESSsuite/issues/120)).

## [0.6.0](https://github.com/TRThurman/EXPRESSsuite/compare/0.5.1...0.6.0) (2026-11-16)

### Features

- **Describe Declaration** (right-click menu or command palette) writes the
  description block of a declaration, `(*"schema.name"` ... `*)`, after
  `END_SCHEMA;` from a selected comment, typed text or the clipboard. It
  offers clean-ups for copied text (comment markers, hyphenation, hard wraps,
  non-ASCII characters), links names with an underscore that the schema
  reaches and proposes links for other declared names, writes parameter and
  enumeration-item texts as blocks of their own, ends an OPTIONAL attribute's
  description with `The value of this attribute need not be specified.`,
  appends to or replaces a block or adds another note or example, removes the
  selection it used from its comment, and shows the change in the refactor
  preview, undone in one step. Tutorial, demo workspace and storyboard:
  `docs/tutorial/`.
- The description blocks after `END_SCHEMA;` are checked (`annotation-*`,
  warnings; `annotation-link-unverified` is information): links to undeclared
  items or with a space, links to the block's own subject, keys no declaration
  has, a key repeated (notes, examples and other `.__` blocks may repeat),
  remarks without a key that would be published, non-ASCII characters, an
  attribute link in the first sentence of a declaration's description, an
  OPTIONAL attribute's description without the closing sentence, an entity
  description that only names its supertype, and a keyed block inside
  `SCHEMA ... END_SCHEMA;`. Long forms are not checked. On the SMRL v8 corpus
  the check adds 4 `annotation-unkeyed-remark` warnings in the default
  workspace.
- Five checks of description blocks for constructs that the ISO 10303
  publication pipeline mishandles (tutorial section 10, requirements in
  `docs/REQUIREMENTS-annotation-publication-checks.md`), read through a
  classifier of the AsciiDoc lines. Warnings, with a quick fix for the first
  two: `annotation-continuation-without-list` (a `+` whose chain does not start
  at a list item), `annotation-glued-continuation` (a `+` glued to the `]` of a
  block macro), `annotation-block-macro-inline` (a block macro not at the start
  of a line, or in a cell that is not `a|`). Information, behind the new
  setting `expresssuite.annotations.publicationHazards` (default on):
  `annotation-open-block-delimiter` (a line `--`, which closes the schema
  page's `[source]` listing; metanorma/iso-10303 issue 857) and
  `annotation-list-chain-macro` (a list item whose `+` chain attaches a macro,
  detached by metanorma-plugin-lutaml 0.7.68 and later; issue 862). An
  `annotation-orphan-key` is now also reported for a key of another schema than
  the one the block follows. None of them reports on the SMRL v8 corpus.
- Report a reference spelled differently from the declaration it binds to
  (`reference-name-case`, warning, with a quick fix that respells it): a
  supertype in SUBTYPE OF or a supertype expression; an attribute, parameter,
  local, return or select-member type; a BASED_ON type; an INVERSE entity; a
  schema or item in USE FROM and REFERENCE FROM. Under the case rule an entity
  or schema written in another case does not bind in a short form; the check
  then names the declaration in scope that differs only in case. A schema
  named in an interface clause is also held to the WG 12 convention: resource
  schemas lower case, ARM and MIM schemas (long forms included) with an
  initial upper-case letter. EXPRESS reads names regardless of case (ISO
  10303-11:2004 7.1.2); the spelling is a WG 12 rule, and the ISO 10303
  publication builds resolve names by exact spelling (requirement XS-PUB-004).
  Long forms are not checked: eengine generates them and their names are
  unique regardless of case (WG11 N239). On the SMRL v8 corpus the check adds
  306 warnings in 114 files of the default workspace, for example `REFERENCE
  FROM ISO13584_expressions_schema` against `SCHEMA iso13584_expressions_schema`.

### Bug Fixes

- **Show Description** from the editor's right-click menu opens the
  description of the name at the cursor. VS Code passes a command run from
  that menu the editor's file URI; the command read the URI's path as a
  declaration path, reported `No description found for "<file path>"` and
  opened nothing. The command palette, hovers and description-panel links
  were not affected.

## [0.5.1](https://github.com/TRThurman/EXPRESSsuite/compare/0.5.0...0.5.1) (2026-11-06)

### Bug Fixes

- Report a group reference that is not further qualified with an attribute
  reference and is not an operand of `=` or `||`
  (`unqualified-group-reference`, error, ISO 10303-11:2004 12.7.4, Rules and
  restrictions), such as `the_datum : datum :=
  datum_basis_relationship[1]\shape_aspect_relationship.related_shape_aspect\datum;`
  ([#102](https://github.com/TRThurman/EXPRESSsuite/issues/102)). A group
  reference followed by another group reference or by an index is reported
  too (12.7.4, 12.6.1). Assignment targets are statements, not expressions,
  and are not checked (13.3). The restriction, the check's per-qualifier loop
  and the partial-value semantics are proved equal in
  `lean/ExpressSuite/GroupReference.lean`. On the SMRL v8 corpus the check
  adds 30 errors in the default workspace and 406 in the long forms, each
  agreeing with an independent token scan (`group-reference-corpus-oracle.test.ts`).

### Tests

- CI builds the Lean proofs (`lean/check.sh` in a new `lean` job): a proof
  that does not check, a `#guard` that does not hold, a `sorry`, or an axiom
  other than `propext`, `Classical.choice` and `Quot.sound` fails the build
  ([#97](https://github.com/TRThurman/EXPRESSsuite/issues/97)).
- The unit suite checks that every Lean name cited in `src/`, `docs/` and
  `lean/README.md` occurs in the Lean code (`lean-citations.test.ts`); it
  found `clash` cited for the relation `Clash`.

## [0.5.0](https://github.com/TRThurman/EXPRESSsuite/compare/0.4.2...0.5.0) (2026-11-02)

### Features

- Report an identifier that denotes two different declarations in one
  schema's scope (`duplicate-interfaced-declaration`, ISO 10303-11:2004
  10.1 b), in every schema whose scope has the clash, during every validation
  pass; the former entity-only `Entity has non-unique name` check is folded
  into it, and the Problems view now shows the clash without running a
  command. The scope follows clause 11 (USE re-exports along chains and
  renames, REFERENCE sees declared-in and use'd-by items but never chains,
  item lists filter, one declaration by several routes counts once) and is
  proved in `lean/ExpressSuite/Interfaces.lean`. Entity names are keyed
  case-significantly in short forms; long forms fold case for every kind and
  report identical repeats as the warning `redundant-declaration` (WG11
  N239). The command **Detect Duplicate Declarations in Schema Closure** now
  uses the same relation (it no longer re-exports `REFERENCE FROM` items along
  `USE FROM` chains or ignores item lists) and publishes the same code.
- Report an attribute reference that is ambiguous under 12.7.3
  (`ambiguous-attribute-reference`, warning): the nearest depth that declares
  the name holds declarations in two or more entities, as with `basis_curve`
  on a `curve` operand (declared by `offset_curve_2d` and `offset_curve_3d`).
  The linker still binds the first candidate; the NOTE of 12.7.3 recommends a
  group reference.
- Check attribute redeclarations for type compatibility
  (`redeclaration-not-specialization`): the type of a redeclared attribute must
  be the same as, or a specialization of, the original attribute's type
  (ISO 10303-11:2004 9.2.3.4 a, 9.2.7). Defined types and selects are seen
  through on both sides and `SELECT BASED_ON` extensions in the workspace are
  folded in, so valid narrowings through a defined or select type on the
  original side are accepted;
  a failed check against an EXTENSIBLE original select is a warning.
- Report an index qualifier applied to an operand whose declared type can never
  hold an aggregate value (`index-on-non-aggregate`, ISO 10303-11:2004 12.6.1).
- Both relations are transcribed from Lean 4 definitions whose soundness
  against the EXPRESS value semantics is machine-checked (`lean/`). The 12.7.3
  and 12.7.4 scopes are likewise transcribed from `lean/ExpressSuite/Inheritance.lean`,
  which proves that the attribute walk computes exactly the 12.7.3 set and the
  group walk exactly the 12.7.4 set.

### Bug Fixes

- Validate an empty or remarks-only `.exp` file without throwing. Such a
  file parses to a root without a schema list; the informal-proposition
  check iterated it and threw, which aborted the whole document's validation
  ("An error occurred during validation: TypeError: ... is not iterable"
  in the server log), and the duplicate-declaration command failed on it
  the same way.
- No more "EXPRESSsuite has finished loading your workspace" popup. It
  appeared after every build: at startup, after each save and after the
  Build command. The status bar shows a check mark for a moment instead and
  then offers the Build button again.
- Find a description across files. The hover and **Show Description** show
  the remark of the declaration the word at the cursor is bound to, through
  the schema's USE and REFERENCE statements (ISO 10303-11:2004 clause 11),
  wherever that remark lives: hovering `string_literal` in a schema that does
  `REFERENCE FROM iso13584_expressions_schema (string_literal)` shows
  iso13584_expressions_schema's description of it, and a `<<express:...>>`
  cross-reference in a description opens its target from any file. Two
  defects kept this from working: the server created its remark index on the
  first hover request, so nothing the workspace had parsed before that was
  ever indexed, and the hover looked a remark found in another file up in the
  active file's own index.
- Bind names under the project's case rules (ISO 10303-11:2004 7.1.2, SC4
  conventions, WG11 N239): an exact match first, otherwise a match regardless
  of case among the kinds that do not carry case. Attribute, type, function,
  procedure, constant, enumeration, parameter and local names now bind
  regardless of case everywhere (`SELF\Value_with_unit.Unit` names the
  attribute `unit`); entity and schema names still bind exact-case in a short
  form; in a long form (`_lf`) every name binds regardless of case. The
  linker used to bind every reference to the exact spelling.
- Resolve an attribute reference `x.a` against the declared type of `x`, its
  supertypes and its subtypes only (ISO 10303-11:2004 12.7.3), nearest first.
  The scope used to be the whole connected subtype/supertype graph, so `x.a`
  could bind to a same-named attribute of a sibling entity, and which sibling
  won depended on document load order (hover, go-to-definition and completion
  were affected alike). Group references `x\E` keep the whole graph, as 12.7.4
  requires, and `x\E.a` keeps E's own declarations. INVERSE `FOR a` now names
  an explicit attribute of the referencing entity or its supertypes (9.2.1.3).
  Subtype candidates are ordered by name, so the binding is the same on every
  run. On the published SMRLv8 this moves 3,518 attribute references from
  outside the 12.7.3 set to inside it and removes 35 false linking errors.
- Step over any number of index qualifiers when finding the operand of an
  attribute reference, so `s.segments[i][j].parent_surface` resolves.
- Name the attribute in the linking error for an unresolved `.a`.
- A `REFERENCE FROM` with no item list now makes visible what the foreign
  schema declares and what it use's (ISO 10303-11:2004 11.2), not only its
  own declarations, for supertype and attribute-type resolution.
- The declaration-name-case check treats a schema named `<module>_arm_lf`
  as an ARM schema. An ARM long form was held to the MIM convention, so every
  initial-capital entity in it was noted.
- The informal-proposition check no longer aborts a document's validation
  with a TypeError when the document parsed without a schema body (a
  fragment); it has nothing to check there.
- The type container and the scope index process documents in URI order,
  so supertype resolution, `reference-statement-missing` and duplicate
  declaration results no longer depend on the order in which the file system
  lists a workspace.
- An unqualified name in an expression or in a RULE's FOR list binds through
  the schema's interfaces (ISO 10303-11:2004 clause 11) before the workspace
  index, and the index is consulted in document-URI order. The index holds
  every schema of the workspace, so a same-named declaration in an unrelated
  schema could win, and which one won depended on the order in which the file
  system listed the documents: on macOS, `class` in the published
  `Catalog_data_information_mim` bound to another schema's `class`, raising
  four `reference-statement-missing` errors that Linux did not raise.
- Answer hover, outline, folding, completion and code-action requests on a
  document the build excludes (for example an `_lf.exp` long form under the
  optimized configuration). Such a document never reaches the Linked state,
  so every request on it failed with `RequestFailed (-32803)`; the server now
  lets the request proceed and the providers return nothing for it.
- Package `CHANGELOG.md` with the extension, so the Marketplace listing has
  a Changelog tab. `.vscodeignore` had excluded it.
- Bind the `BASED_ON` target of an enumeration extension when the base is an
  `EXTENSIBLE ENUMERATION` declared with no items (ISO 10303-11:2004 8.4.1),
  as the four `a3m_*_type_name` enumerations of
  `Annotated_3d_model_equivalence_criteria_arm` are. The type factory filed an
  item-less enumeration as a plain type, so the extension's scope, which holds
  enumeration types only, never offered it, and every such extension was
  reported as "not available and may require an interface" (18 sites in the
  SMRL v8 short forms). Found by the 0.5.0-0 smoke test.
- Follow an `<<express:...>>` cross-reference inside the **Show Description**
  panel. Asciidoctor renders it as an in-page anchor with no target, so a
  click did nothing; it now opens the target's description, as the same link
  does from a hover. The panel passes its own source file along, because VS
  Code reports no active text editor while the panel is the active tab.
  Found by the 0.5.0-1 and 0.5.0-2 smoke tests.

### Tests

- The EXPRESS schema files of the published ISO 10303 SMRL v8 are a
  regression corpus: 1,410 `.exp` files under `test-fixtures/smrlv8`,
  byte-identical to the distribution. `npm run test:smrlv8` loads the 1,287
  files the default settings admit as one workspace and the 103 long forms
  directly, and compares every diagnostic with the baselines under
  `test-fixtures/smrlv8-baseline`; CI runs it on one Linux runner. The
  baselines pin behaviour, not correctness; the known false-positive classes
  are listed in the baseline README.
- Headless census of workspace diagnostics and of the schema-closure duplicate
  command, for differential work (`src/test/workspace-*.test.ts`, env-gated).
- Headless link-target census: where every attribute reference and INVERSE FOR
  binds, classified against the 12.7.3 set (`src/test/workspace-link-targets.test.ts`).
- Two-sided scope tests: group references must keep reaching siblings, attribute
  references must never (`src/test/attribute-qualifier-scope.test.ts`).

## [0.4.2](https://github.com/TRThurman/EXPRESSsuite/compare/0.4.2-0...0.4.2) (2026-09-30)

### Bug Fixes

* allow an explicit version when promoting a pre-release ([c7e251e](https://github.com/TRThurman/EXPRESSsuite/commit/c7e251e752ef00c34f61567e59efe5e0dcd98303))

## [0.4.2-0](https://github.com/TRThurman/EXPRESSsuite/compare/0.4.0...0.4.2-0) (2026-09-30)

### Bug Fixes

* let the release workflows push, and attribute them correctly ([3176eb6](https://github.com/TRThurman/EXPRESSsuite/commit/3176eb62d2b2ad323f602ca44563bae423ce8d43))
* lex EXPRESS numeric literals per ISO 10303-11 ([76f666f](https://github.com/TRThurman/EXPRESSsuite/commit/76f666ff27385ca998d9b5d8a024766cce53ddfb))
* lex EXPRESS string literals per ISO 10303-11 ([4ec2684](https://github.com/TRThurman/EXPRESSsuite/commit/4ec26845ec3e3bfd7450bfa75a87df3f89a59cdc))
* lex nested EXPRESS remarks ([052a9f0](https://github.com/TRThurman/EXPRESSsuite/commit/052a9f04eff1f4d6fea679de8c9275c4c045a3c3))
* match @types/vscode to engines.vscode so the extension packages ([7529117](https://github.com/TRThurman/EXPRESSsuite/commit/75291172a0df28c6d147cf65b05b7de6f89c1d8c))
* resolve SELF inside a TYPE declaration ([d8345ae](https://github.com/TRThurman/EXPRESSsuite/commit/d8345aea10ca63447fc7234972ea1aea543e6aec))

## [0.4.1] (2026-09-15)

### Product identity

- Rename the independently maintained derivative to **EXPRESSsuite**, with
  Visual Studio Marketplace identity `TRThurman.expresssuite` and repository
  location `TRThurman/EXPRESSsuite`. Preserve NIST easyEXPRESS attribution and
  the stable `express` language identifier.
- Add a distinct EXPRESSsuite application icon and coordinated Marketplace
  gallery banner, visually separate from NIST branding.
- Move commands and settings to the independent `expresssuite.*` namespace so
  EXPRESSsuite can run alongside NIST easyEXPRESS without global ID collisions.

### Security

- Upgrade vulnerable development and release tooling, including ESLint,
  Vitest, Vite, release-it, jsdom, and their transitive dependencies.
- Upgrade Asciidoctor.js to 4.0 and migrate the description viewer to its
  asynchronous API, removing the vulnerable legacy glob dependency while
  preserving the secure render-and-sanitize pipeline.
- Make the complete dependency audit a required CI step instead of allowing
  production-only audit failures to pass.

### Validation

- Hold diagnostics and navigation requests until the initial workspace build
  is complete, and report loading completion only when references are ready.
- Read the renamed `expresssuite.*` optimization settings through Langium's
  configuration service instead of silently falling back to an empty section.
- Allow quick-fix requests once references are indexed, avoiding a startup
  failure for workspace documents that are not eagerly validated.
- Enforce SC4 declaration-name casing: initial-uppercase entity names in ARM
  schemas, lowercase entity names outside ARM schemas, and lowercase type
  names everywhere. Casing diagnostics provide a rename quick fix.
- Detect explicit `LOCAL` declarations that duplicate the index implicitly
  declared by a `REPEAT` increment control. Identifier matching is
  case-insensitive.
- Add **EXPRESSsuite: Detect Duplicate Declarations in Schema Closure** to the
  Command Palette and EXPRESS editor context menu. The cancellable check walks
  transitive `USE FROM` and `REFERENCE FROM` relationships and publishes
  cross-linked Problems diagnostics for conflicting schema-level declarations.
- Validate informal proposition (`IPn`) signatures and annotation keys.
  Diagnostics cover missing, malformed, misplaced, non-final, and unmatched
  signatures as well as malformed `.IPn` / `.ipn` annotation keys.
- Accept declarations visible through transitive schema imports without
  publishing false diagnostics that request redundant direct imports.

### Tests

- Add coverage for ARM/non-ARM naming, duplicate loop indices, direct and
  transitive schema closures, cyclic interfaces, renamed resources, all
  surveyed IP signature forms, and comment-scanning false positives.
- 98 automated tests now pass.

## [0.4.0] (2026-05-02)

### Features

- **Description preview**: AsciiDoc renderer for `(*"tag" body *)` named-remark
  comments in EXPRESS schemas. Renders Metanorma constructs (cross-refs,
  emphasis, listings, tables) and embedded math via Plurimath → MathML →
  Chromium-native rendering.
- **EXPRESS-G SVG preview**: interactive viewer for `<schema>expg<N>.svg`
  diagrams with hot-spot navigation. Click a labeled box to jump to the
  entity's source declaration. The diagram picker narrows to SVGs that
  reference the cursor entity.
- **AsciiMath playground**: live-render webview that converts AsciiMath
  input to MathML (debounced ~200 ms after last keystroke). "Insert at
  cursor" pastes the source as `stem:[…]` into the active EXPRESS file.
- **Hover provider**: rich `MarkdownString` hovers showing the named-remark
  description of the entity at the cursor, with `<<express:…>>` xrefs
  rendered as clickable command-links and `stem:[…]` rendered as inline
  SVG (via MathJax v4). Cross-schema lookup falls back to a workspace-wide
  annotation index.
- Three new commands and two context-menu entries:
  - `EXPRESSsuite: Show Description`
  - `EXPRESSsuite: Show EXPRESS-G Diagram`
  - `EXPRESSsuite: Open AsciiMath Playground`

### Architecture

- New language-server-side `ExpressP11AnnotationIndex` service walks the CST
  for hidden `ML_COMMENT` tokens on each parse and maintains a per-document
  annotation map. Exposed via custom LSP requests `express/getAnnotations`
  and `express/findAnnotationsForEntity`.
- New custom LSP request `express/resolveEntity` uses Langium's
  `IndexManager.allElements()` for entity-name → source-location lookup
  (used for EXPRESS-G hot-spot navigation). Falls back to a filesystem
  scan for files the language server has not yet indexed.
- Plurimath rendering runs in an isolated `node:worker_threads` worker with
  a 2-second per-render timeout. Hung renders terminate the worker; the
  next call respawns it.
- Webview vendor assets ship as native ESM under `out/webview/vendor/`;
  controllers load them via dynamic `import()`. Math rendering happens
  host-side because the Opal-runtime backed Plurimath cannot be bundled by
  esbuild and cannot run inside a webview's CSP `unsafe-eval` context —
  the resulting MathML is sent to the webview through the JSON payload.

### Security model

Per-surface webview isolation with strict CSP, `unsafe-eval` confined to
surfaces that need it. SVG sanitized via DOMPurify with explicit tag/attr
allow-list and a URI-scheme filter that permits the EXPRESS-G
integer-href hot-spot convention while stripping `javascript:`,
`data:text/html`, etc. Asciidoctor runs with `:safe-mode: secure`; output
is also DOMPurified because secure mode does not strip `pass:[]` /
`+++…+++` passthroughs. `MarkdownString.isTrusted` uses the array form to
whitelist only `vscode.open` and `expresssuite.*` commands. Webview→host
messages are schema-validated; resource limits cap per-expression and
per-document math work to prevent DoS via pathological input.

### Tests

- 73 tests (was 42) covering remark parsing, message validation, and
  defense-in-depth security mitigations (SVG sanitization, Asciidoctor
  passthrough stripping, MathML preservation, command-URI whitelisting).
- Renderer comparison fixtures for geometry_schema, topology_schema,
  mesh_topology_schema, presentation_appearance_schema, and
  equations_schema in `test-fixtures/asciimath/`.

### Dependencies

- Added (runtime, exact-pinned): `@asciidoctor/core@3.0.4`,
  `@plurimath/plurimath@0.2.2`, `dompurify@3.4.2`, `mathjax@4.1.1`.
- `@plurimath/plurimath` and `mathjax` are esbuild externals; they ship
  in `node_modules` of the published `.vsix` (whitelisted in
  `.vscodeignore`).

## [0.3.4](https://github.com/usnistgov/easy-express/compare/0.3.3...0.3.4) (2024-01-24)


### Bug Fixes

* update error messages ([5cbf1a5](https://github.com/usnistgov/easy-express/commit/5cbf1a5196283f6f5ab294f7f7dbfc85dfde3800))
* update scope of entities in subtype/supertype constraints ([9d30f17](https://github.com/usnistgov/easy-express/commit/9d30f17fc46034dac41eefe1b802a39202cefec5))
* update SELF resolution for qualifiers ([5a275bf](https://github.com/usnistgov/easy-express/commit/5a275bf368f767bb0bbf70c8018bc47bac4d073a))
* update USEDIN resolution and return type ([631374f](https://github.com/usnistgov/easy-express/commit/631374fa12c1e71ba00f451f3bc857d06d8a5efb))

## [0.3.3](https://github.com/usnistgov/easy-express/compare/0.3.2...0.3.3) (2024-01-23)


### Bug Fixes

* add contextual scope resolution for type extension ([59e2f8b](https://github.com/usnistgov/easy-express/commit/59e2f8bf4315743edf8fbaa8654934a6a6fad61c))
* add processing of incomplete type extension ([e34f2de](https://github.com/usnistgov/easy-express/commit/e34f2de19c1df08b0ea8e16ccc191ed4ba1f706f))
* update memoization of interface resolution ([cb752f8](https://github.com/usnistgov/easy-express/commit/cb752f8b90f44017e37f146ff711a6f39a881230))

## [0.3.2](https://github.com/usnistgov/easy-express/compare/0.3.1...0.3.2) (2024-01-16)


### Bug Fixes

* retrieve attributes without name from an optimized list ([6648f7e](https://github.com/usnistgov/easy-express/commit/6648f7e087c74e40ce06a0a46fdf5d757076180d))
* update extension packaging options ([82a3354](https://github.com/usnistgov/easy-express/commit/82a3354432c539900e03f4227dd75bee567361cc))

## [0.3.1](https://github.com/usnistgov/easy-express/compare/0.3.1-0...0.3.1) (2024-01-11)

## [0.3.1-0](https://github.com/usnistgov/easy-express/compare/0.3.0...0.3.1-0) (2024-01-09)


### Bug Fixes

* Change attribute snippet description ([bd8e7f3](https://github.com/usnistgov/easy-express/commit/bd8e7f370a80ff516847f170df561402268c344c))
* update type system computation ([#20](https://github.com/usnistgov/easy-express/issues/20)) ([eababce](https://github.com/usnistgov/easy-express/commit/eababce945fa5e38ac5eee169eeeb6d2d4c831e5))

## [0.3.0](https://github.com/usnistgov/easy-express/compare/0.3.0-4...0.3.0) (2023-12-04)

## [0.3.0-4](https://github.com/usnistgov/easy-express/compare/0.3.0-3...0.3.0-4) (2023-12-04)

## [0.3.0-3](https://github.com/usnistgov/easy-express/compare/0.3.0-2...0.3.0-3) (2023-12-04)


### Features

* add partial resolution of query variables ([55bd1c5](https://github.com/usnistgov/easy-express/commit/55bd1c594ea179c89836c4548e919fddc465b58e))
* add qualifiers on function call ([318ca45](https://github.com/usnistgov/easy-express/commit/318ca45a19163ec950dabdc085916bf9c425bceb))
* add release workflow ([42183fd](https://github.com/usnistgov/easy-express/commit/42183fd43fb630331df3bb4339c7a046fc99a47c))


### Bug Fixes

* add constants to document exports ([0b530a9](https://github.com/usnistgov/easy-express/commit/0b530a99fdba9473f76442d85c28af179657c92f))
* add proper highlighting of subtype_constraint ([40c5aa9](https://github.com/usnistgov/easy-express/commit/40c5aa90f8e0b2dfe61b8865dd4e84d0468003fe))
* change multiplicity in Total_over entities ([3040c7b](https://github.com/usnistgov/easy-express/commit/3040c7b50d51fd2f5539303e1b744b0017525db2))
* misc syntax highlighting ([c9aed1f](https://github.com/usnistgov/easy-express/commit/c9aed1f667a9734123a781c7765baabaab7f74b1))
* remove unwated fullgraph return ([c2f9ada](https://github.com/usnistgov/easy-express/commit/c2f9ada97eabcb6d92b64e891af97008d1a9c7b5))
* update string syntax highlight match ([89a71fb](https://github.com/usnistgov/easy-express/commit/89a71fbb6ee4982674c992ae4c0ffa736ca9baf2))

## [0.3.0-2](https://github.com/usnistgov/easy-express/compare/0.3.0-1...0.3.0-2) (2023-11-13)


### Bug Fixes

* assets folder to vscodeignore ([1f86283](https://github.com/usnistgov/easy-express/commit/1f86283041263694bb0ccfedae7be91b2a9197eb))

## [0.3.0-1](https://github.com/usnistgov/easy-express/compare/0.3.0-0...0.3.0-1) (2023-11-13)


### Bug Fixes

* add step to pre-release workflow ([07b2eaf](https://github.com/usnistgov/easy-express/commit/07b2eaf28e70e1385bc70f3afee8d53d8f55a79f))
* missing assignment in Local_variable ([ee9519f](https://github.com/usnistgov/easy-express/commit/ee9519feb1622f549bf248ba6ab882f45dcbde83))

## 0.3.0-0 (2023-11-13)


### Features

* add prerelease version workflow ([868293a](https://github.com/usnistgov/easy-express/commit/868293a39581988ec5e51afb0b88a9bf22501314))
* migrate core to v2 ([5a74866](https://github.com/usnistgov/easy-express/commit/5a7486629817856807991dc5762acd12cabb119b))
