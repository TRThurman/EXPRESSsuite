/-
  Inheritance.lean — ISO 10303-11:2004 12.7.3, attribute references.

  "If the declared type of the expression to the left of the attribute
   reference is an entity data type then the attribute name to the right of
   the attribute reference shall be declared in that entity data type, a
   supertype or subtype of that entity data type. ... If two or more
   attributes are found with the same name then the reference is ambiguous
   and indeterminate (?) is returned."

  Three things are modelled over a finite inheritance graph:

    Visible g e x      the specification: x is e, a supertype of e, or a
                       subtype of e (reflexive-transitive closure of the
                       direct SUBTYPE OF lists, in either direction).
    visible g e        the proposed algorithm: ancestors of e (closure over
                       supertypes only) followed by descendants of e (closure
                       over subtypes only), nearest first, no duplicates.
    component g e      the current EXPRESSsuite algorithm
                       (ExpressP11Entity.computeSubSuper): closure over
                       supertypes AND subtypes at every step, i.e. the whole
                       connected component.

  Proved:  mem_visible_iff      x ∈ visible g e ↔ Visible g e x
           visible_sub_component Visible g e x → x ∈ component g e
           resolve_unique        a `unique` verdict names the one entity in
                                 the 12.7.3 set declaring the attribute
           visible_head          the entity itself is consulted first
  Build-checked (#guard): the b_spline_geometry witness from the published
  SMRLv8 ARM (Rational_b_spline_curve is in the component of
  Rational_b_spline_surface but not in its 12.7.3 set), the standard's
  9.2.3.3 ambiguity example, and the 12.7.3 point/coloured_point example.

  Modelling decisions:
  * `Decl.attrs` lists NEW attribute names only (explicit, DERIVE, INVERSE).
    A redeclaration `SELF\e.a : T` does not declare a new name and is not
    listed; the name `a` belongs to the entity that first declared it.
  * Several declarations with the same entity name (the duplicate-schema
    situation) are treated as the union of their supertype lists.
  * Supertypes that are named but never declared are nodes with no edges.
  Core Lean 4 only, no Mathlib.
-/
namespace Inheritance

structure Decl where
  name   : String
  supers : List String
  attrs  : List String
deriving Repr

abbrev Graph := List Decl

def supersOf (g : Graph) (y : String) : List String :=
  (g.filter (fun d => d.name == y)).flatMap (·.supers)

def subsOf (g : Graph) (x : String) : List String :=
  (g.filter (fun d => d.supers.contains x)).map (·.name)

def attrsOf (g : Graph) (x : String) : List String :=
  (g.filter (fun d => d.name == x)).flatMap (·.attrs)

/-- every entity name that occurs anywhere in the graph -/
def names (g : Graph) : List String := g.flatMap (fun d => d.name :: d.supers)

/- ───────────── reachability along a successor function ───────────── -/

inductive Reach (next : String → List String) (e : String) : String → Prop
  | refl : Reach next e e
  | step {y x : String} : Reach next e y → x ∈ next y → Reach next e x

theorem Reach.trans {next : String → List String} {a b c : String}
    (h1 : Reach next a b) (h2 : Reach next b c) : Reach next a c := by
  induction h2 with
  | refl => exact h1
  | step _ hx ih => exact Reach.step ih hx

theorem Reach.mono {n1 n2 : String → List String}
    (h : ∀ y x, x ∈ n1 y → x ∈ n2 y) {e x : String} (r : Reach n1 e x) : Reach n2 e x := by
  induction r with
  | refl => exact Reach.refl
  | step _ hx ih => exact Reach.step ih (h _ _ hx)

/-- reversing every edge reverses reachability -/
theorem Reach.rev {n1 n2 : String → List String}
    (h : ∀ a b, b ∈ n1 a ↔ a ∈ n2 b) {e x : String} (r : Reach n1 e x) : Reach n2 x e := by
  induction r with
  | refl => exact Reach.refl
  | step _ hx ih => exact Reach.trans (Reach.step Reach.refl ((h _ _).1 hx)) ih

/- ───────────── addAll: append the new elements of xs to s, keeping order ───────────── -/

def addAll (s : List String) : List String → List String
  | [] => s
  | x :: xs => addAll (if x ∈ s then s else s ++ [x]) xs

theorem mem_addAll {x : String} : ∀ {s xs : List String}, x ∈ addAll s xs ↔ x ∈ s ∨ x ∈ xs := by
  intro s xs
  induction xs generalizing s with
  | nil => simp [addAll]
  | cons y ys ih =>
    simp only [addAll]
    split
    · rename_i hy
      rw [ih]; simp only [List.mem_cons]
      constructor
      · rintro (h | h)
        · exact Or.inl h
        · exact Or.inr (Or.inr h)
      · rintro (h | h | h)
        · exact Or.inl h
        · exact Or.inl (by subst h; exact hy)
        · exact Or.inr h
    · rw [ih]; simp only [List.mem_append, List.mem_cons, List.not_mem_nil, or_false, or_assoc]

theorem nodup_addAll : ∀ {s xs : List String}, s.Nodup → (addAll s xs).Nodup := by
  intro s xs h
  induction xs generalizing s with
  | nil => simpa [addAll] using h
  | cons y ys ih =>
    simp only [addAll]
    split
    · exact ih h
    · rename_i hy
      apply ih
      rw [List.nodup_append]
      refine ⟨h, List.nodup_cons.2 ⟨List.not_mem_nil, List.nodup_nil⟩, ?_⟩
      intro a ha b hb hab
      rw [List.mem_singleton] at hb
      subst hb; subst hab
      exact hy ha

theorem addAll_prefix : ∀ {s xs : List String}, ∃ t, addAll s xs = s ++ t := by
  intro s xs
  induction xs generalizing s with
  | nil => exact ⟨[], by simp [addAll]⟩
  | cons y ys ih =>
    simp only [addAll]
    split
    · exact ih
    · obtain ⟨t, ht⟩ := @ih (s ++ [y])
      exact ⟨[y] ++ t, by rw [ht, List.append_assoc]⟩

theorem length_addAll_ge : ∀ {s xs : List String}, s.length ≤ (addAll s xs).length := by
  intro s xs
  induction xs generalizing s with
  | nil => simp [addAll]
  | cons y ys ih =>
    simp only [addAll]
    split
    · exact ih
    · exact Nat.le_trans (by simp) ih

theorem length_addAll_gt : ∀ {s xs : List String},
    (∃ x, x ∈ xs ∧ x ∉ s) → s.length < (addAll s xs).length := by
  intro s xs h
  induction xs generalizing s with
  | nil => obtain ⟨x, hx, _⟩ := h; exact absurd hx List.not_mem_nil
  | cons y ys ih =>
    simp only [addAll]
    split
    · rename_i hy
      apply ih
      obtain ⟨x, hx, hxs⟩ := h
      rw [List.mem_cons] at hx
      rcases hx with rfl | hx
      · exact absurd hy hxs
      · exact ⟨x, hx, hxs⟩
    · exact Nat.lt_of_lt_of_le (by simp) length_addAll_ge

theorem addAll_eq_of_sub : ∀ {s xs : List String}, (∀ x, x ∈ xs → x ∈ s) → addAll s xs = s := by
  intro s xs h
  induction xs generalizing s with
  | nil => rfl
  | cons y ys ih =>
    simp only [addAll]
    split
    · exact ih (fun x hx => h x (List.mem_cons.2 (Or.inr hx)))
    · exact absurd (h y (List.mem_cons.2 (Or.inl rfl))) (by assumption)

/-- pigeonhole: a duplicate-free list inside `m` is no longer than `m` -/
theorem nodup_subset_length : ∀ {l m : List String},
    l.Nodup → (∀ x, x ∈ l → x ∈ m) → l.length ≤ m.length := by
  intro l m hn hs
  induction l generalizing m with
  | nil => exact Nat.zero_le _
  | cons a l ih =>
    rw [List.nodup_cons] at hn
    have ha : a ∈ m := hs a (List.mem_cons.2 (Or.inl rfl))
    have hsub : ∀ x, x ∈ l → x ∈ m.erase a := by
      intro x hx
      have hne : x ≠ a := fun h => hn.1 (by subst h; exact hx)
      exact (List.mem_erase_of_ne hne).2 (hs x (List.mem_cons.2 (Or.inr hx)))
    have h1 := ih hn.2 hsub
    rw [List.length_erase_of_mem ha] at h1
    have hm : 0 < m.length := List.length_pos_of_mem ha
    simp only [List.length_cons]
    omega

/- ───────────── one breadth-first layer, iterated with fuel ───────────── -/

section Closure
variable (next : String → List String)

def step (s : List String) : List String := addAll s (s.flatMap next)

def Closed (s : List String) : Prop := ∀ y, y ∈ s → ∀ x, x ∈ next y → x ∈ s

theorem mem_step {s : List String} {x : String} :
    x ∈ step next s ↔ x ∈ s ∨ ∃ y, y ∈ s ∧ x ∈ next y := by
  simp only [step, mem_addAll, List.mem_flatMap]

theorem step_eq_of_closed {s : List String} (h : Closed next s) : step next s = s :=
  addAll_eq_of_sub (fun x hx => by
    obtain ⟨y, hy, hxy⟩ := List.mem_flatMap.1 hx
    exact h y hy x hxy)

theorem length_step_gt {s : List String} (h : ¬ Closed next s) : s.length < (step next s).length := by
  apply length_addAll_gt
  have hw : ∃ y, y ∈ s ∧ ∃ x, x ∈ next y ∧ x ∉ s := by
    refine Classical.byContradiction (fun hc => h ?_)
    intro y hy x hx
    exact Classical.byContradiction (fun hxs => hc ⟨y, hy, x, hx, hxs⟩)
  obtain ⟨y, hy, x, hx, hxs⟩ := hw
  exact ⟨x, List.mem_flatMap.2 ⟨y, hy, hx⟩, hxs⟩

def iter : Nat → List String → List String
  | 0, s => s
  | n+1, s => iter n (step next s)

theorem sub_iter : ∀ (n : Nat) {s : List String} {x : String}, x ∈ s → x ∈ iter next n s := by
  intro n
  induction n with
  | zero => intro s x hx; exact hx
  | succ n ih => intro s x hx; exact ih ((mem_step next).2 (Or.inl hx))

theorem iter_sound : ∀ (n : Nat) {s : List String} {e x : String},
    (∀ y, y ∈ s → Reach next e y) → x ∈ iter next n s → Reach next e x := by
  intro n
  induction n with
  | zero => intro s e x hs hx; exact hs x hx
  | succ n ih =>
    intro s e x hs hx
    refine ih ?_ hx
    intro y hy
    rcases (mem_step next).1 hy with hy | ⟨z, hz, hyz⟩
    · exact hs y hy
    · exact Reach.step (hs z hz) hyz

theorem iter_of_closed : ∀ (n : Nat) {s : List String}, Closed next s → iter next n s = s := by
  intro n
  induction n with
  | zero => intro s _; rfl
  | succ n ih => intro s h; simp only [iter]; rw [step_eq_of_closed next h]; exact ih h

theorem iter_add : ∀ (k m : Nat) (s : List String), iter next (k + m) s = iter next m (iter next k s) := by
  intro k
  induction k with
  | zero => intro m s; rw [Nat.zero_add]; rfl
  | succ k ih =>
    intro m s
    have h : k + 1 + m = (k + m) + 1 := by omega
    rw [h]; simp only [iter]; exact ih m (step next s)

theorem iter_nodup : ∀ (n : Nat) {s : List String}, s.Nodup → (iter next n s).Nodup := by
  intro n
  induction n with
  | zero => intro s h; exact h
  | succ n ih => intro s h; exact ih (nodup_addAll h)

theorem iter_sub (U : List String) (hU : ∀ y x, x ∈ next y → x ∈ U) :
    ∀ (n : Nat) {s : List String}, (∀ x, x ∈ s → x ∈ U) → ∀ x, x ∈ iter next n s → x ∈ U := by
  intro n
  induction n with
  | zero => intro s hs x hx; exact hs x hx
  | succ n ih =>
    intro s hs x hx
    refine ih ?_ x hx
    intro z hz
    rcases (mem_step next).1 hz with hz | ⟨y, hy, hzy⟩
    · exact hs z hz
    · exact hU y z hzy

theorem iter_prefix : ∀ (n : Nat) (s : List String), ∃ t, iter next n s = s ++ t := by
  intro n
  induction n with
  | zero => intro s; exact ⟨[], by simp [iter]⟩
  | succ n ih =>
    intro s
    obtain ⟨t1, h1⟩ := @addAll_prefix s (s.flatMap next)
    obtain ⟨t2, h2⟩ := ih (step next s)
    refine ⟨t1 ++ t2, ?_⟩
    simp only [iter]; rw [h2]; simp only [step]; rw [h1, List.append_assoc]

/-- with fuel `U.length`, the iteration from `[e]` is closed under `next` -/
theorem iter_closed (U : List String) (hU : ∀ y x, x ∈ next y → x ∈ U) (e : String) (he : e ∈ U) :
    Closed next (iter next U.length [e]) := by
  have hstart : ∀ x, x ∈ [e] → x ∈ U := fun x hx => by
    rw [List.mem_singleton] at hx; subst hx; exact he
  -- while no iterate is closed, the length grows by at least one per step
  have grow : ∀ k, (∀ j, j < k → ¬ Closed next (iter next j [e])) → k + 1 ≤ (iter next k [e]).length := by
    intro k
    induction k with
    | zero => intro _; simp [iter]
    | succ k ih =>
      intro hk
      have h1 := ih (fun j hj => hk j (Nat.lt_succ_of_lt hj))
      have h2 := length_step_gt next (hk k (Nat.lt_succ_self k))
      have h3 : iter next (k + 1) [e] = step next (iter next k [e]) := by
        rw [iter_add next k 1]; rfl
      rw [h3]; omega
  rcases Classical.em (∃ j, j < U.length ∧ Closed next (iter next j [e])) with ⟨j, hj, hc⟩ | hno
  · have h2 : iter next U.length [e] = iter next (U.length - j) (iter next j [e]) := by
      rw [← iter_add]; congr 1; omega
    rw [h2, iter_of_closed next _ hc]; exact hc
  · have h1 := grow U.length (fun j hj hc => hno ⟨j, hj, hc⟩)
    have h2 := nodup_subset_length (iter_nodup next U.length (List.nodup_cons.2 ⟨List.not_mem_nil, List.nodup_nil⟩))
      (iter_sub next U hU U.length hstart)
    exact absurd (Nat.le_trans h1 h2) (Nat.not_succ_le_self _)

def closure (U : List String) (e : String) : List String := iter next U.length [e]

theorem mem_closure_iff (U : List String) (hU : ∀ y x, x ∈ next y → x ∈ U) (e : String) (he : e ∈ U)
    {x : String} : x ∈ closure next U e ↔ Reach next e x := by
  constructor
  · intro hx
    exact iter_sound next _ (fun y hy => by rw [List.mem_singleton] at hy; subst hy; exact Reach.refl) hx
  · intro r
    have hc := iter_closed next U hU e he
    induction r with
    | refl => exact sub_iter next _ (List.mem_singleton.2 rfl)
    | step _ hx ih => exact hc _ ih _ hx

theorem closure_nodup (U : List String) (e : String) : (closure next U e).Nodup :=
  iter_nodup next _ (List.nodup_cons.2 ⟨List.not_mem_nil, List.nodup_nil⟩)

theorem closure_head (U : List String) (e : String) : (closure next U e).head? = some e := by
  obtain ⟨t, ht⟩ := iter_prefix next U.length [e]
  simp only [closure]; rw [ht]; rfl

end Closure

/- ───────────── the 12.7.3 set ───────────── -/

theorem supersOf_sub (g : Graph) : ∀ y x, x ∈ supersOf g y → x ∈ names g := by
  intro y x hx
  obtain ⟨d, hd, hxd⟩ := List.mem_flatMap.1 hx
  exact List.mem_flatMap.2 ⟨d, (List.mem_filter.1 hd).1, List.mem_cons.2 (Or.inr hxd)⟩

theorem subsOf_sub (g : Graph) : ∀ x y, y ∈ subsOf g x → y ∈ names g := by
  intro x y hy
  obtain ⟨d, hd, hdy⟩ := List.mem_map.1 hy
  exact List.mem_flatMap.2 ⟨d, (List.mem_filter.1 hd).1, List.mem_cons.2 (Or.inl hdy.symm)⟩

/-- `b` is a direct subtype of `a` exactly when `a` is a direct supertype of `b` -/
theorem subs_supers_rev (g : Graph) : ∀ a b, b ∈ subsOf g a ↔ a ∈ supersOf g b := by
  intro a b
  simp only [subsOf, supersOf, List.mem_map, List.mem_filter, List.mem_flatMap,
    List.contains_iff_mem, beq_iff_eq]
  constructor
  · rintro ⟨d, ⟨hd, ha⟩, hb⟩; exact ⟨d, ⟨hd, hb⟩, ha⟩
  · rintro ⟨d, ⟨hd, hb⟩, ha⟩; exact ⟨d, ⟨hd, ha⟩, hb⟩

/-- the specification: x is e, a supertype of e, or a subtype of e (12.7.3) -/
def Visible (g : Graph) (e x : String) : Prop :=
  Reach (supersOf g) e x ∨ Reach (supersOf g) x e

/-- the proposed algorithm -/
def ancestors (g : Graph) (e : String) : List String := closure (supersOf g) (e :: names g) e
def descendants (g : Graph) (e : String) : List String := closure (subsOf g) (e :: names g) e
def visible (g : Graph) (e : String) : List String := addAll (ancestors g e) (descendants g e)

/-- the current algorithm (computeSubSuper): both directions at every step -/
def componentNext (g : Graph) (y : String) : List String := supersOf g y ++ subsOf g y
def component (g : Graph) (e : String) : List String := closure (componentNext g) (e :: names g) e

theorem mem_ancestors_iff (g : Graph) (e x : String) : x ∈ ancestors g e ↔ Reach (supersOf g) e x :=
  mem_closure_iff _ _ (fun y x hx => List.mem_cons.2 (Or.inr (supersOf_sub g y x hx))) e
    (List.mem_cons.2 (Or.inl rfl))

theorem mem_descendants_iff (g : Graph) (e x : String) : x ∈ descendants g e ↔ Reach (supersOf g) x e := by
  rw [descendants, mem_closure_iff _ _ (fun y x hx => List.mem_cons.2 (Or.inr (subsOf_sub g y x hx))) e
    (List.mem_cons.2 (Or.inl rfl))]
  constructor
  · exact Reach.rev (subs_supers_rev g)
  · exact Reach.rev (fun a b => (subs_supers_rev g b a).symm)

/-- MAIN: the proposed algorithm computes exactly the 12.7.3 set -/
theorem mem_visible_iff (g : Graph) (e x : String) : x ∈ visible g e ↔ Visible g e x := by
  simp only [visible, mem_addAll, mem_ancestors_iff, mem_descendants_iff, Visible]

/-- the current algorithm over-approximates: everything visible is in the component ... -/
theorem visible_sub_component (g : Graph) (e x : String) (h : Visible g e x) : x ∈ component g e := by
  rw [component, mem_closure_iff _ _ (fun y x hx => by
      rcases List.mem_append.1 hx with hx | hx
      · exact List.mem_cons.2 (Or.inr (supersOf_sub g y x hx))
      · exact List.mem_cons.2 (Or.inr (subsOf_sub g y x hx))) e (List.mem_cons.2 (Or.inl rfl))]
  rcases h with h | h
  · exact Reach.mono (fun y x hx => List.mem_append.2 (Or.inl hx)) h
  · exact Reach.mono (fun y x hx => List.mem_append.2 (Or.inr hx))
      (Reach.rev (fun a b => (subs_supers_rev g b a).symm) h)

-- ... and the converse fails: see the b_spline witness below

/-- Monotonicity: a graph with fewer supertype edges (an unresolved SUBTYPE OF
    name) has a smaller 12.7.3 set; losing edges never admits a sibling. -/
theorem visible_mono (g₁ g₂ : Graph) (h : ∀ y x, x ∈ supersOf g₁ y → x ∈ supersOf g₂ y)
    (e x : String) (hv : Visible g₁ e x) : Visible g₂ e x := by
  rcases hv with hv | hv
  · exact Or.inl (Reach.mono h hv)
  · exact Or.inr (Reach.mono h hv)

theorem visible_nodup (g : Graph) (e : String) : (visible g e).Nodup :=
  nodup_addAll (closure_nodup (supersOf g) (e :: names g) e)

/-- the entity's own declaration is consulted first -/
theorem visible_head (g : Graph) (e : String) : (visible g e).head? = some e := by
  obtain ⟨t, ht⟩ := @addAll_prefix (ancestors g e) (descendants g e)
  obtain ⟨t', ht'⟩ := iter_prefix (supersOf g) (e :: names g).length [e]
  simp only [visible]; rw [ht]
  simp only [ancestors, closure]; rw [ht']; rfl

/- ───────────── resolution of `x.a` with x : e ───────────── -/

inductive Verdict
  | notFound
  | unique (owner : String)
  | ambiguous
deriving Repr, DecidableEq

def candidates (g : Graph) (e a : String) : List String :=
  (visible g e).filter (fun x => (attrsOf g x).contains a)

def resolve (g : Graph) (e a : String) : Verdict :=
  match candidates g e a with
  | [] => .notFound
  | [x] => .unique x
  | _ => .ambiguous

theorem mem_candidates_iff (g : Graph) (e a x : String) :
    x ∈ candidates g e a ↔ Visible g e x ∧ a ∈ attrsOf g x := by
  simp only [candidates, List.mem_filter, mem_visible_iff, List.contains_iff_mem]

/-- a `unique` verdict names the one entity in the 12.7.3 set that declares `a` -/
theorem resolve_unique (g : Graph) (e a x : String) (h : resolve g e a = .unique x) :
    Visible g e x ∧ a ∈ attrsOf g x ∧ ∀ y, Visible g e y → a ∈ attrsOf g y → y = x := by
  unfold resolve at h
  generalize hc : candidates g e a = cs at h
  match cs, h with
  | [], h => cases h
  | [z], h =>
    injection h with hzx
    subst hzx
    have hz : z ∈ candidates g e a := by rw [hc]; exact List.mem_singleton.2 rfl
    obtain ⟨hv, ha⟩ := (mem_candidates_iff g e a z).1 hz
    refine ⟨hv, ha, ?_⟩
    intro y hvy hay
    have hy : y ∈ candidates g e a := (mem_candidates_iff g e a y).2 ⟨hvy, hay⟩
    rw [hc] at hy
    exact List.mem_singleton.1 hy
  | _ :: _ :: _, h => cases h

/-- an `ambiguous` verdict means at least two entities in the 12.7.3 set declare `a` -/
theorem resolve_ambiguous (g : Graph) (e a : String) (h : resolve g e a = .ambiguous) :
    ∃ x y, x ≠ y ∧ Visible g e x ∧ a ∈ attrsOf g x ∧ Visible g e y ∧ a ∈ attrsOf g y := by
  have hnd : (candidates g e a).Nodup := List.Nodup.sublist List.filter_sublist (visible_nodup g e)
  unfold resolve at h
  generalize hc : candidates g e a = cs at h hnd
  match cs, h, hnd with
  | [], h, _ => cases h
  | [_], h, _ => cases h
  | x :: y :: l', _, hn =>
    rw [List.nodup_cons] at hn
    have hx : x ∈ candidates g e a := by rw [hc]; exact List.mem_cons.2 (Or.inl rfl)
    have hy : y ∈ candidates g e a := by
      rw [hc]; exact List.mem_cons.2 (Or.inr (List.mem_cons.2 (Or.inl rfl)))
    obtain ⟨hvx, hax⟩ := (mem_candidates_iff g e a x).1 hx
    obtain ⟨hvy, hay⟩ := (mem_candidates_iff g e a y).1 hy
    refine ⟨x, y, ?_, hvx, hax, hvy, hay⟩
    intro hxy
    exact hn.1 (by rw [hxy]; exact List.mem_cons.2 (Or.inl rfl))

/- ───────────── 12.7.4 group references: the exception ───────────── -/

/-- 12.7.4: "the entity name specified to the right of the group reference shall
    be an entity in the same subtype/supertype graph as that entity data type".
    That is the connected component: supertype and subtype edges in either
    direction, siblings included. -/
def SameGraph (g : Graph) (e x : String) : Prop := Reach (componentNext g) e x

theorem mem_component_iff (g : Graph) (e x : String) : x ∈ component g e ↔ SameGraph g e x :=
  mem_closure_iff _ _ (fun y x hx => by
      rcases List.mem_append.1 hx with hx | hx
      · exact List.mem_cons.2 (Or.inr (supersOf_sub g y x hx))
      · exact List.mem_cons.2 (Or.inr (subsOf_sub g y x hx))) e (List.mem_cons.2 (Or.inl rfl))

/-- the current algorithm is exactly right for group references ... -/
theorem component_is_group_scope (g : Graph) (e x : String) :
    x ∈ component g e ↔ SameGraph g e x := mem_component_iff g e x

/-- ... and 12.7.3 is the strictly smaller relation (witness: bspline below) -/
theorem visible_imp_sameGraph (g : Graph) (e x : String) (h : Visible g e x) : SameGraph g e x :=
  (mem_component_iff g e x).1 (visible_sub_component g e x h)

/-- decidable form of SameGraph for build-checked facts -/
def SameGraphB (g : Graph) (e x : String) : Bool := (component g e).contains x

/-- 12.7.3 for `x\E.a`: "the attribute name to the right of the attribute
    reference shall occur within the entity declaration for that partial
    complex entity data type" — E's own declaration, nothing inherited. -/
def resolveAfterGroup (g : Graph) (E a : String) : Verdict :=
  if (attrsOf g E).contains a then .unique E else .notFound

theorem resolveAfterGroup_unique (g : Graph) (E a x : String)
    (h : resolveAfterGroup g E a = .unique x) : x = E ∧ a ∈ attrsOf g E := by
  unfold resolveAfterGroup at h
  split at h
  · injection h with hx; exact ⟨hx.symm, List.contains_iff_mem.1 (by assumption)⟩
  · cases h

/- ───────────── build-checked witnesses ───────────── -/

/-- SUBTYPE OF chains from the published SMRLv8 ARM modules basic_geometry,
    geometric_model and b_spline_geometry; roots above
    Detailed_geometric_model_element omitted. -/
def bspline : Graph := [
  ⟨"Detailed_geometric_model_element", [], []⟩,
  ⟨"Curve",   ["Detailed_geometric_model_element"], []⟩,
  ⟨"Surface", ["Detailed_geometric_model_element"], []⟩,
  ⟨"Bounded_curve",   ["Curve"], []⟩,
  ⟨"Bounded_surface", ["Surface"], []⟩,
  ⟨"B_spline_curve",   ["Bounded_curve"],   ["degree", "control_points"]⟩,
  ⟨"B_spline_surface", ["Bounded_surface"], ["u_degree", "v_degree", "control_points"]⟩,
  ⟨"Rational_b_spline_curve",   ["B_spline_curve"],   ["weight_values"]⟩,
  ⟨"Rational_b_spline_surface", ["B_spline_surface"], ["weight_values"]⟩,
  ⟨"Curve_with_explicit_knots", ["B_spline_curve"], ["knot_multiplicities", "knot_values"]⟩,
  ⟨"Surface_with_explicit_knots", ["B_spline_surface"], ["u_knot_multiplicities", "u_knot_values", "v_knot_multiplicities", "v_knot_values"]⟩
]

-- 12.7.3 set of Rational_b_spline_surface, nearest first: itself, then each supertype level
#guard visible bspline "Rational_b_spline_surface" =
  ["Rational_b_spline_surface", "B_spline_surface", "Bounded_surface", "Surface",
   "Detailed_geometric_model_element"]
-- bss.weight_values with bss : Rational_b_spline_surface resolves to the surface's declaration
#guard resolve bspline "Rational_b_spline_surface" "weight_values" = .unique "Rational_b_spline_surface"
-- the sibling IS in the current algorithm's component ...
#guard "Rational_b_spline_curve" ∈ component bspline "Rational_b_spline_surface"
-- ... and NOT in the 12.7.3 set
#guard ¬ ("Rational_b_spline_curve" ∈ visible bspline "Rational_b_spline_surface")
-- the component holds every entity of the family; the 12.7.3 set holds five
#guard (component bspline "Rational_b_spline_surface").length = 11
#guard (visible bspline "Rational_b_spline_surface").length = 5
-- downward direction: x : B_spline_surface, x.weight_values is declared in a subtype
#guard resolve bspline "B_spline_surface" "weight_values" = .unique "Rational_b_spline_surface"
#guard visible bspline "B_spline_surface" =
  ["B_spline_surface", "Bounded_surface", "Surface", "Detailed_geometric_model_element",
   "Rational_b_spline_surface", "Surface_with_explicit_knots"]
-- upward direction: x : Rational_b_spline_surface, x.u_degree is inherited
#guard resolve bspline "Rational_b_spline_surface" "u_degree" = .unique "B_spline_surface"
-- not declared anywhere in the set
#guard resolve bspline "Rational_b_spline_surface" "knot_values" = .notFound
-- from the common root both declarations are visible: ambiguous, as 12.7.3 says
#guard resolve bspline "Detailed_geometric_model_element" "weight_values" = .ambiguous
-- 12.7.4: bss\Rational_b_spline_curve is a legal group reference (same graph) ...
#guard SameGraphB bspline "Rational_b_spline_surface" "Rational_b_spline_curve"
-- ... and bss\Rational_b_spline_curve.weight_values then resolves in the curve alone
#guard resolveAfterGroup bspline "Rational_b_spline_curve" "weight_values" = .unique "Rational_b_spline_curve"
-- while bss\B_spline_surface.weight_values is notFound: the partial value has no inherited attributes
#guard resolveAfterGroup bspline "B_spline_surface" "weight_values" = .notFound

/-- ISO 10303-11:2004 9.2.3.3 EXAMPLE: e12 SUBTYPE OF (e1, e2), both declare attr -/
def ex9233 : Graph := [
  ⟨"e1", [], ["attr"]⟩,
  ⟨"e2", [], ["attr"]⟩,
  ⟨"e12", ["e1", "e2"], []⟩
]
#guard resolve ex9233 "e12" "attr" = .ambiguous
#guard resolve ex9233 "e1" "attr" = .unique "e1"

/-- ISO 10303-11:2004 12.7.3 EXAMPLE: point / coloured_point -/
def ex1273 : Graph := [
  ⟨"point", [], ["x", "y", "z"]⟩,
  ⟨"coloured_point", ["point"], ["colour"]⟩
]
#guard resolve ex1273 "coloured_point" "x" = .unique "point"
#guard resolve ex1273 "point" "colour" = .unique "coloured_point"

/-- duplicate declarations of one name: supertype lists are unioned -/
def dup : Graph := [
  ⟨"a", [], ["p"]⟩,
  ⟨"b", [], ["q"]⟩,
  ⟨"c", ["a"], []⟩,
  ⟨"c", ["b"], []⟩
]
#guard visible dup "c" = ["c", "a", "b"]

/-- a cycle in a malformed schema terminates and is reported as visible both ways -/
def cyc : Graph := [ ⟨"a", ["b"], ["p"]⟩, ⟨"b", ["a"], ["q"]⟩ ]
#guard visible cyc "a" = ["a", "b"]

#print axioms mem_visible_iff
#print axioms resolve_unique
#print axioms visible_sub_component
#print axioms component_is_group_scope
#print axioms visible_mono
#print axioms resolveAfterGroup_unique

end Inheritance
