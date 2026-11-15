# Requirements: checks for source constructs that the publication pipeline mishandles

Draft of 2026-11-15, for Tom's review. Not implemented, not committed.

## Why

The description blocks after `END_SCHEMA;` are AsciiDoc. The ISO 10303 publication pipeline (suma, metanorma-plugin-lutaml,
expressir, Asciidoctor) wraps them in AsciiDoc of its own, rewrites some of their lines and inserts paths into them,
working on the text without parsing it. Where a block uses the same constructs, the final Asciidoctor parse reads the
combination differently from what the author or the tool intended. The WG 12 acceptance test of metanorma-cli 1.18
measured this on metanorma/iso-10303 mn/main 665a96c330 (suma 0.5.42, metanorma-plugin-lutaml 0.7.69):

- F-59: a line `--` in a printed remark closes the `[source]` block of the schema page; the rest of the page is rendered
  as AsciiDoc (43 of 125 schema pages).
- F-60: plugin-lutaml 0.7.68+ blanks a `+` before an image unless the line before it is a list item by its regular
  expression; inside the continuation chain of a `. ` list item this breaks the chain, and the `+` lines left are printed.
- F-51: block macros written inside a line of text, in an ordinary table cell, after a `+` that follows a plain
  paragraph, or with a `+` glued to the macro, are printed as text by Asciidoctor itself.
- F-58: the ISO 10303-2 build resolves a citation by exact spelling; a SUBTYPE OF clause that spells a supertype in a
  different case from its declaration lands on another schema's declaration of that spelling.

Records: metanorma-pr-testing `reports/wg12-step-acceptance-mncli118/RESULTS.md` (F-51, F-58 to F-60) and `README.md`
(2026-11-15); rulings RUL-26, RUL-36 and RUL-37 in `spec/SPEC.md`; the output gates MPT-OUT-001 to 005 in
`spec/requirements.json`.

EXPRESSsuite can show these constructs to the author while the block is written, before any build. The rules below
extend the annotation check of pull request 110 (`src/language/annotation/check.ts`, codes `annotation-*`; open, not on
`origin/main`).

## Two classes

- **Class A, source errors.** The construct is wrong in the source under AsciiDoc or under a WG 12 rule, whatever the
  pipeline does. Severity warning, with a quick fix where the correction is unambiguous.
- **Class B, publication hazards.** The construct is valid AsciiDoc that the current toolchain mishandles. Severity
  information, behind a setting; each rule names the upstream defect and the toolchain versions, and is retired when
  the defect is fixed. EXPRESSsuite never rewrites a Class B construct by itself (Tom, 2026-11-15: valid AsciiDoc stays
  allowed; banning it would hide the defect and make the WG 12 output gates pass for the wrong reason).

## Requirements

| id | class | statement | diagnostic | evidence |
|---|---|---|---|---|
| XS-PUB-001 | A | A line `+` shall be reported when the continuation chain it belongs to does not start at a list item. The chain is followed back through the `+` lines and the blocks they attach (paragraphs, block macros, delimited blocks) to the line that starts it; the decision shall not be taken from the preceding line alone. List items are every AsciiDoc list form: `*` to `*****`, `-`, `.` to `.....`, `1.`, `a.`, `A.`, `i)`, `I)`, `1)`, checklist items, and `term::`, `term:::`, `term::::`, `term;;`. Quick fix: replace the `+` with a blank line. | `annotation-continuation-without-list` (warning) | kinematic_structure_schema.exp 1363, 1853, 2881 (plain Asciidoctor prints the `+` and the macro as one text paragraph; TCSC410303-3232). Not reported: the chains of the `. ` items at 2405 and 2727 |
| XS-PUB-002 | A | A block macro line whose closing `]` is followed by `+` (`image::x.gif[]+`, also with attributes) shall be reported. Quick fix: remove the `+`, or put it on its own line when the macro is inside a list item's chain. | `annotation-glued-continuation` (warning) | kinematic_structure_schema.exp 2751 |
| XS-PUB-003 | A | A block macro (`image::`, `video::`, `audio::`, `toc::`) that does not start its line, or that sits in a table cell whose style is not AsciiDoc (`a\|`), shall be reported. | `annotation-block-macro-inline` (warning) | presentation_appearance_schema.exp 2858 and 2879 (TCSC410303-3233); the `.adoc` sections of ISO 10303-46 and -105 have the same forms but are not EXPRESS files |
| XS-PUB-004 | A | A reference shall be spelled as the declaration it binds to: supertypes in SUBTYPE OF and SUPERTYPE OF, attribute, parameter and local types, schema names and items in USE FROM and REFERENCE FROM, and the targets of `<<express:...>>` links. A mismatch in case alone shall be reported (EXPRESS is case-insensitive; the spelling is a WG 12 rule: RUL-26 for schema names, RUL-36 for SUBTYPE OF). Quick fix: respell as declared. Distinct from `declaration-name-case`, which checks the declaration. A schema name in USE FROM or REFERENCE FROM shall also follow the WG 12 convention whether or not the named schema is in the workspace: initial upper case for a name ending `_arm` or `_mim`, lower case otherwise (RUL-26; Tom, 2026-11-15: "2-yes"). | `reference-name-case` (warning) | 11 SUBTYPE OF clauses that the ISO 10303-2 build links to another schema's declaration, e.g. kinematic_structure/arm.exp 280 `SUBTYPE OF (screw_pair)` against `ENTITY Screw_pair` (arm.exp 272); interface clauses such as `USE FROM Product_data_quality_criteria_schema` (product_data_quality_criteria/mim.exp 11) and `USE FROM Aic_curve_swept_solid` (curve_swept_solid/mim.exp 7) |
| XS-PUB-005 | A | A description key qualified with another schema's name shall be reported, role suffix (`.__fund_cons`, `.__note`, ...) included. Confirm with a fixture that `annotation-orphan-key` reports it today; add the case if it does not. | `annotation-orphan-key` (warning) | geometric_model_schema.exp line 5348, key `geometry_schema.__fund_cons` (the block is printed in no listing) |
| XS-PUB-006 | B | A line that is exactly `--` in a description block shall be reported, wherever it stands in the block (a `--` inside a nested listing closes the schema page's listing too). A remark ending `-- *)` counts: the last line of the remark text is `--`. | `annotation-open-block-delimiter` (information) | suma 0.5.42 `lib/suma/schema_template/document.rb` 39 to 42 (`[source]` delimited by `--`); 279 such lines in the 125 SRL schemas, 121 after `[NOTE]`; 43 schema pages close early on 665a96c330. Upstream: iso-10303 #857 comment |
| XS-PUB-007 | B | A list item whose `+` chain attaches a block macro shall be reported when the item's marker or the line before the `+` is one that metanorma-plugin-lutaml's `LIST_ITEM_REGEXP` does not match (a `.` or nested marker, an attached image or paragraph). | `annotation-list-chain-macro` (information) | plugin-lutaml 0.7.68 and 0.7.69 `express_remarks_decorator.rb` `dangling_continuation?`; kinematic_structure_schema.exp 2405 and 2727 (11 `+` lines blanked, 6 `+` printed on the SRL site). Upstream: iso-10303 #862 comment |
| XS-PUB-008 | B | Each Class B rule shall name the toolchain versions it applies to and its upstream issue, and shall be switched off (setting `expresssuite.annotations.publicationHazards`, default on, as information; Tom, 2026-11-15: "1-yes") and later removed when the upstream fix is released and the WG 12 gate that covers it (MPT-OUT-002 for 006, MPT-OUT-004 for 007) passes with the construct present. | (setting) | |
| XS-PUB-009 | all | The rules shall work on the parsed description blocks (`src/language/annotation/blocks.ts`) and on an AsciiDoc line classifier that knows list markers, continuation chains, delimited blocks (`----`, `....`, `====`, `****`, `____`, `--`, `++++`, `\|===`) and table cell styles. No rule shall decide from a single line by regular expression where AsciiDoc context decides (the defect of F-60). | (design) | |
| XS-PUB-010 | all | A corpus test shall run the rules over the schemas of metanorma/iso-10303 at a pinned commit and pin the counts, as the SMRL v8 corpus tests do. On 665a96c330, SRL resource schemas, as measured by the rules: XS-PUB-001 6 lines (kinematic_structure_schema.exp 1363, 1853, 1855, 2881, 2883; geometric_model_schema.exp 3021), -002 1, -003 2 (presentation_appearance_schema.exp 2858, 2879), -006 280 lines in 50 schemas, -007 2 list items. Each rule also gets the false-positive fixtures named in its row. | (test) | metanorma-pr-testing `harness/remark_source_triggers_2026-11-15.rb` (the scan that gave these counts, with the build's own plugin code) |
| XS-PUB-011 | all | Each rule shall be documented in `docs/tutorial/describe-declarations.md` (the check rules), with its class, its source (WG 12 ruling or upstream defect) and an example. | (docs) | |

## Out of scope

Publication defects with no trigger in the source, which no editor check can show: the build directory printed on the
schema pages (MPT-OUT-001), the schema's own remark missing from the schema pages (MPT-OUT-003), the ISO 10303-2 build's
manifest-wide search for a cited declaration (RUL-37). These are watched by the WG 12 output gates.

## Decided (Tom, 2026-11-15)

1. `expresssuite.annotations.publicationHazards` defaults to on, at information severity ("1-yes").
2. XS-PUB-004 also enforces the ARM/MIM naming convention on interface schema names ("2-yes").
3. The convention is an initial capital with the rest lower case for ARM and MIM schemas, all lower case for resource schemas ("confirmed: initial capital with the rest lower case"); implemented in pull request 112.

## Dependence on pull request 110

The annotation rules (XS-PUB-001, -002, -003, -005, -006, -007, -009) extend `src/language/annotation/check.ts` and
read blocks through `blocks.ts`, and XS-PUB-011 writes into `docs/tutorial/describe-declarations.md`: all three files
exist only on pull request 110's branch (`feat/describe-declarations`), not on `origin/main`. XS-PUB-004 is a rule of
`src/language/express-p11-validator.ts`, beside `declaration-name-case`, and its corpus test can use
`src/test/smrlv8-corpus-support.ts`; both are on `origin/main`, so XS-PUB-004 does not depend on pull request 110.

## Open

- A block macro on the line right after a paragraph line, with no `+`, is absorbed into the paragraph by Asciidoctor; no rule reports it yet.
- Revalidation of open documents when `expresssuite.annotations.publicationHazards` changes; the value is read at the next validation.
