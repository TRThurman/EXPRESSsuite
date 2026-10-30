/-
  Interfaces.lean — ISO 10303-11:2004 10.1 b and clause 11: which identifiers
  are visible in a schema's scope, and when two of them clash.

  10.1 b: "Within a single scope an identifier may be declared, or explicitly
  interfaced (see clause 11), once only. An entity or type identifier which
  has been explicitly interfaced into the current schema via two, or more,
  routes which share the same initial declaration is counted only once."
  11.1: a USE with no names interfaces "all of the named data types declared
  within or use'd by the foreign schema", as if declared locally.
  11.2: a REFERENCE with no names makes visible "all the EXPRESS items
  declared in or use'd by the foreign schema" (ruling 2026-10-30: the clause
  wins); a reference'd item is not treated as local.
  11.3: use chains and renames (`USE FROM s2 (e2)` equals
  `USE FROM s1 (e1 AS e2)`); "it is not possible to chain reference's".
  11.4: implicitly interfaced items are not visible, so they are not modelled.

  Modelled over a workspace `String → Option Schema`:

    Export ws s i     the items schema s re-exports along USE chains (11.1,
                      11.3), as an inductive predicate.
    step ws F         one round of the implementation's loop
                      (`ExpressP11ScopeIndex.computeExports`): local named
                      data types plus what the USE interfaces bring from the
                      table F.  iterate ws n = step^n ∅.
    Visible ws s i    the items visible in s: locals, USE arrivals, REFERENCE
                      arrivals (11.2 reading above).
    visibleIn ws E s  the implementation's `visibleIn`, given an export table.
    Clash ws lf s k   two different declarations visible in s under one key.
    clashesIn         the implementation's `clashesIn`.

  Proved:
    iterate_sound        every entry the loop produces is in Export
    export_complete      every Export item appears after finitely many rounds
    export_of_stable     when a round adds nothing, the table contains Export
    stable_iff_export    so the loop's stop condition yields exactly Export
    export_ignores_reference   REFERENCE specifications never feed Export (11.3)
    mem_visibleIn_iff    visibleIn computes exactly Visible
    clash_iff            clashesIn reports exactly the Clash keys

  Keys: in a short form an entity name is case-significant and every other
  kind is compared without regard to case (rulings 2026-10-29/30); in a long
  form every identifier is compared without regard to case (WG11 N239).
  The implementation's tolerance of writing a non-entity item name in another
  case inside an interface list is outside the model (exact names here).
  Core Lean 4 only, no Mathlib.
-/
namespace Interfaces

inductive Kind
  | entity | type | function | procedure | rule | subtypeConstraint | constant
deriving DecidableEq, Repr

/-- Named data types: what USE may interface (clause 11, 11.1). -/
def Kind.namedType : Kind → Bool
  | .entity | .type => true
  | _ => false

/-- What REFERENCE may interface: "all declarations except rules and schemas" (clause 11); subtype constraints are not listed in 11.2. -/
def Kind.referenceable : Kind → Bool
  | .rule | .subtypeConstraint => false
  | _ => true

structure Decl where
  id   : Nat
  kind : Kind
  name : String
deriving DecidableEq, Repr

inductive Mode
  | use | ref
deriving DecidableEq, Repr

/-- An interface specification: `items = none` interfaces the whole schema; `some l` lists (written name, rename). -/
structure Spec where
  target : String
  mode   : Mode
  items  : Option (List (String × Option String))
deriving Repr

structure Schema where
  decls : List Decl
  specs : List Spec
deriving Repr

abbrev Workspace := String → Option Schema

/-- A declaration visible under an effective name. -/
structure Item where
  decl : Decl
  name : String
deriving DecidableEq, Repr

def rename (w : String) (r : Option String) : String := r.getD w

/-! ## Export: what a schema re-exports along USE chains -/

inductive Export (ws : Workspace) : String → Item → Prop
  | decl {s sch d} :
      ws s = some sch → d ∈ sch.decls → d.kind.namedType = true →
      Export ws s ⟨d, d.name⟩
  | useAll {s sch sp i} :
      ws s = some sch → sp ∈ sch.specs → sp.mode = .use → sp.items = none →
      Export ws sp.target i → Export ws s i
  | useItem {s sch sp l p i} :
      ws s = some sch → sp ∈ sch.specs → sp.mode = .use → sp.items = some l →
      p ∈ l → Export ws sp.target i → i.name = p.1 →
      Export ws s ⟨i.decl, rename p.1 p.2⟩

abbrev Table := String → List Item

def localsOf (sch : Schema) : List Item :=
  (sch.decls.filter (fun d => d.kind.namedType)).map (fun d => ⟨d, d.name⟩)

/-- Items of `pool` written as `p.1`, under the effective name `rename p.1 p.2`. -/
def pick (pool : List Item) (p : String × Option String) : List Item :=
  (pool.filter (fun i => i.name == p.1)).map (fun i => ⟨i.decl, rename p.1 p.2⟩)

/-- One round of the implementation's loop over one schema. -/
def step (ws : Workspace) (F : Table) (s : String) : List Item :=
  match ws s with
  | none => []
  | some sch =>
    localsOf sch ++
    sch.specs.flatMap (fun sp =>
      if sp.mode = .use then
        match sp.items with
        | none => F sp.target
        | some l => l.flatMap (pick (F sp.target))
      else [])

def iterate (ws : Workspace) : Nat → Table
  | 0 => fun _ => []
  | n + 1 => step ws (iterate ws n)

theorem mem_pick {pool : List Item} {p : String × Option String} {j : Item} :
    j ∈ pick pool p ↔ ∃ i, i ∈ pool ∧ i.name = p.1 ∧ j = ⟨i.decl, rename p.1 p.2⟩ := by
  unfold pick
  constructor
  · intro h
    obtain ⟨i, hi, rfl⟩ := List.mem_map.mp h
    obtain ⟨hmem, hname⟩ := List.mem_filter.mp hi
    exact ⟨i, hmem, by simpa using hname, rfl⟩
  · rintro ⟨i, hmem, hname, rfl⟩
    exact List.mem_map.mpr ⟨i, List.mem_filter.mpr ⟨hmem, by simpa using hname⟩, rfl⟩

theorem mem_localsOf {sch : Schema} {j : Item} :
    j ∈ localsOf sch ↔ ∃ d, d ∈ sch.decls ∧ d.kind.namedType = true ∧ j = ⟨d, d.name⟩ := by
  unfold localsOf
  constructor
  · intro h
    obtain ⟨d, hd, rfl⟩ := List.mem_map.mp h
    obtain ⟨hmem, hk⟩ := List.mem_filter.mp hd
    exact ⟨d, hmem, hk, rfl⟩
  · rintro ⟨d, hmem, hk, rfl⟩
    exact List.mem_map.mpr ⟨d, List.mem_filter.mpr ⟨hmem, hk⟩, rfl⟩

/-- What one USE specification contributes from a table. -/
theorem mem_step {ws : Workspace} {F : Table} {s : String} {j : Item} :
    j ∈ step ws F s ↔
      ∃ sch, ws s = some sch ∧
        (j ∈ localsOf sch ∨
         ∃ sp, sp ∈ sch.specs ∧ sp.mode = .use ∧
           ((sp.items = none ∧ j ∈ F sp.target) ∨
            ∃ l p, sp.items = some l ∧ p ∈ l ∧ j ∈ pick (F sp.target) p)) := by
  unfold step
  constructor
  · intro h
    split at h
    · simp [iterate] at h
    · rename_i sch hs
      refine ⟨sch, hs, ?_⟩
      rcases List.mem_append.mp h with hl | hr
      · exact Or.inl hl
      · right
        obtain ⟨sp, hsp, hj⟩ := List.mem_flatMap.mp hr
        refine ⟨sp, hsp, ?_⟩
        by_cases hm : sp.mode = .use
        · refine ⟨hm, ?_⟩
          simp only [hm, if_true] at hj
          split at hj
          · exact Or.inl ⟨by assumption, hj⟩
          · rename_i l hl
            obtain ⟨p, hp, hjp⟩ := List.mem_flatMap.mp hj
            exact Or.inr ⟨l, p, hl, hp, hjp⟩
        · simp [hm] at hj
  · rintro ⟨sch, hs, h⟩
    simp only [hs]
    apply List.mem_append.mpr
    rcases h with hl | ⟨sp, hsp, hm, hr⟩
    · exact Or.inl hl
    · right
      apply List.mem_flatMap.mpr
      refine ⟨sp, hsp, ?_⟩
      simp only [hm, if_true]
      rcases hr with ⟨hi, hj⟩ | ⟨l, p, hl, hp, hjp⟩
      · simp [hi, hj]
      · simp only [hl]
        exact List.mem_flatMap.mpr ⟨p, hp, hjp⟩

/-- Soundness of one round: with a sound table, every produced entry is in Export. -/
theorem step_sound {ws : Workspace} {F : Table}
    (hF : ∀ t j, j ∈ F t → Export ws t j) :
    ∀ s j, j ∈ step ws F s → Export ws s j := by
  intro s j h
  obtain ⟨sch, hs, h⟩ := mem_step.mp h
  rcases h with hl | ⟨sp, hsp, hm, hr⟩
  · obtain ⟨d, hd, hk, rfl⟩ := mem_localsOf.mp hl
    exact Export.decl hs hd hk
  · rcases hr with ⟨hi, hj⟩ | ⟨l, p, hl, hp, hjp⟩
    · exact Export.useAll hs hsp hm hi (hF _ _ hj)
    · obtain ⟨i, hi, hn, rfl⟩ := mem_pick.mp hjp
      exact Export.useItem hs hsp hm hl hp (hF _ _ hi) hn

theorem iterate_sound (ws : Workspace) : ∀ n s j, j ∈ iterate ws n s → Export ws s j := by
  intro n
  induction n with
  | zero => intro s j h; simp [iterate] at h
  | succ n ih => intro s j h; exact step_sound (fun t j hj => ih t j hj) s j h

/-- Monotonicity of a round in its table. -/
theorem step_mono {ws : Workspace} {F G : Table} (h : ∀ t j, j ∈ F t → j ∈ G t) :
    ∀ s j, j ∈ step ws F s → j ∈ step ws G s := by
  intro s j hj
  obtain ⟨sch, hs, hj⟩ := mem_step.mp hj
  apply mem_step.mpr
  refine ⟨sch, hs, ?_⟩
  rcases hj with hl | ⟨sp, hsp, hm, hr⟩
  · exact Or.inl hl
  · right
    refine ⟨sp, hsp, hm, ?_⟩
    rcases hr with ⟨hi, hjF⟩ | ⟨l, p, hl, hp, hjp⟩
    · exact Or.inl ⟨hi, h _ _ hjF⟩
    · right
      obtain ⟨i, hi, hn, rfl⟩ := mem_pick.mp hjp
      exact ⟨l, p, hl, hp, mem_pick.mpr ⟨i, h _ _ hi, hn, rfl⟩⟩

theorem iterate_mono (ws : Workspace) : ∀ n s j, j ∈ iterate ws n s → j ∈ iterate ws (n + 1) s := by
  intro n
  induction n with
  | zero => intro s j h; simp [iterate] at h
  | succ n ih => intro s j h; exact step_mono (fun t j hj => ih t j hj) s j h

theorem iterate_le (ws : Workspace) {m n : Nat} (hmn : m ≤ n) :
    ∀ s j, j ∈ iterate ws m s → j ∈ iterate ws n s := by
  induction hmn with
  | refl => intro s j h; exact h
  | step _ ih => intro s j h; exact iterate_mono ws _ s j (ih s j h)

/-- Completeness: every Export item appears after finitely many rounds. -/
theorem export_complete {ws : Workspace} {s : String} {i : Item} (h : Export ws s i) :
    ∃ n, i ∈ iterate ws n s := by
  induction h with
  | decl hs hd hk =>
    refine ⟨1, ?_⟩
    exact mem_step.mpr ⟨_, hs, Or.inl (mem_localsOf.mpr ⟨_, hd, hk, rfl⟩)⟩
  | useAll hs hsp hm hi _ ih =>
    obtain ⟨n, hn⟩ := ih
    exact ⟨n + 1, mem_step.mpr ⟨_, hs, Or.inr ⟨_, hsp, hm, Or.inl ⟨hi, hn⟩⟩⟩⟩
  | useItem hs hsp hm hl hp _ hn ih =>
    obtain ⟨n, hin⟩ := ih
    exact ⟨n + 1, mem_step.mpr ⟨_, hs, Or.inr ⟨_, hsp, hm, Or.inr ⟨_, _, hl, hp, mem_pick.mpr ⟨_, hin, hn, rfl⟩⟩⟩⟩⟩

/-- A table that a round cannot grow contains Export: the loop may stop at "no change". -/
theorem export_of_stable {ws : Workspace} {F : Table}
    (hstable : ∀ t j, j ∈ step ws F t → j ∈ F t) :
    ∀ s i, Export ws s i → i ∈ F s := by
  intro s i h
  induction h with
  | decl hs hd hk =>
    exact hstable _ _ (mem_step.mpr ⟨_, hs, Or.inl (mem_localsOf.mpr ⟨_, hd, hk, rfl⟩)⟩)
  | useAll hs hsp hm hi _ ih =>
    exact hstable _ _ (mem_step.mpr ⟨_, hs, Or.inr ⟨_, hsp, hm, Or.inl ⟨hi, ih⟩⟩⟩)
  | useItem hs hsp hm hl hp _ hn ih =>
    exact hstable _ _ (mem_step.mpr ⟨_, hs, Or.inr ⟨_, hsp, hm, Or.inr ⟨_, _, hl, hp, mem_pick.mpr ⟨_, ih, hn, rfl⟩⟩⟩⟩)

/-- The loop's stop condition: a sound, stable table is exactly Export. -/
theorem stable_iff_export {ws : Workspace} {F : Table}
    (hsound : ∀ t j, j ∈ F t → Export ws t j)
    (hstable : ∀ t j, j ∈ step ws F t → j ∈ F t) :
    ∀ s i, i ∈ F s ↔ Export ws s i :=
  fun s i => ⟨hsound s i, export_of_stable hstable s i⟩

/-- In particular, when round n + 1 adds nothing to round n, round n is Export. -/
theorem iterate_stable_is_export (ws : Workspace) (n : Nat)
    (hstable : ∀ t j, j ∈ iterate ws (n + 1) t → j ∈ iterate ws n t) :
    ∀ s i, i ∈ iterate ws n s ↔ Export ws s i :=
  stable_iff_export (iterate_sound ws n) hstable

/-! ## 11.3: reference does not chain — Export never looks at a REFERENCE specification -/

def dropRef (ws : Workspace) : Workspace :=
  fun s => (ws s).map (fun sch => { sch with specs := sch.specs.filter (fun sp => sp.mode == Mode.use) })

theorem dropRef_some {ws : Workspace} {s : String} {sch : Schema} (h : ws s = some sch) :
    dropRef ws s = some { sch with specs := sch.specs.filter (fun sp => sp.mode == Mode.use) } := by
  simp [dropRef, h]

theorem export_ignores_reference (ws : Workspace) (s : String) (i : Item) :
    Export (dropRef ws) s i ↔ Export ws s i := by
  constructor
  · intro h
    induction h with
    | decl hs hd hk =>
      simp only [dropRef, Option.map_eq_some_iff] at hs
      obtain ⟨sch, hs, rfl⟩ := hs
      exact Export.decl hs hd hk
    | useAll hs hsp hm hi _ ih =>
      simp only [dropRef, Option.map_eq_some_iff] at hs
      obtain ⟨sch, hs, rfl⟩ := hs
      exact Export.useAll hs (List.mem_filter.mp hsp).1 hm hi ih
    | useItem hs hsp hm hl hp _ hn ih =>
      simp only [dropRef, Option.map_eq_some_iff] at hs
      obtain ⟨sch, hs, rfl⟩ := hs
      exact Export.useItem hs (List.mem_filter.mp hsp).1 hm hl hp ih hn
  · intro h
    induction h with
    | decl hs hd hk => exact Export.decl (dropRef_some hs) hd hk
    | useAll hs hsp hm hi _ ih =>
      exact Export.useAll (dropRef_some hs) (List.mem_filter.mpr ⟨hsp, by simp [hm]⟩) hm hi ih
    | useItem hs hsp hm hl hp _ hn ih =>
      exact Export.useItem (dropRef_some hs) (List.mem_filter.mpr ⟨hsp, by simp [hm]⟩) hm hl hp ih hn

/-! ## Visible: the scope of a schema -/

/-- What a REFERENCE FROM t may name: t's referenceable declarations and everything t use's (11.2). -/
def Referenceable (ws : Workspace) (t : String) (i : Item) : Prop :=
  (∃ sch d, ws t = some sch ∧ d ∈ sch.decls ∧ d.kind.referenceable = true ∧ i = ⟨d, d.name⟩) ∨
  Export ws t i

inductive Visible (ws : Workspace) : String → Item → Prop
  | decl {s sch d} :
      ws s = some sch → d ∈ sch.decls → Visible ws s ⟨d, d.name⟩
  | useAll {s sch sp i} :
      ws s = some sch → sp ∈ sch.specs → sp.mode = .use → sp.items = none →
      Export ws sp.target i → Visible ws s i
  | useItem {s sch sp l p i} :
      ws s = some sch → sp ∈ sch.specs → sp.mode = .use → sp.items = some l →
      p ∈ l → Export ws sp.target i → i.name = p.1 →
      Visible ws s ⟨i.decl, rename p.1 p.2⟩
  | refAll {s sch sp i} :
      ws s = some sch → sp ∈ sch.specs → sp.mode = .ref → sp.items = none →
      Referenceable ws sp.target i → Visible ws s i
  | refItem {s sch sp l p i} :
      ws s = some sch → sp ∈ sch.specs → sp.mode = .ref → sp.items = some l →
      p ∈ l → Referenceable ws sp.target i → i.name = p.1 →
      Visible ws s ⟨i.decl, rename p.1 p.2⟩

def referenceableIn (ws : Workspace) (E : Table) (t : String) : List Item :=
  (match ws t with
   | none => []
   | some sch => (sch.decls.filter (fun d => d.kind.referenceable)).map (fun d => ⟨d, d.name⟩)) ++ E t

def visibleIn (ws : Workspace) (E : Table) (s : String) : List Item :=
  match ws s with
  | none => []
  | some sch =>
    sch.decls.map (fun d => ⟨d, d.name⟩) ++
    sch.specs.flatMap (fun sp =>
      let pool := if sp.mode = .use then E sp.target else referenceableIn ws E sp.target
      match sp.items with
      | none => pool
      | some l => l.flatMap (pick pool))

theorem mem_referenceableIn_iff {ws : Workspace} {E : Table}
    (hE : ∀ t j, j ∈ E t ↔ Export ws t j) {t : String} {i : Item} :
    i ∈ referenceableIn ws E t ↔ Referenceable ws t i := by
  unfold referenceableIn Referenceable
  rw [List.mem_append, hE]
  constructor
  · rintro (h | h)
    · left
      split at h
      · simp [iterate] at h
      · rename_i sch hs
        obtain ⟨d, hd, rfl⟩ := List.mem_map.mp h
        obtain ⟨hmem, hk⟩ := List.mem_filter.mp hd
        exact ⟨sch, d, hs, hmem, hk, rfl⟩
    · exact Or.inr h
  · rintro (⟨sch, d, hs, hd, hk, rfl⟩ | h)
    · left
      simp only [hs]
      exact List.mem_map.mpr ⟨d, List.mem_filter.mpr ⟨hd, hk⟩, rfl⟩
    · exact Or.inr h

theorem mem_visibleIn_iff {ws : Workspace} {E : Table}
    (hE : ∀ t j, j ∈ E t ↔ Export ws t j) {s : String} {i : Item} :
    i ∈ visibleIn ws E s ↔ Visible ws s i := by
  constructor
  · intro h
    unfold visibleIn at h
    split at h
    · simp [iterate] at h
    · rename_i sch hs
      rcases List.mem_append.mp h with hl | hflat
      · obtain ⟨d, hd, rfl⟩ := List.mem_map.mp hl
        exact Visible.decl hs hd
      · obtain ⟨sp, hsp, hj⟩ := List.mem_flatMap.mp hflat
        by_cases hm : sp.mode = .use
        · simp only [hm, if_true] at hj
          split at hj
          · exact Visible.useAll hs hsp hm (by assumption) ((hE _ _).mp hj)
          · rename_i l hl
            obtain ⟨p, hp, hjp⟩ := List.mem_flatMap.mp hj
            obtain ⟨j, hjE, hn, rfl⟩ := mem_pick.mp hjp
            exact Visible.useItem hs hsp hm hl hp ((hE _ _).mp hjE) hn
        · have href : sp.mode = .ref := by
            cases h : sp.mode with
            | use => exact absurd h hm
            | ref => rfl
          simp only [hm, if_false] at hj
          split at hj
          · exact Visible.refAll hs hsp href (by assumption) ((mem_referenceableIn_iff hE).mp hj)
          · rename_i l hl
            obtain ⟨p, hp, hjp⟩ := List.mem_flatMap.mp hj
            obtain ⟨j, hjR, hn, rfl⟩ := mem_pick.mp hjp
            exact Visible.refItem hs hsp href hl hp ((mem_referenceableIn_iff hE).mp hjR) hn
  · intro h
    induction h with
    | decl hs hd =>
      unfold visibleIn
      simp only [hs]
      exact List.mem_append.mpr (Or.inl (List.mem_map.mpr ⟨_, hd, rfl⟩))
    | useAll hs hsp hm hi hex =>
      unfold visibleIn
      simp only [hs]
      refine List.mem_append.mpr (Or.inr (List.mem_flatMap.mpr ⟨_, hsp, ?_⟩))
      simp only [hm, if_true, hi]
      exact (hE _ _).mpr hex
    | useItem hs hsp hm hl hp hex hn =>
      unfold visibleIn
      simp only [hs]
      refine List.mem_append.mpr (Or.inr (List.mem_flatMap.mpr ⟨_, hsp, ?_⟩))
      simp only [hm, if_true, hl]
      exact List.mem_flatMap.mpr ⟨_, hp, mem_pick.mpr ⟨_, (hE _ _).mpr hex, hn, rfl⟩⟩
    | refAll hs hsp hm hi href =>
      unfold visibleIn
      simp only [hs]
      refine List.mem_append.mpr (Or.inr (List.mem_flatMap.mpr ⟨_, hsp, ?_⟩))
      simp only [hm, hi, eq_false (show ¬ Mode.ref = Mode.use by decide), if_false]
      exact (mem_referenceableIn_iff hE).mpr href
    | refItem hs hsp hm hl hp href hn =>
      unfold visibleIn
      simp only [hs]
      refine List.mem_append.mpr (Or.inr (List.mem_flatMap.mpr ⟨_, hsp, ?_⟩))
      simp only [hm, hl, eq_false (show ¬ Mode.ref = Mode.use by decide), if_false]
      exact List.mem_flatMap.mpr ⟨_, hp, mem_pick.mpr ⟨_, (mem_referenceableIn_iff hE).mpr href, hn, rfl⟩⟩

/-! ## Clash: one identifier, two declarations -/

def lower (s : String) : String := s.map Char.toLower

/-- Identifier key: long forms fold case for every kind (N239); short forms keep entity case (ruling). -/
def key (longForm : Bool) (i : Item) : String :=
  if longForm then lower i.name
  else if i.decl.kind = .entity then i.name else lower i.name

def Clash (ws : Workspace) (longForm : Bool) (s : String) (k : String) : Prop :=
  ∃ i j, Visible ws s i ∧ Visible ws s j ∧ key longForm i = k ∧ key longForm j = k ∧ i.decl.id ≠ j.decl.id

/-- The implementation's grouping: keys under which two visible items have different declarations. -/
def clashesIn (ws : Workspace) (E : Table) (longForm : Bool) (s : String) : List String :=
  let vis := visibleIn ws E s
  (vis.map (key longForm)).filter (fun k =>
    vis.any (fun i => key longForm i == k && vis.any (fun j => key longForm j == k && i.decl.id != j.decl.id)))

theorem clash_iff {ws : Workspace} {E : Table}
    (hE : ∀ t j, j ∈ E t ↔ Export ws t j) {longForm : Bool} {s k : String} :
    k ∈ clashesIn ws E longForm s ↔ Clash ws longForm s k := by
  unfold clashesIn Clash
  simp only [List.mem_filter, List.mem_map, List.any_eq_true, Bool.and_eq_true, beq_iff_eq, bne_iff_ne]
  constructor
  · rintro ⟨-, i, hi, hki, j, hj, hkj, hij⟩
    exact ⟨i, j, (mem_visibleIn_iff hE).mp hi, (mem_visibleIn_iff hE).mp hj, hki, hkj, hij⟩
  · rintro ⟨i, j, hi, hj, hki, hkj, hij⟩
    have hi' := (mem_visibleIn_iff hE).mpr hi
    have hj' := (mem_visibleIn_iff hE).mpr hj
    exact ⟨⟨i, hi', hki⟩, i, hi', hki, j, hj', hkj, hij⟩

/-! ## Build-checked examples -/

def ofList (l : List (String × Schema)) : Workspace :=
  fun n => (l.find? (fun p => p.1 == n)).map (·.2)

def E (id : Nat) (name : String) : Decl := ⟨id, .entity, name⟩
def T (id : Nat) (name : String) : Decl := ⟨id, .type, name⟩
def useAll (t : String) : Spec := ⟨t, .use, none⟩
def refAll (t : String) : Spec := ⟨t, .ref, none⟩
def useSome (t : String) (l : List (String × Option String)) : Spec := ⟨t, .use, some l⟩
def refSome (t : String) (l : List (String × Option String)) : Spec := ⟨t, .ref, some l⟩

/-- Enough rounds for every example below (each has fewer than eight schemas and no rename cycle). -/
def table (ws : Workspace) : Table := iterate ws 8

def clashes (ws : Workspace) (lf : Bool) (s : String) : List String :=
  (clashesIn ws (table ws) lf s).eraseDups

-- The 3074 shape: both declarations are visible in P400 only.
def w3074 : Workspace := ofList [
  ("Module_arm", ⟨[E 1 "Assignment_object_relationship"], []⟩),
  ("Ap_arm", ⟨[E 2 "Assignment_object_relationship", E 3 "Other"], []⟩),
  ("P400", ⟨[], [useAll "Ap_arm", useAll "Module_arm"]⟩)]
#guard clashes w3074 false "P400" = ["Assignment_object_relationship"]
#guard clashes w3074 false "Ap_arm" = []
#guard clashes w3074 false "Module_arm" = []

-- 10.1 b, second sentence: one declaration by three routes counts once.
def wRoutes : Workspace := ofList [
  ("S1", ⟨[E 1 "e"], []⟩),
  ("S2", ⟨[], [useAll "S1"]⟩),
  ("S3", ⟨[], [useAll "S1", useAll "S2", refSome "S1" [("e", none)]]⟩)]
#guard clashes wRoutes false "S3" = []

-- 11.3: reference does not chain; 11.2: a full reference sees what the foreign schema use's.
def wChain : Workspace := ofList [
  ("A", ⟨[E 1 "x"], []⟩),
  ("B", ⟨[], [refAll "A"]⟩),
  ("C", ⟨[E 2 "x"], [useAll "B"]⟩),
  ("D", ⟨[E 3 "x"], [refAll "B"]⟩),
  ("U", ⟨[], [useAll "A"]⟩),
  ("R", ⟨[E 4 "x"], [refAll "U"]⟩)]
#guard clashes wChain false "C" = []
#guard clashes wChain false "D" = []
#guard clashes wChain false "R" = ["x"]

-- Explicit lists filter; renames clash under the effective name and free the original.
def wLists : Workspace := ofList [
  ("A", ⟨[E 1 "x", E 2 "y"], []⟩),
  ("C", ⟨[E 3 "x"], [useSome "A" [("y", none)], refSome "A" [("y", none)]]⟩),
  ("Z", ⟨[E 4 "z"], [useSome "A" [("x", some "z")]]⟩),
  ("X", ⟨[E 5 "x"], [useSome "A" [("x", some "z")]]⟩)]
#guard clashes wLists false "C" = []
#guard clashes wLists false "Z" = ["z"]
#guard clashes wLists false "X" = []

-- 11.3 EXAMPLE 2: USE FROM s2 (e2) is USE FROM s1 (e1 AS e2).
def wRename : Workspace := ofList [
  ("s1", ⟨[E 1 "e1"], []⟩),
  ("s2", ⟨[], [useSome "s1" [("e1", some "e2")]]⟩),
  ("s3", ⟨[], [useSome "s2" [("e2", none)]]⟩),
  ("s3'", ⟨[], [useSome "s1" [("e1", some "e2")]]⟩)]
#guard visibleIn wRename (table wRename) "s3" = visibleIn wRename (table wRename) "s3'"
#guard visibleIn wRename (table wRename) "s3" = [⟨E 1 "e1", "e2"⟩]

-- Short form keys: entity names case-significant, type names not; one namespace across kinds.
def wCase : Workspace := ofList [
  ("A", ⟨[E 1 "Mesh", T 2 "cell", T 3 "foo"], []⟩),
  ("C", ⟨[E 4 "mesh", T 5 "Cell", E 6 "foo"], [useAll "A"]⟩),
  ("F", ⟨[E 7 "Foo"], [useAll "A"]⟩)]
#guard clashes wCase false "C" = ["cell", "foo"]
#guard clashes wCase false "F" = []

-- Long form keys fold case for every kind (N239).
def wLong : Workspace := ofList [("x_lf", ⟨[E 1 "a", E 2 "A"], []⟩)]
#guard clashes wLong true "x_lf" = ["a"]
#guard clashes wLong false "x_lf" = []

-- A USE cycle terminates and still propagates.
def wCycle : Workspace := ofList [
  ("A", ⟨[E 1 "a"], [useAll "B"]⟩),
  ("B", ⟨[E 2 "b"], [useAll "A"]⟩),
  ("C", ⟨[E 3 "b"], [useAll "A"]⟩)]
#guard clashes wCycle false "C" = ["b"]
#guard clashes wCycle false "A" = []

#print axioms iterate_sound
#print axioms export_complete
#print axioms export_of_stable
#print axioms export_ignores_reference
#print axioms mem_visibleIn_iff
#print axioms clash_iff

end Interfaces
