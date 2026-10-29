/-
  Vendored from a private Lean workstream, commit 5846f3b64342acbfb13e1826c9f6c92d275021ad (lean/Specialisation.lean), 2026-10-29,
  unchanged except for the module-qualified imports below.
  Amended 2026-10-29 (EXPRESSsuite): ISO 10303-11:2004 9.2.7 "SET OF item is a
  specialization of BAG OF item" — the original required equal aggregate kinds
  and rejected the standard's own 9.2.3.4 EXAMPLE 3; see `aggLe`.
  Amended 2026-10-29 (EXPRESSsuite), second item: 9.2.7 "integer and real are
  both specializations of number; integer is a specialization of real; boolean
  is a specialization of logical" — the original compared simple types by
  equality and rejected 9.2.3.4 EXAMPLE 2; see `simpLe`.
-/
/-
  Specialisation.lean — formal model of the EXPRESS attribute-redeclaration
  "specialisation_of" relation (ISO 10303-11:2004 9.2.3.4 a, 9.2.7) with
  BOTH operands resolved: a defined type is seen through and a SELECT is
  decomposed on the NEW side and on the ORIGINAL side alike. A relation that
  resolves only the NEW operand rejects valid narrowings through a defined or
  select type on the ORIGINAL side; the reproduced AP242 case below and the
  negative controls check the difference.

  Design note: the operands must be resolved
  NEW-first. "new <: orig" for a SELECT NEW means EVERY member of NEW specialises
  orig (∀), whereas a concrete NEW against a SELECT ORIG means NEW specialises
  SOME member (∃). Resolving orig-first (as a naive fix would) breaks even
  reflexivity on selects, because it composes the two quantifiers in the wrong
  order.  Cf. eengine kernel/type-p.lisp, which resolves both sides recursively.

  Pure Lean 4 core — no Mathlib. Termination is by the structural measure
  `sizeOf new + sizeOf orig`; Lean's acceptance of the definition IS the
  termination proof.
-/

/-- EXPRESS simple (base) data types. -/
inductive Simple where
  | int | real | str | bool | logical | number | binary
  deriving DecidableEq, Repr

/-- Aggregate kinds. -/
inductive AggK where
  | list | bag | set | array
  deriving DecidableEq, Repr

/--
EXPRESS type domain (resolved form).
Entities carry their transitive supertype names, so the subtype test is a
name lookup (entity graphs are DAGs; inlining names keeps `Ty` a finite tree).
-/
inductive Ty where
  | simp (s : Simple)                                   -- INTEGER, REAL, ...
  | gen                                                 -- GENERIC (wildcard)
  | ent  (name : String) (supers : List String)        -- ENTITY + transitive supertype names
  | defn (name : String) (under : Ty)                   -- TYPE name = under ;  (defined-type)
  | sel  (name : String) (members : List Ty)            -- SELECT (m1, ..., mn)
  | agg  (k : AggK) (lo : Nat) (hi : Option Nat) (elem : Ty)  -- ARRAY/BAG/LIST/SET [lo:hi] OF elem
  deriving Repr

/-- Simple-type specialization, ISO 10303-11:2004 9.2.7: "integer and real are
both specializations of number; integer is a specialization of real; boolean
is a specialization of logical". Widths and precisions are not modelled. -/
def simpLe (a b : Simple) : Bool :=
  a == b || (a == .int && (b == .real || b == .number)) || (a == .real && b == .number) ||
    (a == .bool && b == .logical)

/-- Aggregate-kind specialization, ISO 10303-11:2004 9.2.7: the same kind, or
`SET OF item` where `BAG OF item` was declared ("SET OF item is a
specialization of BAG OF item"). LIST/ARRAY UNIQUE and ARRAY OPTIONAL are
not modelled (the relation ignores them, which only ever accepts more). -/
def aggLe (kN kO : AggK) : Bool := kN == kO || (kN == .set && kO == .bag)

/-- Aggregate bound specialisation: NEW's bounds must lie within ORIG's. -/
def boundsOk (loN : Nat) (hiN : Option Nat) (loO : Nat) (hiO : Option Nat) : Bool :=
  Nat.ble loO loN &&
  (match hiO, hiN with
   | none,    _       => true            -- ORIG unbounded (`?`): any NEW upper bound is fine
   | some _,  none    => false           -- ORIG bounded but NEW unbounded: NOT a specialisation
   | some ho, some hn => Nat.ble hn ho)  -- both bounded: NEW upper ≤ ORIG upper

mutual

/--
`spec new orig = true`  iff  `new` is a valid specialisation of `orig`
(i.e. every value of type `new` is an admissible value of type `orig`).

Resolution order (the fix): resolve the NEW operand first, then the ORIG operand.
-/
def spec (new orig : Ty) : Bool :=
  match new, orig with
  -- resolve the NEW operand first
  | .defn _ u, o          => spec u o             -- transparent: unwrap NEW defined type
  | .sel _ ms, o          => specAll ms o         -- SELECT NEW <: o  iff  EVERY member <: o
  -- NEW is concrete; now resolve the ORIG operand
  | _,          .gen      => true                 -- everything specialises GENERIC
  | n,          .defn _ u => spec n u             -- transparent: unwrap ORIG defined type
  | n,          .sel _ ms => specAny n ms         -- concrete NEW <: SELECT orig  iff  <: SOME member
  -- both operands concrete
  | .simp a,    .simp b   => simpLe a b
  | .ent nN sN, .ent nO _ => (nO == nN) || sN.contains nO          -- subtype: orig is new or a supertype
  | .agg kN loN hiN eN, .agg kO loO hiO eO =>
      aggLe kN kO && boundsOk loN hiN loO hiO && spec eN eO        -- kind ≤ (9.2.7), bounds within, element <:
  | _, _ => false
  termination_by sizeOf new + sizeOf orig
  decreasing_by all_goals (simp_wf; omega)

/-- A SELECT as the NEW type specialises `orig` iff every member does. -/
def specAll (ms : List Ty) (orig : Ty) : Bool :=
  match ms with
  | []     => true
  | m :: t => spec m orig && specAll t orig
  termination_by sizeOf ms + sizeOf orig
  decreasing_by all_goals (simp_wf; omega)

/-- A concrete NEW specialises a SELECT `orig` iff it specialises some member. -/
def specAny (new : Ty) (ms : List Ty) : Bool :=
  match ms with
  | []     => false
  | m :: t => spec new m || specAny new t
  termination_by sizeOf new + sizeOf ms
  decreasing_by all_goals (simp_wf; omega)

end

/- ────────────────────────────────────────────────────────────────────────
   The reproduced AP242 case
   ──────────────────────────────────────────────────────────────────────── -/

def rep_item   : Ty := .ent "representation_item" []
def pv_member  : Ty := .ent "point_and_vector_member" ["representation_item"]
def unrelated  : Ty := .ent "unrelated" []

/-- TYPE list_representation_item = LIST [1:?] OF representation_item ; -/
def list_rep_item : Ty := .defn "list_representation_item" (.agg .list 1 none rep_item)
/-- TYPE set_representation_item  = SET  [1:?] OF representation_item ; -/
def set_rep_item  : Ty := .defn "set_representation_item"  (.agg .set  1 none rep_item)

/-- TYPE compound_item_definition = SELECT (list_representation_item, set_representation_item) ; -/
def compound_item_definition : Ty :=
  .defn "compound_item_definition" (.sel "compound_item_definition" [list_rep_item, set_rep_item])

/-- TYPE point_and_vector_members = LIST [2:3] OF point_and_vector_member ; -/
def point_and_vector_members : Ty :=
  .defn "point_and_vector_members" (.agg .list 2 (some 3) pv_member)

/- ── The AP242 case: a valid narrowing through a defined type on the ORIGINAL side ── -/

-- A relation that resolves only the NEW operand returns FALSE here. The correct answer is TRUE.
#eval spec point_and_vector_members compound_item_definition        -- expect: true
#guard spec point_and_vector_members compound_item_definition == true

/- ── Negative controls: genuine non-specialisations must stay FALSE ── -/

-- LIST OF `unrelated` (not a subtype of representation_item): matches no select member.
#eval spec (.defn "bad_elem" (.agg .list 1 none unrelated)) compound_item_definition   -- expect: false
#guard spec (.defn "bad_elem" (.agg .list 1 none unrelated)) compound_item_definition == false

-- Bound violation: ORIG bounded [1:5], NEW unbounded [1:?] — not a specialisation.
#guard spec (.agg .list 1 none rep_item) (.agg .list 1 (some 5) rep_item) == false

-- Kind mismatch: a SET is not a specialisation of a LIST.
#guard spec (.agg .set 1 none rep_item) (.agg .list 1 none rep_item) == false

/- ── Reflexivity holds on the actual domain (general theorem is the next proof) ── -/
#guard spec rep_item rep_item == true
#guard spec compound_item_definition compound_item_definition == true
#guard spec point_and_vector_members point_and_vector_members == true

/- ── GENERIC behaves correctly ── -/
#guard spec rep_item .gen == true          -- anything specialises GENERIC
#guard spec .gen rep_item == false         -- GENERIC specialises nothing concrete
