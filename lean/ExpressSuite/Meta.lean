/-
  Vendored from a private Lean workstream, commit 5846f3b64342acbfb13e1826c9f6c92d275021ad (lean/Meta.lean), 2026-10-29,
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
  Meta.lean — metatheory for the `spec` relation defined in Specialisation.lean.

  Proves:
   • spec_refl  : ∀ t, spec t t = true                    (reflexivity, unconditional)
   • spec_trans : well-formed a b c → spec a b → spec b c → spec a c   (transitivity)

  Transitivity needs a well-formedness invariant: entity supertype lists must be
  transitively closed (otherwise A<:B, B<:C does not give A<:C).
-/
import ExpressSuite.Specialisation

/- ── List characterizations of the two helpers ── -/

theorem specAll_true (o : Ty) : ∀ ms, specAll ms o = true ↔ ∀ m ∈ ms, spec m o = true
  | [] => by simp [specAll]
  | a :: t => by rw [specAll, Bool.and_eq_true, specAll_true o t]; simp

theorem specAny_true (n : Ty) : ∀ ms, specAny n ms = true ↔ ∃ m ∈ ms, spec n m = true
  | [] => by simp [specAny]
  | a :: t => by rw [specAny, Bool.or_eq_true, specAny_true n t]; simp

/-- Pointwise congruence for `specAll` in its ORIG argument. -/
theorem specAll_cong : ∀ (ms : List Ty) (a b : Ty),
    (∀ m ∈ ms, spec m a = spec m b) → specAll ms a = specAll ms b
  | [], _, _, _ => by simp [specAll]
  | c :: t, a, b, h => by
      rw [specAll, specAll, h c (List.mem_cons_self ..),
          specAll_cong t a b (fun m hm => h m (List.mem_cons_of_mem c hm))]

/- ── boundsOk is reflexive ── -/

theorem boundsOk_refl (lo : Nat) (hi : Option Nat) : boundsOk lo hi lo hi = true := by
  cases hi <;> simp [boundsOk, Nat.ble_eq]

/- ── aggLe is reflexive and transitive (finite case split) ── -/

theorem simpLe_refl (a : Simple) : simpLe a a = true := by
  cases a <;> decide

theorem simpLe_trans {a b c : Simple} : simpLe a b = true → simpLe b c = true → simpLe a c = true := by
  cases a <;> cases b <;> cases c <;> decide

theorem aggLe_refl (k : AggK) : aggLe k k = true := by
  cases k <;> decide

theorem aggLe_trans {a b c : AggK} : aggLe a b = true → aggLe b c = true → aggLe a c = true := by
  cases a <;> cases b <;> cases c <;> decide

/- ── Defined-type transparency on the ORIGINAL operand:  spec x (defn nm u) = spec x u ── -/

theorem spec_orig_defn (nm : String) (u : Ty) :
    ∀ x, spec x (Ty.defn nm u) = spec x u
  | .simp _  => by simp only [spec]
  | .gen     => by simp only [spec]
  | .ent _ _ => by simp only [spec]
  | .agg _ _ _ _ => by simp only [spec]
  | .defn _ w => by simp only [spec]; exact spec_orig_defn nm u w
  | .sel _ ms => by
      simp only [spec]
      exact specAll_cong ms _ _ (fun m hm => spec_orig_defn nm u m)
termination_by x => sizeOf x
decreasing_by
  · simp_wf; omega
  · simp_wf; have := List.sizeOf_lt_of_mem hm; omega

/- ── Key lemma: if x specialises some member of ms, it specialises the whole SELECT. ── -/

theorem spec_key (nm : String) (ms : List Ty) :
    ∀ x, (∃ m ∈ ms, spec x m = true) → spec x (Ty.sel nm ms) = true
  | .simp _,  h => by simp only [spec]; exact (specAny_true _ ms).mpr h
  | .gen,     h => by simp only [spec]; exact (specAny_true _ ms).mpr h
  | .ent _ _, h => by simp only [spec]; exact (specAny_true _ ms).mpr h
  | .agg _ _ _ _, h => by simp only [spec]; exact (specAny_true _ ms).mpr h
  | .defn _ w, h => by
      simp only [spec]
      apply spec_key nm ms w
      obtain ⟨m, hm, hs⟩ := h
      simp only [spec] at hs
      exact ⟨m, hm, hs⟩
  | .sel _ ms2, h => by
      simp only [spec]
      rw [specAll_true]
      intro m2 hm2
      apply spec_key nm ms m2
      obtain ⟨m, hm, hs⟩ := h
      simp only [spec] at hs
      rw [specAll_true] at hs
      exact ⟨m, hm, hs m2 hm2⟩
termination_by x => sizeOf x
decreasing_by
  · simp_wf; omega
  · simp_wf; have := List.sizeOf_lt_of_mem hm2; omega

/- ── Reflexivity ── -/

theorem spec_refl : ∀ t, spec t t = true
  | .simp a  => by simp only [spec, simpLe_refl]
  | .gen     => by simp only [spec]
  | .ent _ _ => by simp [spec]
  | .agg k lo hi e => by
      simp only [spec, aggLe_refl, boundsOk_refl, spec_refl e, Bool.and_true]
  | .defn nm u => by
      simp only [spec]; rw [spec_orig_defn]; exact spec_refl u
  | .sel n ms => by
      simp only [spec]
      rw [specAll_true]
      intro m hm
      exact spec_key n ms m ⟨m, hm, spec_refl m⟩
termination_by t => sizeOf t
decreasing_by
  · simp_wf; omega
  · simp_wf; omega
  · simp_wf; have := List.sizeOf_lt_of_mem hm; omega

/- ═══════════════════════════════════════════════════════════════════════
   Transitivity
   ═══════════════════════════════════════════════════════════════════════ -/

/-- Everything specialises GENERIC (GENERIC is the top type). -/
theorem spec_top : ∀ x, spec x Ty.gen = true
  | .simp _  => by simp only [spec]
  | .gen     => by simp only [spec]
  | .ent _ _ => by simp only [spec]
  | .agg _ _ _ _ => by simp only [spec]
  | .defn _ u => by simp only [spec]; exact spec_top u
  | .sel _ ms => by
      simp only [spec]; rw [specAll_true]; intro m hm; exact spec_top m
termination_by x => sizeOf x
decreasing_by
  · simp_wf; omega
  · simp_wf; have := List.sizeOf_lt_of_mem hm; omega

/-- Bound-specialisation is transitive. -/
theorem boundsOk_trans {loA loB loC : Nat} {hiA hiB hiC : Option Nat} :
    boundsOk loA hiA loB hiB = true → boundsOk loB hiB loC hiC = true →
    boundsOk loA hiA loC hiC = true := by
  cases hiA <;> cases hiB <;> cases hiC <;>
    simp_all [boundsOk, Nat.ble_eq] <;> omega

/-- Well-formedness invariant needed for entity transitivity: the entity
    subtype-name relation is transitively closed (a schema-level property —
    a's supertype set contains b and all of b's supertypes whenever a <: b). -/
def EntTrans : Prop :=
  ∀ (an : String) (as bs : List String) (bn cn : String),
    ((bn == an) || as.contains bn) = true →
    ((cn == bn) || bs.contains cn) = true →
    ((cn == an) || as.contains cn) = true

/-- Transitivity of `spec`, modulo the entity-closure invariant `EntTrans`. -/
theorem spec_trans (hE : EntTrans) : ∀ a b c,
    spec a b = true → spec b c = true → spec a c = true
  -- strip defined-type / GENERIC on the RIGHT operand (universal in a,b)
  | a, b, .defn _ uc, hab, hbc => by
      rw [spec_orig_defn] at hbc ⊢; exact spec_trans hE a b uc hab hbc
  | a, b, .gen, _, _ => spec_top a
  -- resolve the LEFT operand (universal in b,c)
  | .defn _ w, b, c, hab, hbc => by
      simp only [spec] at hab ⊢; exact spec_trans hE w b c hab hbc
  | .sel _ ms, b, c, hab, hbc => by
      simp only [spec] at hab ⊢; rw [specAll_true] at hab ⊢
      exact fun m hm => spec_trans hE m b c (hab m hm) hbc
  -- strip a defined-type on the MIDDLE operand (a stays abstract via universal rewrite)
  | a, .defn _ ub, c, hab, hbc => by
      rw [spec_orig_defn] at hab; simp only [spec] at hbc
      exact spec_trans hE a ub c hab hbc
  -- b a SELECT  (a concrete, split for the head)
  | .simp _, .sel _ ms, c, hab, hbc | .gen, .sel _ ms, c, hab, hbc
  | .ent _ _, .sel _ ms, c, hab, hbc | .agg _ _ _ _, .sel _ ms, c, hab, hbc => by
      simp only [spec] at hab hbc
      rw [specAny_true] at hab; rw [specAll_true] at hbc
      obtain ⟨mb, hmb, hs⟩ := hab
      exact spec_trans hE _ mb c hs (hbc mb hmb)
  -- a = GENERIC, b = GENERIC : goal is exactly hbc
  | .gen, .gen, c, _, hbc => hbc
  -- a = GENERIC, b concrete non-gen : spec gen b = false, hab impossible
  | .gen, .simp _, _, hab, _ | .gen, .ent _ _, _, hab, _
  | .gen, .agg _ _ _ _, _, hab, _ => by simp [spec] at hab
  -- a concrete non-gen, b = GENERIC, c a SELECT : witness via spec gen c
  | .simp _, .gen, .sel _ ms, _, hbc | .ent _ _, .gen, .sel _ ms, _, hbc
  | .agg _ _ _ _, .gen, .sel _ ms, _, hbc => by
      simp only [spec] at hbc ⊢; rw [specAny_true] at hbc ⊢
      obtain ⟨m, hm, hs⟩ := hbc
      exact ⟨m, hm, spec_trans hE _ Ty.gen m (spec_top _) hs⟩
  -- a concrete non-gen, b = GENERIC, c concrete : spec gen c = false, hbc impossible
  | .simp _, .gen, .simp _, _, hbc | .simp _, .gen, .ent _ _, _, hbc | .simp _, .gen, .agg _ _ _ _, _, hbc
  | .ent _ _, .gen, .simp _, _, hbc | .ent _ _, .gen, .ent _ _, _, hbc | .ent _ _, .gen, .agg _ _ _ _, _, hbc
  | .agg _ _ _ _, .gen, .simp _, _, hbc | .agg _ _ _ _, .gen, .ent _ _, _, hbc
  | .agg _ _ _ _, .gen, .agg _ _ _ _, _, hbc => by simp [spec] at hbc
  -- a, b concrete non-gen, c a SELECT : witness via spec b c
  | .simp _, .simp _, .sel _ ms, hab, hbc | .simp _, .ent _ _, .sel _ ms, hab, hbc | .simp _, .agg _ _ _ _, .sel _ ms, hab, hbc
  | .ent _ _, .simp _, .sel _ ms, hab, hbc | .ent _ _, .ent _ _, .sel _ ms, hab, hbc | .ent _ _, .agg _ _ _ _, .sel _ ms, hab, hbc
  | .agg _ _ _ _, .simp _, .sel _ ms, hab, hbc | .agg _ _ _ _, .ent _ _, .sel _ ms, hab, hbc
  | .agg _ _ _ _, .agg _ _ _ _, .sel _ ms, hab, hbc => by
      simp only [spec] at hbc ⊢; rw [specAny_true] at hbc ⊢
      obtain ⟨mc, hmc, hs⟩ := hbc
      exact ⟨mc, hmc, spec_trans hE _ _ mc hab hs⟩
  -- base: all three concrete, matching kinds
  | .simp a', .simp b', .simp c', hab, hbc => by
      simp only [spec] at hab hbc ⊢
      exact simpLe_trans hab hbc
  | .ent an as, .ent bn bs, .ent cn cs, hab, hbc => by
      simp only [spec] at hab hbc ⊢; exact hE an as bs bn cn hab hbc
  | .agg ka la ha ea, .agg kb lb hb eb, .agg kc lc hc ec, hab, hbc => by
      simp only [spec, Bool.and_eq_true] at hab hbc ⊢
      obtain ⟨⟨hk1, hbd1⟩, he1⟩ := hab
      obtain ⟨⟨hk2, hbd2⟩, he2⟩ := hbc
      exact ⟨⟨aggLe_trans hk1 hk2, boundsOk_trans hbd1 hbd2⟩, spec_trans hE ea eb ec he1 he2⟩
  -- base: all three concrete, mismatched kinds (spec a b or spec b c is false)
  | .simp _, .ent _ _, _, hab, _ | .simp _, .agg _ _ _ _, _, hab, _
  | .ent _ _, .simp _, _, hab, _ | .ent _ _, .agg _ _ _ _, _, hab, _
  | .agg _ _ _ _, .simp _, _, hab, _ | .agg _ _ _ _, .ent _ _, _, hab, _ => by simp [spec] at hab
  | .simp _, .simp _, .ent _ _, _, hbc | .simp _, .simp _, .agg _ _ _ _, _, hbc
  | .ent _ _, .ent _ _, .simp _, _, hbc | .ent _ _, .ent _ _, .agg _ _ _ _, _, hbc
  | .agg _ _ _ _, .agg _ _ _ _, .simp _, _, hbc | .agg _ _ _ _, .agg _ _ _ _, .ent _ _, _, hbc => by
      simp [spec] at hbc
termination_by a b c => sizeOf a + sizeOf b + sizeOf c
decreasing_by
  all_goals (simp_wf; first
    | omega
    | (first
        | (have := List.sizeOf_lt_of_mem ‹_ ∈ _›; omega)
        | (rename_i h _ _; have := List.sizeOf_lt_of_mem h; omega)))
