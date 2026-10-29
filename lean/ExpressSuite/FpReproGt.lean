/-
  Vendored from a private Lean workstream, commit 5846f3b64342acbfb13e1826c9f6c92d275021ad (lean/FpReproGt.lean), 2026-10-29,
  unchanged except for the module-qualified imports below.
-/
/-
  FpReproGt.lean — two additional real-world redeclaration sites, found
  2026-08-20 in the wg12-step geometric_tolerance ARM concatenated closure
  (68 schemata, remarks stripped by the verified express-remark-stripper),
  that a relation resolving only the NEW operand rejects.

  Both sites evaluate TRUE under the relation in Specialisation.lean (whose
  soundness vs eengine type-p semantics is proved in Soundness.lean), so both
  redeclarations are valid:

  - Site 1 exercises an EMPTY EXTENSIBLE SELECT as the NEW operand
    (vacuous ∀ over members — no values in this closure, hence trivially
    sound). New configuration relative to the AP242 case in Specialisation.lean.
  - Site 2 is a textbook instance of the asymmetry: SELECT
    ORIGINAL never decomposed, valid narrowing to a member's subtype
    rejected.

  Build (per README):
    lean -o Specialisation.olean Specialisation.lean
    LEAN_PATH=$PWD lean FpReproGt.lean     # exit 0 = all guards pass
-/

import ExpressSuite.Specialisation

/- ── Site 1 ──
   dimension_tolerance/arm.exp:159 (original) and :61 (new type):
   ENTITY Edge_of_undefined_shape_size redeclares
     SELF\Dimensional_size.is_applied_to : edge_of_undefined_shape_size_element
   original type: ENTITY Shape_element
   new type:      TYPE edge_of_undefined_shape_size_element =
                    EXTENSIBLE GENERIC_ENTITY SELECT;   (empty in closure) -/

def shape_element : Ty := .ent "Shape_element" []
def edge_sel : Ty :=
  .defn "edge_of_undefined_shape_size_element"
    (.sel "edge_of_undefined_shape_size_element" [])

-- The proved relation accepts.
#eval spec edge_sel shape_element
#guard spec edge_sel shape_element == true

/- ── Site 2 ──
   geometric_tolerance/arm.exp:300 (original attribute), :108 (select),
   shape_composition/arm.exp:10 (new type):
   ENTITY Group_geometric_tolerance_with_datum_system_reference redeclares
     SELF\Geometric_tolerance.applied_to : Composite_group_shape_element
   original type: TYPE geometric_tolerance_target = EXTENSIBLE
     GENERIC_ENTITY SELECT (Composite_shape_element, Derived_shape_element,
     Dimensional_location, Dimensional_size, Part_shape_element,
     Part_view_definition);
   new type: ENTITY Composite_group_shape_element
               SUBTYPE OF (Composite_shape_element); -/

def cse : Ty := .ent "Composite_shape_element" ["Shape_element"]
def gtt : Ty :=
  .defn "geometric_tolerance_target"
    (.sel "geometric_tolerance_target"
      [cse,
       .ent "Derived_shape_element" [],
       .ent "Dimensional_location" [],
       .ent "Dimensional_size" [],
       .ent "Part_shape_element" [],
       .ent "Part_view_definition" []])
def cgse : Ty :=
  .ent "Composite_group_shape_element" ["Composite_shape_element", "Shape_element"]

-- The proved relation accepts via the SELECT-original ∃-member path.
#eval spec cgse gtt
#guard spec cgse gtt == true

/- ── Negative control: an unrelated entity must NOT specialise the select ── -/
#guard spec (.ent "Datum_system" []) gtt == false
