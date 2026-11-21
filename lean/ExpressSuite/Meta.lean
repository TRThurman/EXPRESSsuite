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
  Amended 2026-11-21 (EXPRESSsuite): the hypothesis of `spec_trans` was a
  closure property stated over arbitrary names and lists, which is false, so
  the theorem held vacuously. It is now a closed supertype table `sup` with
  `entOk sup` on each operand; `closed_of_closedB` decides closure of a finite
  table, and Cases.lean shows the hypotheses hold for the cases encoded there.
-/
/-
  Meta.lean — metatheory for the `spec` relation defined in Specialisation.lean.

  Proves:
   • spec_refl  : ∀ t, spec t t = true                    (reflexivity, unconditional)
   • spec_trans : Closed sup → entOk sup a, b, c → spec a b → spec b c → spec a c
                  (transitivity)

  Transitivity needs a well-formedness invariant: every entity in a, b and c
  carries the supertype list of one transitively closed table `sup` of the
  schema's entities (otherwise A<:B, B<:C does not give A<:C).
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

/- ── The entity table: the well-formedness transitivity and soundness need ──

   A `Ty.ent n s` carries the supertype names `s` of entity `n`. Transitivity
   and soundness need these lists to come from ONE transitively closed table
   of the schema's entities. Stating the closure over arbitrary lists (as an
   earlier version of this file did) is false: an entity named "a" with no
   supertypes and another type also named "a" with supertype "c" satisfy the
   premises and not the conclusion. -/

/-- A supertype table: entity name ↦ the names of all its supertypes. -/
abbrev Table := String → List String

/-- The table is transitively closed: a supertype of a supertype of `a` is a
    supertype of `a`. -/
def Closed (sup : Table) : Prop :=
  ∀ a b c, ((b == a) || (sup a).contains b) = true →
           ((c == b) || (sup b).contains c) = true →
           ((c == a) || (sup a).contains c) = true

mutual
/-- Every entity occurring in the type carries the list the table gives its name. -/
def entOk (sup : Table) : Ty → Bool
  | .ent n s => s == sup n
  | .defn _ u => entOk sup u
  | .sel _ ms => entOkAll sup ms
  | .agg _ _ _ e => entOk sup e
  | .simp _ => true
  | .gen => true
  termination_by t => sizeOf t
  decreasing_by all_goals (simp_wf; omega)

def entOkAll (sup : Table) : List Ty → Bool
  | [] => true
  | m :: t => entOk sup m && entOkAll sup t
  termination_by ms => sizeOf ms
  decreasing_by all_goals (simp_wf; omega)
end

theorem entOkAll_true (sup : Table) : ∀ ms, entOkAll sup ms = true ↔ ∀ m ∈ ms, entOk sup m = true
  | [] => by simp [entOkAll]
  | a :: t => by rw [entOkAll, Bool.and_eq_true, entOkAll_true sup t]; simp

/-- A table given as a finite list of entries; a name not listed has no supertypes. -/
def ofList (t : List (String × List String)) : Table :=
  fun n => ((t.find? (fun e => e.1 == n)).map (·.2)).getD []

/-- The finite closure check: for each entry `a`, every supertype of each of its
    supertypes is `a` or among `a`'s supertypes. -/
def closedB (t : List (String × List String)) : Bool :=
  t.all fun e => e.2.all fun b => (ofList t b).all fun c => (c == e.1) || e.2.contains c

theorem ofList_entry {t : List (String × List String)} {a : String} {x : String}
    (h : (ofList t a).contains x = true) : ∃ e ∈ t, e.1 = a ∧ e.2 = ofList t a := by
  unfold ofList at h ⊢
  cases hf : t.find? (fun e => e.1 == a) with
  | none => simp [hf] at h
  | some e =>
      refine ⟨e, List.mem_of_find?_eq_some hf, ?_, by simp⟩
      have := List.find?_some hf
      simpa using this

/-- The finite check decides closure of the table it describes. -/
theorem closed_of_closedB (t : List (String × List String)) (h : closedB t = true) :
    Closed (ofList t) := by
  intro a b c hab hbc
  simp only [Bool.or_eq_true, beq_iff_eq] at hab hbc ⊢
  rcases hab with rfl | hab
  · exact hbc
  · obtain ⟨e, he, hea, hes⟩ := ofList_entry hab
    rcases hbc with rfl | hbc
    · exact Or.inr hab
    · simp only [closedB, List.all_eq_true] at h
      have hb : b ∈ e.2 := by rw [hes]; simpa using hab
      have hc : c ∈ ofList t b := by simpa using hbc
      have := h e he b hb c hc
      simp only [Bool.or_eq_true, beq_iff_eq] at this
      rcases this with h1 | h1
      · exact Or.inl (h1.trans hea)
      · exact Or.inr (by rw [← hes]; exact h1)

/-- Transitivity of `spec` for types whose entities come from one transitively
    closed supertype table. -/
theorem spec_trans (sup : Table) (hT : Closed sup) : ∀ a b c,
    entOk sup a = true → entOk sup b = true → entOk sup c = true →
    spec a b = true → spec b c = true → spec a c = true
  -- strip defined-type / GENERIC on the RIGHT operand (universal in a,b)
  | a, b, .defn _ uc, ha, hb, hc, hab, hbc => by
      simp only [entOk] at hc
      rw [spec_orig_defn] at hbc ⊢; exact spec_trans sup hT a b uc ha hb hc hab hbc
  | a, b, .gen, _, _, _, _, _ => spec_top a
  -- resolve the LEFT operand (universal in b,c)
  | .defn _ w, b, c, ha, hb, hc, hab, hbc => by
      simp only [entOk] at ha
      simp only [spec] at hab ⊢; exact spec_trans sup hT w b c ha hb hc hab hbc
  | .sel _ ms, b, c, ha, hb, hc, hab, hbc => by
      simp only [entOk] at ha; rw [entOkAll_true] at ha
      simp only [spec] at hab ⊢; rw [specAll_true] at hab ⊢
      exact fun m hm => spec_trans sup hT m b c (ha m hm) hb hc (hab m hm) hbc
  -- strip a defined-type on the MIDDLE operand (a stays abstract via universal rewrite)
  | a, .defn _ ub, c, ha, hb, hc, hab, hbc => by
      simp only [entOk] at hb
      rw [spec_orig_defn] at hab; simp only [spec] at hbc
      exact spec_trans sup hT a ub c ha hb hc hab hbc
  -- b a SELECT  (a concrete, split for the head)
  | .simp _, .sel _ ms, c, ha, hb, hc, hab, hbc | .gen, .sel _ ms, c, ha, hb, hc, hab, hbc
  | .ent _ _, .sel _ ms, c, ha, hb, hc, hab, hbc | .agg _ _ _ _, .sel _ ms, c, ha, hb, hc, hab, hbc => by
      simp only [entOk] at hb; rw [entOkAll_true] at hb
      simp only [spec] at hab hbc
      rw [specAny_true] at hab; rw [specAll_true] at hbc
      obtain ⟨mb, hmb, hs⟩ := hab
      exact spec_trans sup hT _ mb c ha (hb mb hmb) hc hs (hbc mb hmb)
  -- a = GENERIC, b = GENERIC : goal is exactly hbc
  | .gen, .gen, c, _, _, _, _, hbc => hbc
  -- a = GENERIC, b concrete non-gen : spec gen b = false, hab impossible
  | .gen, .simp _, _, _, _, _, hab, _ | .gen, .ent _ _, _, _, _, _, hab, _
  | .gen, .agg _ _ _ _, _, _, _, _, hab, _ => by simp [spec] at hab
  -- a concrete non-gen, b = GENERIC, c a SELECT : witness via spec gen c
  | .simp _, .gen, .sel _ ms, ha, _, hc, _, hbc | .ent _ _, .gen, .sel _ ms, ha, _, hc, _, hbc
  | .agg _ _ _ _, .gen, .sel _ ms, ha, _, hc, _, hbc => by
      simp only [entOk] at hc; rw [entOkAll_true] at hc
      simp only [spec] at hbc ⊢; rw [specAny_true] at hbc ⊢
      obtain ⟨m, hm, hs⟩ := hbc
      exact ⟨m, hm, spec_trans sup hT _ Ty.gen m ha (by simp [entOk]) (hc m hm) (spec_top _) hs⟩
  -- a concrete non-gen, b = GENERIC, c concrete : spec gen c = false, hbc impossible
  | .simp _, .gen, .simp _, _, _, _, _, hbc | .simp _, .gen, .ent _ _, _, _, _, _, hbc
  | .simp _, .gen, .agg _ _ _ _, _, _, _, _, hbc
  | .ent _ _, .gen, .simp _, _, _, _, _, hbc | .ent _ _, .gen, .ent _ _, _, _, _, _, hbc
  | .ent _ _, .gen, .agg _ _ _ _, _, _, _, _, hbc
  | .agg _ _ _ _, .gen, .simp _, _, _, _, _, hbc | .agg _ _ _ _, .gen, .ent _ _, _, _, _, _, hbc
  | .agg _ _ _ _, .gen, .agg _ _ _ _, _, _, _, _, hbc => by simp [spec] at hbc
  -- a, b concrete non-gen, c a SELECT : witness via spec b c
  | .simp _, .simp _, .sel _ ms, ha, hb, hc, hab, hbc | .simp _, .ent _ _, .sel _ ms, ha, hb, hc, hab, hbc
  | .simp _, .agg _ _ _ _, .sel _ ms, ha, hb, hc, hab, hbc
  | .ent _ _, .simp _, .sel _ ms, ha, hb, hc, hab, hbc | .ent _ _, .ent _ _, .sel _ ms, ha, hb, hc, hab, hbc
  | .ent _ _, .agg _ _ _ _, .sel _ ms, ha, hb, hc, hab, hbc
  | .agg _ _ _ _, .simp _, .sel _ ms, ha, hb, hc, hab, hbc | .agg _ _ _ _, .ent _ _, .sel _ ms, ha, hb, hc, hab, hbc
  | .agg _ _ _ _, .agg _ _ _ _, .sel _ ms, ha, hb, hc, hab, hbc => by
      simp only [entOk] at hc; rw [entOkAll_true] at hc
      simp only [spec] at hbc ⊢; rw [specAny_true] at hbc ⊢
      obtain ⟨mc, hmc, hs⟩ := hbc
      exact ⟨mc, hmc, spec_trans sup hT _ _ mc ha hb (hc mc hmc) hab hs⟩
  -- base: all three concrete, matching kinds
  | .simp a', .simp b', .simp c', _, _, _, hab, hbc => by
      simp only [spec] at hab hbc ⊢
      exact simpLe_trans hab hbc
  | .ent an as, .ent bn bs, .ent cn cs, ha, hb, _, hab, hbc => by
      simp only [entOk, beq_iff_eq] at ha hb
      subst ha; subst hb
      simp only [spec] at hab hbc ⊢; exact hT an bn cn hab hbc
  | .agg ka la ua ea, .agg kb lb ub eb, .agg kc lc uc ec, ha, hb, hc, hab, hbc => by
      simp only [entOk] at ha hb hc
      simp only [spec, Bool.and_eq_true] at hab hbc ⊢
      obtain ⟨⟨hk1, hbd1⟩, he1⟩ := hab
      obtain ⟨⟨hk2, hbd2⟩, he2⟩ := hbc
      exact ⟨⟨aggLe_trans hk1 hk2, boundsOk_trans hbd1 hbd2⟩, spec_trans sup hT ea eb ec ha hb hc he1 he2⟩
  -- base: all three concrete, mismatched kinds (spec a b or spec b c is false)
  | .simp _, .ent _ _, _, _, _, _, hab, _ | .simp _, .agg _ _ _ _, _, _, _, _, hab, _
  | .ent _ _, .simp _, _, _, _, _, hab, _ | .ent _ _, .agg _ _ _ _, _, _, _, _, hab, _
  | .agg _ _ _ _, .simp _, _, _, _, _, hab, _ | .agg _ _ _ _, .ent _ _, _, _, _, _, hab, _ => by
      simp [spec] at hab
  | .simp _, .simp _, .ent _ _, _, _, _, _, hbc | .simp _, .simp _, .agg _ _ _ _, _, _, _, _, hbc
  | .ent _ _, .ent _ _, .simp _, _, _, _, _, hbc | .ent _ _, .ent _ _, .agg _ _ _ _, _, _, _, _, hbc
  | .agg _ _ _ _, .agg _ _ _ _, .simp _, _, _, _, _, hbc
  | .agg _ _ _ _, .agg _ _ _ _, .ent _ _, _, _, _, _, hbc => by
      simp [spec] at hbc
termination_by a b c => sizeOf a + sizeOf b + sizeOf c
decreasing_by
  all_goals (simp_wf; first
    | omega
    | (first
        | (have := List.sizeOf_lt_of_mem ‹_ ∈ _›; omega)
        | (rename_i h _ _; have := List.sizeOf_lt_of_mem h; omega)))

#print axioms spec_trans
#print axioms closed_of_closedB
