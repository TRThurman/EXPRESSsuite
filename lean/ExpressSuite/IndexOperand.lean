/-
  IndexOperand.lean — the operand of an index qualifier.

  ISO 10303-11:2004 defines three indexing operators: aggregate indexing
  (12.6.1, "the aggregate value being indexed"), string indexing (12.5.1,
  "the string value being indexed") and binary indexing (12.3.1, "the binary
  value being indexed"). A static checker may reject an index qualifier only
  when the DECLARED type of the operand admits none of these values.
  `notIndexable` is that predicate over the `Ty` domain of Specialisation.lean;
  `notIndexable_sound` proves it against the value semantics of Soundness.lean:
  if `notIndexable t` then no value of type `t` is an aggregate, string or
  binary value, so none of the three operators applies.

  The EXPRESSsuite diagnostic `index-on-non-aggregate` fires exactly when
  `notIndexable` holds for the operand's declared type (and, as an open-world
  guard outside this model, when no EXTENSIBLE select is involved). The mirror
  is `notIndexable` in src/language/type-system/express-type-model.ts.

  Motivating case: a wg12-step intermediate form of `datum_target` in which
  `the_datum : datum` is followed by `the_datum[1]` (EXPRESSsuite 0.4.2
  reported nothing).
-/
import ExpressSuite.Specialisation
import ExpressSuite.Soundness

/-- The simple types whose values may be indexed: STRING (12.5.1) and BINARY (12.3.1). -/
def indexableSimple : Simple → Bool
  | .str    => true
  | .binary => true
  | _       => false

/-- `true` when no value of `t` can be indexed. GENERIC and aggregates may hold
aggregate values, STRING and BINARY are indexable, a defined type sees through
to its underlying type, and a SELECT is not indexable iff none of its members is. -/
def notIndexable : Ty → Bool
  | .simp s      => !indexableSimple s
  | .gen         => false
  | .ent _ _     => true
  | .defn _ u    => notIndexable u
  | .sel _ ms    => notIndexableAll ms
  | .agg _ _ _ _ => false
termination_by t => sizeOf t
decreasing_by all_goals (simp_wf; omega)

where notIndexableAll : List Ty → Bool
  | []      => true
  | m :: t  => notIndexable m && notIndexableAll t
  termination_by ms => sizeOf ms
  decreasing_by all_goals (simp_wf; omega)

/-- A value that one of the three indexing operators accepts, in the `Val`
model of Soundness.lean. -/
def Indexable : Val → Prop
  | .vaggr _ _ _ => True
  | .vsimp s     => indexableSimple s = true
  | _            => False

theorem notIndexableAll_true {ms : List Ty} (h : notIndexable.notIndexableAll ms = true) :
    ∀ m ∈ ms, notIndexable m = true := by
  induction ms with
  | nil => intro m hm; cases hm
  | cons a t ih =>
    intro m hm
    simp only [notIndexable.notIndexableAll, Bool.and_eq_true] at h
    cases hm with
    | head => exact h.1
    | tail _ hm' => exact ih h.2 m hm'

/-- Under the 9.2.7 order on simple types, an indexable simple type is only
ever a specialization of itself. -/
theorem indexableSimple_of_simpLe {a b : Simple} (h : simpLe a b = true) (ha : indexableSimple a = true) :
    indexableSimple b = true := by
  cases a <;> cases b <;> simp_all [simpLe, indexableSimple]

/-- SOUNDNESS: if `notIndexable t` then no value of type `t` can be indexed. -/
theorem notIndexable_sound : ∀ (t : Ty) (v : Val), notIndexable t = true → TypeP v t → ¬ Indexable v
  | .simp s, v, h, hv => by
      simp only [notIndexable, Bool.not_eq_true'] at h
      cases v with
      | vsimp s' =>
          simp only [TypeP] at hv
          simp only [Indexable]
          intro hs'
          have := indexableSimple_of_simpLe hv hs'
          rw [this] at h
          exact Bool.noConfusion h
      | vent _ => simp [TypeP] at hv
      | vaggr _ _ _ => simp [TypeP] at hv
  | .gen, _, h, _ => by simp [notIndexable] at h
  | .ent n ns, v, _, hv => by
      cases v with
      | vsimp _ => simp [TypeP] at hv
      | vent _ => simp [Indexable]
      | vaggr _ _ _ => simp [TypeP] at hv
  | .defn _ u, v, h, hv => by
      simp only [notIndexable] at h
      simp only [TypeP] at hv
      exact notIndexable_sound u v h hv
  | .sel _ ms, v, h, hv => by
      simp only [notIndexable] at h
      simp only [TypeP] at hv
      rw [TypePAny_iff] at hv
      obtain ⟨m, hm, hvm⟩ := hv
      exact notIndexable_sound m v (notIndexableAll_true h m hm) hvm
  | .agg _ _ _ _, _, h, _ => by simp [notIndexable] at h
termination_by t _ _ _ => sizeOf t
decreasing_by all_goals (simp_wf; first | omega | (have := List.sizeOf_lt_of_mem hm; omega))

/- ── Build-checked facts ── -/

def datum : Ty := .ent "datum" ["shape_aspect"]
def shape_aspect_relationship : Ty := .ent "shape_aspect_relationship" []

-- 3129 intermediate form: `the_datum : datum` then `the_datum[1]` — reported
#guard notIndexable datum == true
-- 3129 committed form: `the_datum : SET OF datum` then `the_datum[1]` — legal
#guard notIndexable (.agg .set 0 none datum) == false
-- a defined type over an aggregate is indexable
#guard notIndexable (.defn "list_of_datum" (.agg .list 1 none datum)) == false
-- strings and binaries are indexable (12.5.1, 12.3.1); INTEGER and REAL are not
#guard notIndexable (.simp .str) == false
#guard notIndexable (.defn "label" (.simp .str)) == false
#guard notIndexable (.simp .binary) == false
#guard notIndexable (.simp .int) == true
#guard notIndexable (.simp .real) == true
-- a select mixing an entity and an aggregate may hold an aggregate: not reported
#guard notIndexable (.sel "mixed" [datum, .agg .set 0 none datum]) == false
-- a select of entities only: reported
#guard notIndexable (.sel "entities" [datum, shape_aspect_relationship]) == true
-- GENERIC: unknown, not reported
#guard notIndexable .gen == false

#print axioms notIndexable_sound
