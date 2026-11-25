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
1,287 of the 1,410 files load; 6,356 diagnostics
(3,566 error, 704 information, 2,086 warning) in
266 files. `files` maps file to code to the 1-based start
line of every diagnostic. `parseErrors` lists the files with lexer or parser
errors: only `modules/solid_with_local_modification/Revisedent.exp`, a
26-line fragment the distribution ships beside the module, not a schema.

| code                                     |  count |
|------------------------------------------|--------|
| linking-error                            |  3,038 |
| (none)                                   |  1,737 |
| declaration-name-case                    |    704 |
| reference-name-case                      |    345 |
| duplicate-interfaced-declaration         |    229 |
| reference-statement-missing              |    136 |
| duplicate-loop-index                     |     72 |
| unqualified-group-reference              |     30 |
| extension-missing-generic-entity         |     30 |
| redeclaration-not-specialization         |     13 |
| informal-proposition-malformed-signature |      7 |
| informal-proposition-missing-annotation  |      6 |
| annotation-unkeyed-remark                |      4 |
| informal-proposition-misplaced-signature |      3 |
| parsing-error                            |      2 |

The 13 `redeclaration-not-specialization` sites are errors. Both types are
read in the specification of the schema that holds the redeclaration
(ISO 10303-11:2004 clause 11): the declarations visible in it and those
implicitly interfaced (11.4), drawn from the schemas it reaches through its
USE and REFERENCE specifications. A select holds those of its own items that
are in that specification (11.4.2), the items its bases declare, and the
items of the extensions of it in that specification (8.4.2, 13.3.2); an
extension does not hold the items the other extensions of its base add.
Five sites follow from that reading:

- `modules/functional_decomposition_to_design/arm.exp` lines 89 and 90:
  `Functional_unit_terminal_node_assignment` redeclares
  `change_management_object`, an EXTENSIBLE GENERIC_ENTITY SELECT without
  items. Among the schemas `Functional_decomposition_to_design_arm` reaches,
  its only extension is the schema's own `fdtd_change_management_object`
  (`Design_functional_unit_allocation_to_assembly_component`,
  `Design_functional_unit_allocation_to_reference_functional_unit`).
- `modules/kinematic_topology/arm.exp` line 25: `Part_view_definition`
  redeclares `property_assignment_select`. The only extension of it that
  `Kinematic_topology_arm` reaches is `spa_property_assignment_select` of
  `Shape_property_assignment_arm` (`Product_occurrence_definition_relationship`,
  `Shape_element`, `Shape_element_relationship`); the extension that lists
  `Part_view_definition` is in `Single_part_representation_arm`, which it
  does not reach.
- `modules/shape_property_assignment/arm.exp` line 84:
  `assigned_shape_property_select` redeclares `property_assignment_select`,
  whose only extension in reach is the schema's own
  `spa_property_assignment_select`; `Product_view_definition` and
  `View_definition_relationship` are not among its items.
- `modules/layered_interconnect_module_design/arm.exp` line 466:
  `accessed_interface : Laminate_component_interface_terminal` redeclares
  `causal_item : OPTIONAL limd_restriction_basis_item`, and
  `limd_restriction_basis_item = SELECT BASED_ON restriction_basis_item WITH
  (stratum_concept)` admits neither `Laminate_component_interface_terminal`
  nor a supertype of it; the items of the other extensions of
  `restriction_basis_item` are not its items.

`modules/part_shape/arm.exp` line 36 is not reported: the extension of
`part_view_definition_or_part_shape_element_select` that adds
`Product_specification` is in `General_design_connectivity_arm`, which
`Part_shape_arm` does not reach.

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
excludes cleared: 2,429 diagnostics in 94 files (9 long forms have none),
counts per file and code (no line numbers: the files are large and the
counts are what a change moves). No long form has a parse error, a
`duplicate-interfaced-declaration` or a `redundant-declaration`.

| code                             |  count |
|----------------------------------|--------|
| linking-error                    |  1,520 |
| duplicate-loop-index             |    457 |
| unqualified-group-reference      |    406 |
| redeclaration-not-specialization |     35 |
| declaration-name-case            |     11 |

## unqualified-group-reference: verified site by site

ISO 10303-11:2004 12.7.4, Rules and restrictions: a group reference that is
not further qualified with an attribute reference shall be an operand of `=`
or `||`; one followed by another group reference or by an index is reported
too (12.7.4 first paragraph, 12.6.1). Checked 2026-11-05 against an
independent token scan of every `\e` not followed by `.` outside comments and
string literals: every reported site is a scan candidate, and every candidate
not reported is an operand of `||` (13 of 43 in the default workspace, 1,063
of 1,469 in the long forms; no candidate in the corpus is an operand of `=`).
Each reported site breaks the rule:

- default workspace, 30 sites in 11 files: 19 actual parameters
  (`TYPEOF(SELF\e) <> TYPEOF(SELF)` in nine ARM domain rules,
  `TYPEOF(...used_representation\shape_representation)` in two IF conditions,
  `using_product_definition_of_shape_aspect(...\shape_aspect)`,
  `dimension_of(...\geometric_representation_item)`,
  `using_shape_aspect_of_shape_representation(...\shape_representation)`),
  2 whole DERIVE expressions (`modules/assembly_feature_definition/mim.exp`
  lines 51 and 54, the shape of EXPRESSsuite issue 102), 1 `RETURN`
  (`assembly_feature_relationship_schema` line 368), 2 operands of `+`
  (lines 244 and 275 of the same file), and 6 group references followed by
  another group reference (`SELF\physical_quantity_symmetry_by_library_reference\externally_defined_item.source`,
  `SELF\tensor_order_and_symmetry_by_library_reference\externally_defined_item.source`,
  `coca\circle\conic.position` in `procedural_sketch_schema` lines 539 and 541);
- long forms, 406 sites in 55 files from 34 distinct lines: the same
  `TYPEOF(SELF\e)` domain rules, `is_int_expr(SELF\numeric_expression)` (in
  long forms only), and the two `externally_defined_item` chains (the 12
  sites followed by a group reference).

## Known classes that are not defects in the schemas

- `linking-error` "The attribute '…' could not be found" (also "The entity
  '…' could not be found" and "A reference could not be resolved"): an
  attribute or group reference the linker cannot bind. The largest class in
  both baselines (2,997 of the default-settings sites, 1,470 of them
  in `resources/automotive_design/automotive_design.exp` and
  `domain_models/managed_model_based_3d_engineering_domain/DomainModel.exp`;
  1,520 in the long forms). Not classified
  site by site. The sampled long-form sites (AP203 ARM and MIM long forms,
  2026-10-30) are valid EXPRESS whose operand is a QUERY variable over a
  nested QUERY, a function result or an attribute path, which the linker
  does not type (`msb\manifold_solid_brep.outer`,
  `csh\oriented_closed_shell.orientation`,
  `mi\mapped_item.mapping_source.mapped_representation`, `temp.role` over
  `bag_to_set(USEDIN(...))`). References that differ from their declaration
  only in letter case bind since the case rule (attribute, type and function
  names everywhere; every name in a long form), which removed 78 short-form
  and 27,296 long-form sites; the references that then resolve are checked
  like any other, which is where the long forms' additional
  `redeclaration-not-specialization` sites come from (not classified).
- `ambiguous-attribute-reference` (ruling 2026-11-21): reported when two or
  more entities among the operand's type and its supertypes, at any depth,
  declare the name (ISO 10303-11:2004 9.2.3.3 b, 12.7.3); declarations in
  subtypes are never reported, since further subtypes can always be added.
  No SMRL v8 site meets it. The rule it replaces (two declarations at the
  nearest depth, subtypes included) gave 4 short-form and 78 long-form
  warnings, every one from subtypes, for example `curve.basis_surface`,
  `group_assignment.items` and `Join_relationship.network_topology`. An attribute that an entity inherits
  and names without `SELF` binds since issue 132 (ISO 10303-11:2004
  9.2.3.3), which removed 377 short-form and 5,447 long-form sites and
  added none; among them the two of
  `resources/product_structure_schema/product_structure_schema.exp` (a
  UNIQUE rule naming an inherited attribute and an INVERSE attribute
  declared in a supertype).
  One reference changed its target: in `set_theory_schema`, entity
  `proper_subset`, `subset` in `identical_sets(superset, subset)` is now
  the inherited attribute `subset`, no longer the entity of that name.
- `(none)`, "Attribute name should start with a lower case.": a diagnostic
  without a code yet.
- `extension-missing-generic-entity` (ruling 2026-11-21 on 8.4.2): an
  EXTENSIBLE SELECT BASED_ON a select declared GENERIC_ENTITY that is not
  GENERIC_ENTITY itself; an extension that is not EXTENSIBLE need not be.
  30 sites, 14 in arm.exp files and 16 in mim.exp files, 22 of them in
  `modules/catalog_data_information`. Example:
  `modules/product_group/arm.exp:37`, `product_group_property_assignment_select
  = EXTENSIBLE SELECT BASED_ON property_assignment_select`. The long forms have
  none.
- `reference-statement-missing` is raised where a reference binds to a
  declaration outside the schema's interface closure. A name the closure
  holds binds there first; a name outside it binds to the first declaration
  of the referencing document's domain in document-URI order, so the sites
  are the same on every file system.
- Domains (`src/language/express-p11-domains.ts`): a name resolves only among
  the documents of the referencing document's domain. In this workspace the
  arm.exp files are one domain and every other loaded file (mim.exp, the
  resource schemas) another. Before the split, 40 references in 26 files
  (39 in arm.exp files, 1 in a mim.exp file) whose entity name differs in
  case from the declaration in their own domain bound to an exact-case
  entity of the other domain (an ARM reference to a MIM or resource entity,
  a MIM reference to an ARM entity) and were reported
  `reference-statement-missing`, which proposed interfacing a schema of the
  other domain. They now get what any reference spelled with another case
  gets inside its domain: the linking error, and `reference-name-case` where
  that check applies (39; the one in
  `modules/layered_interconnect_module_design/mim.exp:38` is a
  SUBTYPE_CONSTRAINT `FOR` reference, which that check does not cover).
  Example: `modules/analytical_model/arm.exp:100` writes
  `analytical_model_port`; the ARM declares `Analytical_model_port`, and the
  reference used to bind to `analytical_model_port` of
  `modules/analytical_model/mim.exp`.
