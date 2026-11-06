/-
  GroupReference.lean — where a group reference may stand.

  ISO 10303-11:2004 12.7.4, Rules and restrictions: "A group reference which
  is not further qualified with an attribute reference shall appear as an
  operand of either the entity value comparison operator (=) or the complex
  entity instance constructor (||)."

  Two further sentences bear on a group reference followed by a qualifier
  other than an attribute reference:
  * 12.7.4: "The expression to the left of the group reference shall
    evaluate to a complex entity instance." A group reference yields a
    partial complex entity value (3.3.15: "This has no meaning on its own"),
    so `x\E\F` puts a partial value to the left of `\F`.
  * 12.6.1: the operand of an index qualifier is an aggregate value, which a
    partial complex entity value is not, so `x\E[i]` is out too.
  12.7.3 is what lets a partial value be consumed at all: "If the expression
  to the left of the attribute reference evaluates to a partial complex
  entity value then the attribute name ... shall occur within the entity
  declaration for that partial complex entity data type."

  Three formulations, proved equal:
  * `qualsOk`     the restriction over one qualifier list, read left to
                  right (each group reference looks at its successor);
  * `violatesAt`  the per-index loop of the EXPRESSsuite check
                  (`checkGroupReferencePlacement` in
                  src/language/express-p11-validator.ts reports exactly the
                  indices of `reported`);
  * `kindAfter`   the value semantics: a kind (`whole` or `part`) threaded
                  through the qualifiers, `none` when a qualifier is applied
                  to a value it cannot take.
  `check` lifts `qualsOk` over expressions: an operand of `=` or `||` may end
  in a partial value (`acc = true`), parentheses pass the position through
  (12.1: a parenthesised expression is an operand of the operator around
  it), and every other position — a unary operator, any other binary or
  relational operator, an actual parameter, an index, an aggregate element,
  a QUERY, an interval, an entity constructor argument, or a whole
  expression (derived attribute, domain rule, RETURN, assignment source) —
  needs a value that is not partial (`acc = false`).

  Out of the model, by design: the type of the operand and of E (scope of
  the group reference, 12.7.4 second paragraph, is Inheritance.lean); the
  qualifiers of an assignment or ALIAS target (13.3 explicitly allows a
  group-qualified target, and the check only looks at expressions); the
  kind of a `||` result (12.10 allows a partial value there; the rule above
  is about group references only, so a `||` expression is treated as whole,
  the permissive direction).

  Motivating case (EXPRESSsuite issue 102): in a DERIVE clause,
  `the_datum : datum := datum_basis_relationship[1]\shape_aspect_relationship.related_shape_aspect\datum;`
  ends in `\datum` and is no operand of `=` or `||`; EXPRESSsuite 0.5.0
  reported nothing.
-/

namespace GroupReference

/-- A qualifier (12.7, syntax 247). An index qualifier's own expressions are
operands of their own, carried by `Expr.prim`'s argument list. -/
inductive Qual where
  | attr   -- `.a`  attribute reference, 12.7.3
  | group  -- `\E`  group reference, 12.7.4
  | index  -- `[i]` or `[i:j]`, 12.6.1 (12.5.1, 12.3.1)
  deriving DecidableEq, Repr

/-- The binary and relational operators, collapsed to the two that 12.7.4
names and all the others (`<>`, `:=:`, `:<>:`, `<`, `>`, `<=`, `>=`, `IN`,
`LIKE`, `+`, `-`, `OR`, `XOR`, `*`, `/`, `DIV`, `MOD`, `AND`, `**`). -/
inductive Op where
  | eq      -- `=`  entity value comparison, 12.2.1.7
  | concat  -- `||` complex entity instance constructor, 12.10
  | other
  deriving DecidableEq, Repr

/-- `true` for the two operators whose operands may be partial values. -/
def opAccepts : Op → Bool
  | .eq     => true
  | .concat => true
  | .other  => false

/-- Expressions, abstracted to what decides the rule. -/
inductive Expr where
  /-- a qualifiable factor (attribute, variable, parameter, constant,
  function call, SELF, ...) with its qualifier list; `args` are the operands
  inside it: actual parameters and index expressions -/
  | prim  (qs : List Qual) (args : List Expr)
  /-- `( e )` -/
  | paren (e : Expr)
  /-- `+ e`, `- e`, `NOT e` -/
  | unary (e : Expr)
  | bin   (op : Op) (l r : Expr)
  /-- aggregate initializer, interval, QUERY, entity constructor: operands
  that are no operands of a binary operator -/
  | other (es : List Expr)
  deriving Repr

/- ── 1. The restriction, read along one qualifier list ── -/

/-- Every group reference is followed by an attribute reference, or is the
last qualifier and the primary is an operand of `=` or `||` (`acc`). -/
def qualsOk (acc : Bool) : List Qual → Bool
  | []            => true
  | .attr  :: qs  => qualsOk acc qs
  | .index :: qs  => qualsOk acc qs
  | .group :: qs  =>
      (match qs with
       | []          => acc
       | .attr :: _  => true
       | _ :: _      => false) && qualsOk acc qs

/- ── 2. The per-index loop of the TypeScript check ── -/

/-- The check at qualifier index `i`: a group reference followed by an
attribute reference passes, one followed by anything else is reported, and
a final one is reported unless the primary is an operand of `=` or `||`. -/
def violatesAt (acc : Bool) (qs : List Qual) (i : Nat) : Bool :=
  match qs[i]?, qs[i+1]? with
  | some .group, some .attr => false
  | some .group, some _     => true
  | some .group, none       => !acc
  | _, _                    => false

/-- The qualifier indices the check reports, in order. -/
def reported (acc : Bool) (qs : List Qual) : List Nat :=
  (List.range qs.length).filter (violatesAt acc qs)

theorem violatesAt_cons_succ (acc : Bool) (q : Qual) (qs : List Qual) (j : Nat) :
    violatesAt acc (q :: qs) (j + 1) = violatesAt acc qs j := by
  simp [violatesAt]

theorem violatesAt_cons_zero (acc : Bool) (q : Qual) (qs : List Qual) :
    violatesAt acc (q :: qs) 0 =
      !(match q, qs with
        | .group, []          => acc
        | .group, .attr :: _  => true
        | .group, _ :: _      => false
        | _, _                => true) := by
  cases q <;> cases qs with
  | nil => simp [violatesAt]
  | cons q' _ => cases q' <;> simp [violatesAt]

theorem violatesAt_out_of_range (acc : Bool) (qs : List Qual) (i : Nat) (h : qs.length ≤ i) :
    violatesAt acc qs i = false := by
  simp [violatesAt, List.getElem?_eq_none h]

/-- The left-to-right reading and the per-index loop agree. -/
theorem qualsOk_iff_forall (acc : Bool) (qs : List Qual) :
    qualsOk acc qs = true ↔ ∀ i, violatesAt acc qs i = false := by
  induction qs with
  | nil => simp [qualsOk, violatesAt]
  | cons q qs ih =>
    constructor
    · intro h i
      cases i with
      | zero =>
        rw [violatesAt_cons_zero]
        cases q <;> cases qs with
        | nil => simp_all [qualsOk]
        | cons q' _ => cases q' <;> simp_all [qualsOk]
      | succ j =>
        rw [violatesAt_cons_succ]
        have hrest : qualsOk acc qs = true := by
          cases q <;> simp_all [qualsOk]
        exact (ih.mp hrest) j
    · intro h
      have h0 := h 0
      have hs : ∀ j, violatesAt acc qs j = false := fun j => by
        have := h (j + 1); rwa [violatesAt_cons_succ] at this
      have hrest := ih.mpr hs
      rw [violatesAt_cons_zero] at h0
      cases q <;> cases qs with
      | nil => simp_all [qualsOk]
      | cons q' _ => cases q' <;> simp_all [qualsOk]

/-- The check reports nothing exactly when the restriction holds. -/
theorem reported_eq_nil_iff (acc : Bool) (qs : List Qual) :
    reported acc qs = [] ↔ qualsOk acc qs = true := by
  rw [qualsOk_iff_forall, reported, List.filter_eq_nil_iff]
  constructor
  · intro h i
    by_cases hi : i < qs.length
    · simpa using h i (List.mem_range.mpr hi)
    · exact violatesAt_out_of_range acc qs i (Nat.le_of_not_lt hi)
  · intro h i _
    simp [h i]

/-- Every reported index is a group reference: the check is anchored at the
`\E`, never at an attribute or index qualifier. -/
theorem reported_is_group (acc : Bool) (qs : List Qual) (i : Nat) (h : i ∈ reported acc qs) :
    qs[i]? = some .group := by
  simp only [reported, List.mem_filter] at h
  have hv := h.2
  unfold violatesAt at hv
  split at hv <;> simp_all

/- ── 3. The value semantics ── -/

/-- `part`: a partial complex entity value (3.3.15). `whole`: any other value. -/
inductive Kind where
  | whole
  | part
  deriving DecidableEq, Repr

/-- One qualifier applied to a value of a given kind; `none` when the value
cannot take it. An attribute reference takes both kinds (12.7.3); a group
reference needs a complex entity instance and yields a partial value
(12.7.4); an index needs an aggregate (12.6.1), which a partial value is not. -/
def step : Kind → Qual → Option Kind
  | _,      .attr  => some .whole
  | .whole, .group => some .part
  | .part,  .group => none
  | .whole, .index => some .whole
  | .part,  .index => none

/-- The kind after a qualifier list. -/
def kindAfter : Kind → List Qual → Option Kind
  | k, []      => some k
  | k, q :: qs =>
      match step k q with
      | some k' => kindAfter k' qs
      | none    => none

/-- Whether a position may take the resulting value: a whole value always,
a partial value only as an operand of `=` or `||`. -/
def okKind (acc : Bool) : Option Kind → Bool
  | some .whole => true
  | some .part  => acc
  | none        => false

/-- THE RESTRICTION IS THE SEMANTICS: the sentence of 12.7.4 Rules and
restrictions, read along a qualifier list, coincides with threading the
partial-value kind through the qualifiers (12.7.3, 12.7.4 first paragraph,
12.6.1). In particular `x\E\F.a` and `x\E[i]` fail both ways. -/
theorem qualsOk_eq_kind (acc : Bool) (qs : List Qual) :
    qualsOk acc qs = okKind acc (kindAfter .whole qs) := by
  induction qs with
  | nil => rfl
  | cons q qs ih =>
    cases q with
    | attr  => simpa [qualsOk, kindAfter, step] using ih
    | index => simpa [qualsOk, kindAfter, step] using ih
    | group =>
      cases qs with
      | nil => simp [qualsOk, kindAfter, step, okKind]
      | cons q' qs' =>
        cases q' with
        | attr  =>
          simp only [qualsOk, Bool.true_and] at ih ⊢
          simpa [kindAfter, step] using ih
        | group => simp [qualsOk, kindAfter, step, okKind]
        | index => simp [qualsOk, kindAfter, step, okKind]

/- ── 4. Expressions ── -/

mutual
/-- Every qualifier list in `e` satisfies the restriction, where `acc` says
whether `e` is an operand of `=` or `||`. This is the check: the TypeScript
computes `acc` by walking up from the primary through parentheses to the
first enclosing node. -/
def check (acc : Bool) : Expr → Bool
  | .prim qs args => qualsOk acc qs && checkAll args
  | .paren e      => check acc e
  | .unary e      => check false e
  | .bin op l r   => check (opAccepts op) l && check (opAccepts op) r
  | .other es     => checkAll es
/-- `check false` over a list of operands. -/
def checkAll : List Expr → Bool
  | []      => true
  | e :: es => check false e && checkAll es
end

mutual
/-- The value semantics over expressions. -/
def wellKinded (acc : Bool) : Expr → Bool
  | .prim qs args => okKind acc (kindAfter .whole qs) && wellKindedAll args
  | .paren e      => wellKinded acc e
  | .unary e      => wellKinded false e
  | .bin op l r   => wellKinded (opAccepts op) l && wellKinded (opAccepts op) r
  | .other es     => wellKindedAll es
def wellKindedAll : List Expr → Bool
  | []      => true
  | e :: es => wellKinded false e && wellKindedAll es
end

mutual
theorem check_eq_wellKinded (acc : Bool) : ∀ e : Expr, check acc e = wellKinded acc e
  | .prim qs args => by rw [check, wellKinded, qualsOk_eq_kind, checkAll_eq_wellKindedAll args]
  | .paren e      => by rw [check, wellKinded, check_eq_wellKinded acc e]
  | .unary e      => by rw [check, wellKinded, check_eq_wellKinded false e]
  | .bin op l r   => by
      rw [check, wellKinded, check_eq_wellKinded (opAccepts op) l, check_eq_wellKinded (opAccepts op) r]
  | .other es     => by rw [check, wellKinded, checkAll_eq_wellKindedAll es]
theorem checkAll_eq_wellKindedAll : ∀ es : List Expr, checkAll es = wellKindedAll es
  | []      => rfl
  | e :: es => by rw [checkAll, wellKindedAll, check_eq_wellKinded false e, checkAll_eq_wellKindedAll es]
end

/-- Being an operand of `=` or `||` only relaxes the restriction. -/
theorem qualsOk_mono (qs : List Qual) (h : qualsOk false qs = true) : qualsOk true qs = true := by
  rw [qualsOk_eq_kind] at h ⊢
  cases hk : kindAfter .whole qs with
  | none => simp [hk, okKind] at h
  | some k => cases k <;> simp [okKind]

/-- A qualifier list in which every group reference is directly followed by
an attribute reference. -/
def groupsAttrQualified : List Qual → Bool
  | []                   => true
  | .group :: .attr :: qs => groupsAttrQualified (.attr :: qs)
  | .group :: _          => false
  | _ :: qs              => groupsAttrQualified qs

/-- `SELF\E.a`, `x\E.a\F.b` and every other attribute-qualified group
reference pass in every position. -/
theorem qualsOk_of_groupsAttrQualified (acc : Bool) :
    ∀ qs : List Qual, groupsAttrQualified qs = true → qualsOk acc qs = true
  | []                     , _ => rfl
  | .group :: .attr :: qs  , h => by
      simp only [groupsAttrQualified] at h
      have := qualsOk_of_groupsAttrQualified acc (.attr :: qs) h
      simp only [qualsOk, Bool.true_and] at this ⊢
      exact this
  | .group :: []           , h => by simp [groupsAttrQualified] at h
  | .group :: .group :: _  , h => by simp [groupsAttrQualified] at h
  | .group :: .index :: _  , h => by simp [groupsAttrQualified] at h
  | .attr :: qs            , h => by
      simp only [groupsAttrQualified] at h
      simpa [qualsOk] using qualsOk_of_groupsAttrQualified acc qs h
  | .index :: qs           , h => by
      simp only [groupsAttrQualified] at h
      simpa [qualsOk] using qualsOk_of_groupsAttrQualified acc qs h

/- ── Build-checked facts ── -/

-- a primary with these qualifiers and no inner operands
def p (qs : List Qual) : Expr := .prim qs []

-- issue 102: `the_datum : datum := datum_basis_relationship[1]\shape_aspect_relationship.related_shape_aspect\datum;`
def issue102 : List Qual := [.index, .group, .attr, .group]
#guard check false (p issue102) == false
#guard reported false issue102 == [3]
-- the same primary as an operand of `=` passes: `... \datum = other\datum`
#guard check false (.bin .eq (p issue102) (p [.group])) == true
-- issue 102, the next line: `the_datum\datum.identification + target_id`
#guard check false (.bin .other (p [.group, .attr]) (p [])) == true

-- 12.7.4 EXAMPLE 1: `a\E1 = b\E1`
#guard check false (.bin .eq (p [.group]) (p [.group])) == true
-- 12.10: `a\E1 || E2(1,2,3)` (entity constructor as `other`)
#guard check false (.bin .concat (p [.group]) (.other [])) == true
-- nested constructors: `(a\E1 || b\E2) || c\E3`
#guard check false (.bin .concat (.paren (.bin .concat (p [.group]) (p [.group]))) (p [.group])) == true
-- parentheses pass the position through: `(a\E1) = b\E1`
#guard check false (.bin .eq (.paren (p [.group])) (p [.group])) == true
-- `<>` is not the operator 12.7.4 names
#guard check false (.bin .other (p [.group]) (p [.group])) == false
-- a unary operator: `NOT (a\E1) = b` puts `a\E1` under NOT
#guard check false (.bin .eq (.unary (.paren (p [.group]))) (p [])) == false
-- an actual parameter: `f(x.rep_1\shape_representation)`
#guard check false (.prim [] [p [.attr, .group]]) == false
-- ... even when the call is an operand of `=`: `f(x\E) = y`
#guard check false (.bin .eq (.prim [] [p [.group]]) (p [])) == false
-- an aggregate element: `[x\E]`
#guard check false (.other [p [.group]]) == false
-- an index expression: `a[x\E]`
#guard check false (.prim [.index] [p [.group]]) == false
-- chained group references: `coca\circle\conic.position` (12.7.4 first paragraph)
#guard reported false [.group, .group, .attr, .attr] == [0]
#guard reported true [.group, .group, .attr, .attr] == [0]
-- an indexed group reference: `x\E[1]` (12.6.1)
#guard reported true [.group, .index] == [0]
-- attribute-qualified group references are never reported
#guard reported false [.group, .attr, .group, .attr] == []
#guard groupsAttrQualified [.attr, .group, .attr, .index, .group, .attr] == true
#guard qualsOk false [.attr, .group, .attr, .index, .group, .attr] == true
-- the kind semantics, directly
#guard kindAfter .whole issue102 == some .part
#guard kindAfter .whole [.group, .group] == none
#guard kindAfter .whole [.group, .index] == none
#guard kindAfter .whole [.group, .attr, .index] == some .whole

end GroupReference

#print axioms GroupReference.qualsOk_eq_kind
#print axioms GroupReference.reported_eq_nil_iff
#print axioms GroupReference.check_eq_wellKinded
#print axioms GroupReference.qualsOk_of_groupsAttrQualified
