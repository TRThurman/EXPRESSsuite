/-
  Cases.lean — the five attribute redeclarations behind wg12-step PRs #233,
  #234, #235, #236 and #237,
  encoded in the `Ty` domain of Specialisation.lean from the PUBLISHED SMRLv8
  text (~/Downloads/smrlv8_models), and decided by the proved relation `spec`.

  Reading of ISO 10303-11:2004 used throughout (the denotational one, see
  Soundness.lean): `new` is a valid redeclaration type for `orig` when every
  value of `new` is a value of `orig`. 9.2.3.4 a) sends to 9.2.7; 9.2.3.4 c)
  presupposes that a defined type on the ORIGINAL side is seen through, and
  9.2.7 lists "a defined data type is a specialization of the underlying data
  type" and "a select of a, b, c is a specialization of a select of d, e, f if
  a, b, c are specializations of d, e, f".

  Each `#guard` is a build-checked fact. A relation that resolves only the
  NEW operand rejects every positive case below; the proved relation accepts
  each of them and rejects the two negative controls.
-/
import ExpressSuite.Specialisation

namespace Cases

/- ── Shared: representation_schema (ISO 10303-43) ── -/
def representation_item : Ty := .ent "representation_item" []
def geometric_representation_item : Ty :=
  .ent "geometric_representation_item" ["representation_item"]
def list_representation_item : Ty :=
  .defn "list_representation_item" (.agg .list 1 none representation_item)
def set_representation_item : Ty :=
  .defn "set_representation_item" (.agg .set 1 none representation_item)
/-- `compound_representation_item.item_element : compound_item_definition` -/
def compound_item_definition : Ty :=
  .defn "compound_item_definition"
    (.sel "compound_item_definition" [list_representation_item, set_representation_item])

/- ── PR #233: ply_orientation_specification/mim.exp ──
   ENTITY point_and_vector SUBTYPE OF (compound_representation_item, geometric_representation_item);
     SELF\compound_representation_item.item_element : point_and_vector_members;
   TYPE point_and_vector_member  = SELECT (point, direction);
   TYPE point_and_vector_members = LIST [2:3] OF point_and_vector_member;
   ENTITY point_array ... item_element : point_array_members;
   TYPE point_array_members = LIST [1:?] OF point_and_vector; -/
def point : Ty := .ent "point" ["geometric_representation_item", "representation_item"]
def direction : Ty := .ent "direction" ["geometric_representation_item", "representation_item"]
def point_and_vector_member : Ty :=
  .defn "point_and_vector_member" (.sel "point_and_vector_member" [point, direction])
def point_and_vector_members : Ty :=
  .defn "point_and_vector_members" (.agg .list 2 (some 3) point_and_vector_member)
def point_and_vector : Ty :=
  .ent "point_and_vector"
    ["compound_representation_item", "geometric_representation_item", "representation_item"]
def point_array_members : Ty :=
  .defn "point_array_members" (.agg .list 1 none point_and_vector)

#guard spec point_and_vector_members compound_item_definition == true
#guard spec point_array_members compound_item_definition == true

/- ── PR #234: change_management/mim.exp ──
   ENTITY location_in_aggregate_representation_item SUBTYPE OF (compound_representation_item);
     SELF\compound_representation_item.item_element : location_in_aggregate_item;
   TYPE location_in_aggregate_item = LIST [1:?] OF integer_representation_item;
   ENTITY integer_representation_item SUBTYPE OF (representation_item, int_literal); -/
def integer_representation_item : Ty :=
  .ent "integer_representation_item"
    ["representation_item", "int_literal", "literal_number", "simple_numeric_expression",
     "generic_literal"]
def location_in_aggregate_item : Ty :=
  .defn "location_in_aggregate_item" (.agg .list 1 none integer_representation_item)

#guard spec location_in_aggregate_item compound_item_definition == true

/- ── PR #235: ap242 mim.exp ──
   ENTITY point_path ... SELF\compound_representation_item.item_element : point_path_members;
   TYPE point_path_members = LIST [1:?] OF point_and_vector; -/
def point_path_members : Ty :=
  .defn "point_path_members" (.agg .list 1 none point_and_vector)

#guard spec point_path_members compound_item_definition == true

/- ── PR #236: constructive_solid_geometry_2d/mim.exp ──
   ENTITY primitive_2d_with_inner_boundary SUBTYPE OF (complex_area, compound_representation_item);
     SELF\compound_representation_item.item_element RENAMED inner_boundary : compound_inner_area_boundary;
   TYPE compound_inner_area_boundary = SELECT (set_inner_area_boundary);
   TYPE set_inner_area_boundary = SET [1:?] OF bounded_primitive_2d;
   TYPE bounded_primitive_2d = EXTENSIBLE GENERIC_ENTITY SELECT (area_with_outer_boundary,
     circular_area, elliptic_area, polygonal_area, rectangular_area);   -- geometric_model_schema
   TYPE csg2d_bounded_primitive_2d = SELECT BASED_ON bounded_primitive_2d WITH (path_area_with_parameters);
   every member is a primitive_2d, hence a geometric_representation_item. -/
def primitive_2d_supers : List String :=
  ["primitive_2d", "geometric_representation_item", "representation_item"]
def circular_area : Ty := .ent "circular_area" primitive_2d_supers
def elliptic_area : Ty := .ent "elliptic_area" primitive_2d_supers
def rectangular_area : Ty := .ent "rectangular_area" primitive_2d_supers
def polygonal_area : Ty := .ent "polygonal_area" primitive_2d_supers
def area_with_outer_boundary : Ty :=
  .ent "area_with_outer_boundary" ("half_space_2d" :: primitive_2d_supers)
def path_area_with_parameters : Ty :=
  .ent "path_area_with_parameters" ("complex_area" :: "mapped_item" :: primitive_2d_supers)
/-- the EXTENSIBLE select as folded in the AP242 closure (csg2d extension included) -/
def bounded_primitive_2d : Ty :=
  .defn "bounded_primitive_2d"
    (.sel "bounded_primitive_2d"
      [area_with_outer_boundary, circular_area, elliptic_area, polygonal_area,
       rectangular_area, path_area_with_parameters])
def set_inner_area_boundary : Ty :=
  .defn "set_inner_area_boundary" (.agg .set 1 none bounded_primitive_2d)
def compound_inner_area_boundary : Ty :=
  .defn "compound_inner_area_boundary"
    (.sel "compound_inner_area_boundary" [set_inner_area_boundary])

#guard spec compound_inner_area_boundary compound_item_definition == true

/- ── PR #237: product_structure_schema.exp (ISO 10303-44) ──
   ENTITY product_definition_occurrence ... definition : OPTIONAL product_definition_or_reference_or_occurrence;
   ENTITY product_definition_specified_occurrence SUBTYPE OF (product_definition_occurrence);
     SELF\product_definition_occurrence.definition : product_definition_occurrence_or_reference;
   TYPE product_definition_or_reference = EXTENSIBLE GENERIC_ENTITY SELECT (product_definition,
     generic_product_definition_reference);                                   -- ISO 10303-41
   TYPE product_definition_or_reference_or_occurrence = SELECT BASED_ON product_definition_or_reference
     WITH (product_definition_occurrence);     -- folded by --shtolo to an alias of the extended select
   TYPE product_definition_occurrence_or_reference = SELECT (product_definition_occurrence,
     product_definition_occurrence_reference);
   ENTITY product_definition_occurrence_reference SUBTYPE OF (product_definition_reference);
   ENTITY product_definition_reference SUBTYPE OF (generic_product_definition_reference); -/
def product_definition : Ty := .ent "product_definition" []
def generic_product_definition_reference : Ty := .ent "generic_product_definition_reference" []
def product_definition_occurrence : Ty := .ent "product_definition_occurrence" []
def product_definition_occurrence_reference : Ty :=
  .ent "product_definition_occurrence_reference"
    ["product_definition_reference", "generic_product_definition_reference"]
def product_definition_or_reference : Ty :=
  .defn "product_definition_or_reference"
    (.sel "product_definition_or_reference"
      [generic_product_definition_reference, product_definition, product_definition_occurrence])
def product_definition_or_reference_or_occurrence : Ty :=
  .defn "product_definition_or_reference_or_occurrence" product_definition_or_reference
def product_definition_occurrence_or_reference : Ty :=
  .defn "product_definition_occurrence_or_reference"
    (.sel "product_definition_occurrence_or_reference"
      [product_definition_occurrence, product_definition_occurrence_reference])

#guard spec product_definition_occurrence_or_reference
             product_definition_or_reference_or_occurrence == true

/- ── Negative controls (repro/negative/redeclaration_invalid.exp) ──
   The proved relation rejects both. -/
def real_list : Ty := .defn "real_list" (.agg .list 1 none (.simp .real))
#guard spec real_list compound_item_definition == false
#guard spec (.agg .list 0 none representation_item) compound_item_definition == false

/- ── What the open PRs replace the redeclarations with ──
   A WHERE rule cannot be expressed in `Ty`; the type-level narrowing is simply
   dropped. The broadened attribute type is the original itself, which is
   trivially accepted: -/
#guard spec compound_item_definition compound_item_definition == true

/- ── ISO 10303-11:2004 9.2.3.4 EXAMPLE 3 (the standard's own redeclarations) ──
   things : LIST [3:?] OF thing  -> LIST [3:?] OF UNIQUE thing   (UNIQUE not modelled: accepted as the same type)
   items  : BAG [0:?] OF widget  -> SET [1:5] OF widget          (SET specializes BAG, bounds within)
   may_be : OPTIONAL stuff       -> stuff                        (optionality is not a type property here) -/
def thing : Ty := .ent "thing" []
def widget : Ty := .ent "widget" []
#guard spec (.agg .list 3 none thing) (.agg .list 3 none thing) == true
#guard spec (.agg .set 1 (some 5) widget) (.agg .bag 0 none widget) == true
#guard spec (.agg .bag 1 (some 5) widget) (.agg .set 0 none widget) == false   -- a BAG does not specialize a SET
#guard spec (.agg .set 0 none widget) (.agg .list 0 none widget) == false       -- nor a LIST

/- ── ISO 10303-11:2004 9.2.3.4 EXAMPLE 2 and the 9.2.7 simple-type order ── -/
#guard spec (.simp .int) (.simp .number) == true      -- EXAMPLE 2: NUMBER -> INTEGER
#guard spec (.simp .real) (.simp .number) == true
#guard spec (.simp .int) (.simp .real) == true
#guard spec (.simp .bool) (.simp .logical) == true
#guard spec (.simp .number) (.simp .int) == false
#guard spec (.simp .logical) (.simp .bool) == false
#guard spec (.simp .str) (.simp .number) == false

end Cases
