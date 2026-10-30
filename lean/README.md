# Lean 4 proofs behind EXPRESSsuite's type checks

Machine-checked ground truth for the attribute-reference scope and for three
SC4 validation diagnostics:

- attribute and group reference scope — ISO 10303-11:2004 12.7.3 (`x.a`: the
  entity, a supertype or a subtype; after `x\E`: E's own declaration; two
  declarations at the nearest depth: ambiguous, `ambiguous-attribute-reference`)
  and 12.7.4 (`x\E`: any entity in the same subtype/supertype graph).
  Definitions: `visible`, `component`, `resolve`, `resolveAfterGroup`
  (Inheritance.lean); the TypeScript walk is `ExpressP11Entity.getVisibleLevels`.

- `redeclaration-not-specialization` — ISO 10303-11:2004 9.2.3.4 a) with 9.2.7:
  the type of a redeclared attribute shall be the same as, or a specialization
  of, the original attribute's type. Relation: `spec` (Specialisation.lean).
- `index-on-non-aggregate` — ISO 10303-11:2004 12.6.1: the operand of an index
  qualifier shall be an aggregate value. Predicate: `neverAgg` (IndexOperand.lean).

`src/language/type-system/express-type-model.ts` is a clause-by-clause
transcription of these definitions and must be kept in lock-step with them.

## Build

```bash
export PATH="$HOME/.elan/bin:$PATH"   # toolchain pinned in lean-toolchain
lake build                            # exit 0 = every proof and every #guard passes
```

Pure Lean 4 core, no Mathlib. `#guard` lines are build-checked facts: a
failing guard fails the build.

## Files

| File | Content | Status |
|------|---------|--------|
| `ExpressSuite/Specialisation.lean` | `Ty` type domain; `simpLe`, `aggLe`, `boundsOk`; `spec`/`specAll`/`specAny` (NEW operand resolved first, then ORIGINAL) | definitions, termination by construction |
| `ExpressSuite/Meta.lean` | `spec_refl`, `spec_top`, `spec_trans` (modulo `EntTrans`, the transitive closure of entity supertype lists) | proved, no `sorry` |
| `ExpressSuite/Soundness.lean` | `TypeP` value membership (eengine `kernel/type-p.lisp` transcription); `spec_sound`: if `spec new orig` then every value of `new` is a value of `orig` | proved, no `sorry` |
| `ExpressSuite/IndexOperand.lean` | `neverAgg`; `neverAgg_sound`: if `neverAgg t` then no value of `t` is an aggregate value | proved, no `sorry` |
| `ExpressSuite/Cases.lean` | the five wg12-step redeclarations (PRs #233 to #237) encoded from the published SMRLv8 text, the negative controls, and the standard's 9.2.3.4 EXAMPLE 2 and EXAMPLE 3 | `#guard`, build-checked |
| `ExpressSuite/FpReproGt.lean` | two further valid narrowings (geometric_tolerance ARM) that a relation resolving only the NEW operand rejects | `#guard`, build-checked |
| `ExpressSuite/Interfaces.lean` | schema scopes (10.1 b, clause 11): `Export` (USE re-export), `Visible`, `Clash`; `step`/`iterate` (the implementation's loop), `visibleIn`, `clashesIn`; `iterate_sound`, `export_complete`, `export_of_stable` (the stop condition is exact), `export_ignores_reference` (11.3), `mem_visibleIn_iff`, `clash_iff` | proved, no `sorry`; the 3074 shape, 11.3 EXAMPLE 2, lists, renames, cycles and the case rules `#guard` |
| `ExpressSuite/Inheritance.lean` | finite inheritance graph; `Visible` (12.7.3) and `SameGraph` (12.7.4) as reachability; `visible` (ancestors then descendants, breadth-first, duplicate-free) and `component`; `mem_visible_iff`, `component_is_group_scope`, `visible_sub_component`, `visible_mono`, `resolve_unique`, `resolve_ambiguous`, `resolveAfterGroup_unique`, `visible_head`; termination of the fuelled closure by a pigeonhole lemma | proved, no `sorry`; b_spline, 9.2.3.3 and 12.7.3 examples `#guard` |

Axioms (`#print axioms`): `propext`, `Classical.choice`, `Quot.sound` only.

## Provenance and amendments

`Specialisation.lean`, `Meta.lean`, `Soundness.lean` and `FpReproGt.lean` are
vendored from a private Lean workstream (commit 5846f3b), where the relation
was written to decide redeclaration compatibility with both operands resolved.
Two amendments were made here on 2026-10-29, each found by
testing the check against the standard's own examples:

1. `aggLe`: "SET OF item is a specialization of BAG OF item" (9.2.7). The
   original required equal aggregate kinds and rejected 9.2.3.4 EXAMPLE 3.
2. `simpLe`: "integer and real are both specializations of number; integer is a
   specialization of real; boolean is a specialization of logical" (9.2.7).
   The original compared simple types by equality and rejected 9.2.3.4 EXAMPLE 2.

Both amendments change `TypeP` accordingly and re-prove `spec_refl`,
`spec_trans` and `spec_sound`.

## What the model leaves out (by design, all in the permissive direction)

UNIQUE and OPTIONAL on aggregates, string/binary widths and real precision,
enumerations, GENERIC_ENTITY and AGGREGATE. The TypeScript builder maps these
to "unknown" and the validator reports nothing for them, so no diagnostic
rests on a construct outside the proofs.

## Reading of the standard

`spec` is denotational: `new` specializes `orig` when every value of `new` is
a value of `orig` (that is what `spec_sound` states). Defined types are seen
through on BOTH sides. 9.2.7 lists "a defined data type is a specialization of
the underlying data type" for the NEW side; 9.2.3.4 c) presupposes seeing
through a defined type on the ORIGINAL side. A relation that resolves only the
NEW side rejects the valid narrowings in `Cases.lean`.
