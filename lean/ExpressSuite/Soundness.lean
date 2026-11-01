/-
  Vendored from a private Lean workstream, commit 5846f3b64342acbfb13e1826c9f6c92d275021ad (lean/Soundness.lean), 2026-10-29,
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
  Soundness.lean — denotational soundness of `spec` against eengine's value
  membership semantics.

  eengine kernel/type-p.lisp defines EXPRESS value membership `type-p value type`:
    • (p11:type)   → recurse into the underlying type      (defined types transparent)
    • (p11:select) → ∃ member type the value inhabits        (SELECT is a union)
    • entity inst  → the entity is in the instance's %%inheritance! closure
    • default      → false
  `TypeP` below is a faithful Lean transcription (for well-formed instances,
  whose inheritance closure includes the type's declared supertypes).

  Main theorem `spec_sound`: if `spec new orig` holds then every value of type
  `new` is a value of type `orig` — i.e. `spec` never wrongly accepts a
  redeclaration.  Entities use the same `EntTrans` well-formedness invariant as
  transitivity.
-/
import ExpressSuite.Specialisation
import ExpressSuite.Meta

/-- A minimal EXPRESS value model. -/
inductive Val where
  | vsimp (s : Simple)                                -- a value of a simple type
  | vent  (inh : List String)                         -- entity instance; inh = inheritance closure
  | vaggr (k : AggK) (len : Nat) (elems : List Val)   -- aggregate value: kind, length, elements

mutual
/-- Value membership, transcribing `type-p.lisp`. -/
def TypeP : Val → Ty → Prop
  | _,               .gen          => True
  | .vsimp s,        .simp t       => simpLe s t = true
  | .vent inh,       .ent n nsup   => n ∈ inh ∧ ∀ s ∈ nsup, s ∈ inh
  | .vaggr k len es, .agg k' lo hi e =>
        aggLe k k' = true ∧ lo ≤ len ∧ (∀ h, hi = some h → len ≤ h) ∧ (∀ x ∈ es, TypeP x e)
  | v,               .defn _ u     => TypeP v u            -- transparent
  | v,               .sel _ ms     => TypePAny v ms        -- union
  | _, _ => False
  termination_by _ t => sizeOf t
  decreasing_by all_goals (simp_wf; omega)

def TypePAny : Val → List Ty → Prop
  | _, []     => False
  | v, m :: t => TypeP v m ∨ TypePAny v t
  termination_by _ ms => sizeOf ms
  decreasing_by all_goals (simp_wf; omega)
end

theorem TypePAny_iff (v : Val) : ∀ ms, TypePAny v ms ↔ ∃ m ∈ ms, TypeP v m
  | [] => by simp [TypePAny]
  | a :: t => by rw [TypePAny, TypePAny_iff v t]; simp

/-- Bound-specialisation is sound for membership. -/
theorem boundsOk_sound {la lb len : Nat} {ha hb : Option Nat} :
    boundsOk la ha lb hb = true → la ≤ len → (∀ h, ha = some h → len ≤ h) →
    lb ≤ len ∧ (∀ h, hb = some h → len ≤ h) := by
  intro hbo hla hha
  cases ha <;> cases hb <;> simp_all [boundsOk, Nat.ble_eq] <;> omega

/-- SOUNDNESS: if `spec new orig` then every value of type `new` is of type `orig`. -/
theorem spec_sound (hE : EntTrans) : ∀ (new orig : Ty),
    spec new orig = true → ∀ v, TypeP v new → TypeP v orig
  -- resolve the LEFT operand
  | .defn _ w, orig, h, v, hv => by
      simp only [spec] at h; simp only [TypeP] at hv; exact spec_sound hE w orig h v hv
  | .sel _ ms, orig, h, v, hv => by
      simp only [spec] at h; rw [specAll_true] at h
      simp only [TypeP] at hv; rw [TypePAny_iff] at hv
      obtain ⟨m, hm, hvm⟩ := hv
      exact spec_sound hE m orig (h m hm) v hvm
  -- new concrete; resolve the RIGHT operand
  | new, .defn _ u, h, v, hv => by
      rw [spec_orig_defn] at h; simp only [TypeP]; exact spec_sound hE new u h v hv
  | new, .gen, _, v, _ => by simp only [TypeP]
  -- new concrete, orig a SELECT
  | .simp _, .sel _ ms, h, v, hv | .gen, .sel _ ms, h, v, hv
  | .ent _ _, .sel _ ms, h, v, hv | .agg _ _ _ _, .sel _ ms, h, v, hv => by
      simp only [spec] at h; rw [specAny_true] at h
      obtain ⟨m, hm, hs⟩ := h
      simp only [TypeP]; rw [TypePAny_iff]
      exact ⟨m, hm, spec_sound hE _ m hs v hv⟩
  -- base: both concrete
  | .simp a', .simp b', h, v, hv => by
      simp only [spec] at h
      cases v with
      | vsimp s => simp only [TypeP] at hv ⊢; exact simpLe_trans hv h
      | vent _ => simp only [TypeP] at hv
      | vaggr _ _ _ => simp only [TypeP] at hv
  | .ent an asup, .ent bn bsup, h, v, hv => by
      simp only [spec] at h
      cases v with
      | vent inh =>
          simp only [TypeP] at hv ⊢
          obtain ⟨ha, hs⟩ := hv
          have key : ∀ x, ((x == an) || asup.contains x) = true → x ∈ inh := by
            intro x hx
            simp only [Bool.or_eq_true, beq_iff_eq] at hx
            rcases hx with rfl | hx
            · exact ha
            · exact hs x (by simpa using hx)
          refine ⟨key bn h, ?_⟩
          intro s hsb
          have hb : ((s == bn) || bsup.contains s) = true := by
            have hc : bsup.contains s = true := by simpa using hsb
            simp only [hc, Bool.or_true]
          exact key s (hE an asup bsup bn s h hb)
      | vsimp _ => simp only [TypeP] at hv
      | vaggr _ _ _ => simp only [TypeP] at hv
  | .agg ka la ha ea, .agg kb lb hb eb, h, v, hv => by
      simp only [spec, Bool.and_eq_true] at h
      obtain ⟨⟨hk, hbd⟩, he⟩ := h
      cases v with
      | vaggr kv len es =>
          simp only [TypeP] at hv ⊢
          obtain ⟨hkv, hlo, hhi, hel⟩ := hv
          have hb2 := boundsOk_sound hbd hlo hhi
          refine ⟨aggLe_trans hkv hk, hb2.1, hb2.2, ?_⟩
          intro x hx; exact spec_sound hE ea eb he x (hel x hx)
      | vsimp _ => simp only [TypeP] at hv
      | vent _ => simp only [TypeP] at hv
  -- new = GENERIC, orig concrete non-gen/sel : spec false
  | .gen, .simp _, h, _, _ | .gen, .ent _ _, h, _, _ | .gen, .agg _ _ _ _, h, _, _ => by
      simp [spec] at h
  -- mismatched concrete kinds : spec false
  | .simp _, .ent _ _, h, _, _ | .simp _, .agg _ _ _ _, h, _, _
  | .ent _ _, .simp _, h, _, _ | .ent _ _, .agg _ _ _ _, h, _, _
  | .agg _ _ _ _, .simp _, h, _, _ | .agg _ _ _ _, .ent _ _, h, _, _ => by
      simp [spec] at h
termination_by new orig => sizeOf new + sizeOf orig
decreasing_by
  all_goals (simp_wf; first
    | omega
    | (have := List.sizeOf_lt_of_mem ‹_ ∈ _›; omega))
