# SMRL v8 baselines

What the language server publishes for the EXPRESS schemas of the published
ISO 10303 SMRL v8 in `../smrlv8`, pinned so that a change in the parser, the
linker or a validator shows as a reviewable diff. Produced and checked by
`npm run test:smrlv8` (`src/test/smrlv8-corpus.test.ts`,
`src/test/smrlv8-longforms.test.ts`); regenerate after an intended change with

```
EXPRESS_UPDATE_SMRLV8_BASELINE=1 npm run test:smrlv8
```

and review the diff before committing it. A baseline pins behaviour, not
correctness: several of the classes below are known false positives.

## default-diagnostics.json

The corpus folder loaded as one workspace with the extension's default
settings: `useOptimizedConfiguration` on, so files whose name contains `lf`
or `concatenated` and the `business_object_models` folder are not loaded.
1,287 of the 1,410 files load; 6,508 diagnostics
(4,056 error, 704 information, 1,748 warning) in
285 files. `files` maps file to code to the 1-based start
line of every diagnostic. `parseErrors` lists the files with lexer or parser
errors: only `modules/solid_with_local_modification/Revisedent.exp`, a
26-line fragment the distribution ships beside the module, not a schema.

| code                                     |  count |
|------------------------------------------|--------|
| linking-error                            |  3,470 |
| (none)                                   |  1,737 |
| declaration-name-case                    |    704 |
| reference-statement-missing              |    265 |
| duplicate-interfaced-declaration         |    229 |
| duplicate-loop-index                     |     72 |
| redeclaration-not-specialization         |      9 |
| informal-proposition-malformed-signature |      7 |
| informal-proposition-missing-annotation  |      6 |
| ambiguous-attribute-reference            |      4 |
| informal-proposition-misplaced-signature |      3 |
| parsing-error                            |      2 |

## default-duplicate-declarations.json

Every `duplicate-interfaced-declaration` site of that workspace with its
identifier, the schemas that declare it, the message and the number of
related locations: 229 sites, 105 distinct identifiers,
13 files. Each is a declaration present in two published
modules and visible together in a third (or in one of the two). The files:

- `modules/ap203_configuration_controlled_3d_design_of_mechanical_parts_and_assemblies/arm.exp`
- `modules/ap210_printed_part_functional_and_physical_characterization/arm.exp`
- `modules/ap210_printed_part_functional_and_physical_characterization/mim.exp`
- `modules/extended_geometric_tolerance/arm.exp`
- `modules/extended_geometric_tolerance/mim.exp`
- `modules/part_template_2d_shape/arm.exp`
- `modules/part_template_2d_shape/mim.exp`
- `modules/part_template_extension/arm.exp`
- `modules/part_template_extension/mim.exp`
- `modules/physical_layout_template/arm.exp`
- `modules/physical_layout_template/mim.exp`
- `modules/product_identification_extension/arm.exp`
- `modules/product_identification_extension/mim.exp`

## longform-diagnostics.json

The 103 published long forms (`modules/*/arm_lf.exp`,
`modules/*/mim_lf.exp`), each built alone in services of its own with the
excludes cleared: 34,833 diagnostics in 88 files (15 long forms have none),
counts per file and code (no line numbers: the files are large and the
counts are what a change moves). No long form has a parse error, a
`duplicate-interfaced-declaration` or a `redundant-declaration`.

| code                             |  count |
|----------------------------------|--------|
| linking-error                    | 34,263 |
| duplicate-loop-index             |    457 |
| ambiguous-attribute-reference    |     70 |
| redeclaration-not-specialization |     32 |
| declaration-name-case            |     11 |

## Known classes that are not defects in the schemas

- `linking-error` "The attribute '…' could not be found" (also "The entity
  '…' could not be found" and "A reference could not be resolved"): an
  attribute or group reference the linker cannot bind. The largest class in
  both baselines (3,470 of the default-settings sites, 1,489 of them
  in `resources/automotive_design/automotive_design.exp` and
  `domain_models/managed_model_based_3d_engineering_domain/DomainModel.exp`;
  34,263 in the long forms). Not classified
  site by site. The sampled long-form sites (AP203 ARM and MIM long forms,
  2026-10-30) are valid EXPRESS of three shapes:
  - the operand is a QUERY variable over a nested QUERY, a function result
    or an attribute path, which the linker does not type
    (`msb\manifold_solid_brep.outer`, `csh\oriented_closed_shell.orientation`,
    `mi\mapped_item.mapping_source.mapped_representation`, `temp.role` over
    `bag_to_set(USEDIN(...))`);
  - the attribute is written in another case than its declaration
    (`SELF\Value_with_unit.Unit` for `unit`, nine sites in that file):
    attribute names are not case-significant (ruling 2026-10-30), the
    linker binds them exact-case today;
  - the group qualifier names an entity in another case than its
    declaration (`SELF\representation_relationship.rep_2` for
    `Representation_relationship`; three such group references in that
    file). Entity names are case-significant in short forms; whether a long
    form binds them regardless of case (WG11 N239) is an open ruling.
- `linking-error` at `resources/product_structure_schema/product_structure_schema.exp`
  lines 192 and 194: a UNIQUE rule naming an inherited attribute and an
  INVERSE declared in a supertype, both valid EXPRESS (verified 2026-10-30).
- `(none)`, "Attribute name should start with a lower case.": a diagnostic
  without a code yet.
- `reference-statement-missing` depends on which of two same-named
  declarations the type container keeps (the last in document-URI order), so
  its sites move when a duplicate declaration enters or leaves the corpus.
