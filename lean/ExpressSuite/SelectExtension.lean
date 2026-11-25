/-
  SelectExtension.lean — the domain of a SELECT data type in a family of
  extensions (ISO 10303-11:2004 8.4.1, 8.4.2, 13.3.2), as the type builder
  computes it (`selectMembers` in src/language/type-system/express-type-builder.ts).

  A select declares its own items; an extension, `SELECT BASED_ON base WITH (...)`,
  declares its WITH items and names its base. Its domain is
  - `declared`: the items it declares, after those its base declares, up the
    chain of bases (8.4.2: the base's items, extended by the WITH items); and
  - `added`: the items that the selects based on it declare, transitively
    (13.3.2 counts "items added to that domain by other select data types
    based on the select data type").
  An extension is based on its base as declared. The items that the other
  extensions of that base add are not part of its domain: `declared_append`
  shows that a further select never changes what another select declares, so
  a sibling reaches a domain only through `added`, that is, only the domain of
  a select it is based on.

  Which selects form the family is a question of the schema in which the domain
  is taken (clause 11). The family is the selects of that schema's
  specification: the declarations visible in it (11.1 to 11.3) and those
  implicitly interfaced (11.4), drawn from the schemas it reaches through its
  interface specifications, never from a schema that merely happens to be
  loaded. `step` is one round of 11.4 and `specIter` iterates it; a stable set
  is `Closed` (`closed_of_stable`), and a closed set holds the base of every
  extension it holds (`closed_base`, 11.4.2). The type builder follows each
  BASED_ON reference to its base and takes the extensions in the
  specification (`domainFollow`); `domainFollow_eq` proves that equal to the
  domain over the specification's own selects (`domainIn`). Interfacing a
  select does not interface its selectable items (11.4.2), so in the schema a
  select holds only the items of the specification (`prune`, `domainPruned`).

  The `#guard`s decide, with the proved relation `spec`, the redeclarations of
  the unit tests "redeclared attribute type specialization: select extensions"
  and the multi-schema ones (src/test/redeclaration-specialization.test.ts),
  and compute the specifications of src/test/implicit-interfaces.test.ts,
  among them the two EXAMPLEs of 11.4 and 11.4.2.
-/
import ExpressSuite.Specialisation

namespace SelectExtension

/-- One SELECT declaration: its name, the select it is BASED_ON (none for
    `SELECT (...)`), and the items of its own list or WITH list. -/
structure Decl where
  name : String
  base : Option String
  own  : List Ty

abbrev Family := List Decl

/-- The declaration named `n`, the first one when the family holds several. -/
def lookup (f : Family) (n : String) : Option Decl := f.find? (fun d => d.name == n)

/-- The items `n` declares, after those its bases declare; `fuel` bounds the
    chain of bases (a cyclic chain stops). -/
def declared (f : Family) : Nat → String → List Ty
  | 0, _ => []
  | fuel + 1, n =>
    match lookup f n with
    | none => []
    | some d =>
      (match d.base with
       | some b => declared f fuel b
       | none => []) ++ d.own

/-- The items the selects based on `n` declare, transitively. -/
def added (f : Family) : Nat → String → List Ty
  | 0, _ => []
  | fuel + 1, n =>
    (f.filter (fun e => e.base == some n)).foldr (fun e acc => e.own ++ added f fuel e.name ++ acc) []

/-- Enough fuel for any chain without a cycle. -/
def fuel (f : Family) : Nat := f.length + 1

/-- The domain of the select named `n`. -/
def domain (f : Family) (n : String) : List Ty := declared f (fuel f) n ++ added f (fuel f) n

/-- The select named `n` as a `Ty`, the form the type builder gives it. -/
def asTy (f : Family) (n : String) : Ty := .defn n (.sel n (domain f n))

/-- `lookup` in a family extended by a declaration of another name. -/
theorem lookup_append (f : Family) (d : Decl) (n : String) (h : n ≠ d.name) :
    lookup (f ++ [d]) n = lookup f n := by
  unfold lookup
  rw [List.find?_append]
  cases hf : f.find? (fun d => d.name == n) with
  | some x => rfl
  | none =>
    simp only [Option.none_or, List.find?_cons, List.find?_nil]
    have : (d.name == n) = false := by
      simp only [beq_eq_false_iff_ne, ne_eq]
      exact fun e => h e.symm
    rw [this]

/-- A further select `d`, whose name no declaration of `f` uses as its own
    name or as its base, never changes what a select of `f` declares: an
    extension does not know the other selects based on its base (8.4.2). -/
theorem declared_append (f : Family) (d : Decl)
    (hfresh : ∀ x ∈ f, x.name ≠ d.name ∧ x.base ≠ some d.name) :
    ∀ (k : Nat) (n : String), n ≠ d.name → declared (f ++ [d]) k n = declared f k n := by
  intro k
  induction k with
  | zero => intro n _; rfl
  | succ k ih =>
    intro n hn
    simp only [declared]
    rw [lookup_append f d n hn]
    cases hl : lookup f n with
    | none => rfl
    | some x =>
      simp only
      cases hb : x.base with
      | none => rfl
      | some b =>
        simp only
        have hx : x ∈ f := List.mem_of_find?_eq_some hl
        have hbd : b ≠ d.name := by
          intro e
          exact (hfresh x hx).2 (by rw [hb, e])
        rw [ih b hbd]

#print axioms declared_append

/- ── The specification of a schema (clause 11, 11.4) ── -/

/-- A schema-level declaration of the universe (the schemas the checked schema
    reaches through its interface specifications), as 11.4 sees it. -/
structure Item where
  name : String
  /-- what interfacing it interfaces by reference (11.4.1 to 11.4.6); for an
      extension, its BASED_ON base; never a select's own selectable items -/
  refs : List String
  /-- a select's selection list (its own list, or the WITH list of an extension) -/
  selection : List String
  /-- a rule's FOR list -/
  forList : List String
  /-- a subtype constraint's entity -/
  constrains : List String

abbrev Universe := List Item

/-- One round of 11.4 over the names `x`: add every item of the universe that an
    item of `x` refers to (11.4.1 to 11.4.6), every select whose selection list
    holds an item of `x` (11.4.2, 11.4.3), every subtype constraint of an entity
    of `x` and every rule whose FOR list lies in `x` (11.4.3). -/
def step (u : Universe) (x : List String) : List String :=
  x ++ (u.filter (fun i =>
      !x.contains i.name &&
      (u.any (fun d => x.contains d.name && d.refs.contains i.name)
        || i.selection.any x.contains
        || i.constrains.any x.contains
        || (!i.forList.isEmpty && i.forList.all x.contains)))).map (·.name)

/-- `step` iterated `k` times from the visible declarations `x`. -/
def specIter (u : Universe) (x : List String) : Nat → List String
  | 0 => x
  | k + 1 => specIter u (step u x) k

/-- A set to which `step` adds nothing: closed under 11.4. -/
def Closed (u : Universe) (x : List String) : Prop := ∀ n ∈ step u x, n ∈ x

/-- The implementation iterates until a round adds nothing; that set is closed. -/
theorem closed_of_stable (u : Universe) (x : List String) (h : step u x = x) : Closed u x := by
  intro n hn
  rw [h] at hn
  exact hn

#print axioms closed_of_stable

/-- In a closed set, whatever an interfaced item refers to is interfaced. -/
theorem closed_refs (u : Universe) (x : List String) (hc : Closed u x)
    (d : Item) (hd : d ∈ u) (hdx : d.name ∈ x) (i : Item) (hi : i ∈ u) (hr : i.name ∈ d.refs) :
    i.name ∈ x := by
  apply Classical.byContradiction
  intro hni
  apply hni
  apply hc
  unfold step
  simp only [List.mem_append, List.mem_map, List.mem_filter]
  right
  refine ⟨i, ⟨hi, ?_⟩, rfl⟩
  simp only [Bool.and_eq_true, Bool.not_eq_eq_eq_not, Bool.not_true, Bool.or_eq_true, List.any_eq_true]
  refine ⟨?_, Or.inl (Or.inl (Or.inl ⟨d, hd, ?_⟩))⟩
  · simpa using hni
  · simp [hdx, hr]

#print axioms closed_refs

/-- Every BASED_ON of the family is a reference of the universe (11.4.2: an
    interfaced extension interfaces the type it extends), and every base is
    declared in the universe. -/
def BasesAreRefs (f : Family) (u : Universe) : Prop :=
  ∀ d ∈ f, ∀ b, d.base = some b →
    (∃ i ∈ u, i.name = d.name ∧ b ∈ i.refs) ∧ (∃ j ∈ u, j.name = b)

/-- A set holding the base of every select of the family it holds. -/
def BaseClosed (f : Family) (x : List String) : Prop :=
  ∀ d ∈ f, d.name ∈ x → ∀ b, d.base = some b → b ∈ x

/-- A closed specification holds the base of every extension it holds. -/
theorem closed_base (f : Family) (u : Universe) (x : List String)
    (hc : Closed u x) (hb : BasesAreRefs f u) : BaseClosed f x := by
  intro d hd hdx b hbase
  obtain ⟨⟨i, hi, hin, hir⟩, ⟨j, hj, hjn⟩⟩ := hb d hd b hbase
  have := closed_refs u x hc i hi (by rw [hin]; exact hdx) j hj (by rw [hjn]; exact hir)
  rwa [hjn] at this

#print axioms closed_base

/-- The family restricted to the specification `x`. -/
def inSpec (f : Family) (x : List String) : Family := f.filter (fun d => x.contains d.name)

/-- The domain over the specification's own selects. -/
def domainIn (f : Family) (x : List String) (n : String) : List Ty :=
  declared (inSpec f x) (fuel f) n ++ added (inSpec f x) (fuel f) n

/-- What the type builder computes: each BASED_ON reference is followed to its
    base in the whole family, and the extensions taken are those in `x`. -/
def addedFollow (f : Family) (x : List String) : Nat → String → List Ty
  | 0, _ => []
  | k + 1, n =>
    (f.filter (fun e => x.contains e.name && e.base == some n)).foldr
      (fun e acc => e.own ++ addedFollow f x k e.name ++ acc) []

def domainFollow (f : Family) (x : List String) (n : String) : List Ty :=
  declared f (fuel f) n ++ addedFollow f x (fuel f) n

theorem lookup_inSpec (f : Family) (x : List String) (n : String) (hn : n ∈ x) :
    lookup (inSpec f x) n = lookup f n := by
  unfold lookup inSpec
  induction f with
  | nil => rfl
  | cons d t ih =>
    by_cases hdn : d.name = n
    · have hk : x.contains d.name = true := by rw [hdn]; simpa using hn
      have hp : (d.name == n) = true := by simp [hdn]
      rw [List.filter_cons_of_pos (p := fun d : Decl => x.contains d.name) hk,
        List.find?_cons_of_pos (p := fun d : Decl => d.name == n) hp,
        List.find?_cons_of_pos (p := fun d : Decl => d.name == n) hp]
    · have hp : ¬ ((d.name == n) = true) := by simpa using hdn
      by_cases hk : x.contains d.name = true
      · rw [List.filter_cons_of_pos (p := fun d : Decl => x.contains d.name) hk,
          List.find?_cons_of_neg (p := fun d : Decl => d.name == n) hp,
          List.find?_cons_of_neg (p := fun d : Decl => d.name == n) hp, ih]
      · rw [List.filter_cons_of_neg (p := fun d : Decl => x.contains d.name) hk,
          List.find?_cons_of_neg (p := fun d : Decl => d.name == n) hp, ih]

theorem declared_inSpec (f : Family) (x : List String) (hbc : BaseClosed f x) :
    ∀ (k : Nat) (n : String), n ∈ x → declared (inSpec f x) k n = declared f k n := by
  intro k
  induction k with
  | zero => intro n _; rfl
  | succ k ih =>
    intro n hn
    simp only [declared]
    rw [lookup_inSpec f x n hn]
    cases hl : lookup f n with
    | none => rfl
    | some d =>
      simp only
      cases hb : d.base with
      | none => rfl
      | some b =>
        simp only
        have hd : d ∈ f := List.mem_of_find?_eq_some hl
        have hname : d.name = n := by
          have := List.find?_some hl
          simpa using this
        have hbx : b ∈ x := hbc d hd (by rw [hname]; exact hn) b hb
        rw [ih b hbx]

theorem added_inSpec (f : Family) (x : List String) :
    ∀ (k : Nat) (n : String), added (inSpec f x) k n = addedFollow f x k n := by
  intro k
  induction k with
  | zero => intro n; rfl
  | succ k ih =>
    intro n
    simp only [added, addedFollow, inSpec, List.filter_filter]
    have hfun : (fun e acc => e.own ++ added (List.filter (fun d => x.contains d.name) f) k e.name ++ acc)
        = (fun (e : Decl) acc => e.own ++ addedFollow f x k e.name ++ acc) := by
      funext e acc
      have := ih e.name
      simp only [inSpec] at this
      rw [this]
    rw [hfun]
    congr 1
    congr 1
    funext e
    exact Bool.and_comm _ _

/-- The type builder's domain equals the domain over the specification's own
    selects, for a specification that holds the bases of its extensions. -/
theorem domainFollow_eq (f : Family) (x : List String) (hbc : BaseClosed f x) (n : String) (hn : n ∈ x) :
    domainFollow f x n = domainIn f x n := by
  unfold domainFollow domainIn
  rw [declared_inSpec f x hbc (fuel f) n hn, added_inSpec f x (fuel f) n]

#print axioms domainFollow_eq

/-- The name an item of a select list carries (an entity or a defined type). -/
def nameOf : Ty → String
  | .ent n _ => n
  | .defn n _ => n
  | .sel n _ => n
  | _ => ""

/-- Interfacing a select does not interface its selectable items (11.4.2): in
    the schema with specification `x`, only the items in `x` remain. -/
def prune (x : List String) (items : List Ty) : List Ty := items.filter (fun t => x.contains (nameOf t))

/-- The type builder prunes each list as it reads it; that keeps what pruning
    the joined lists keeps. -/
theorem prune_append (x : List String) (a b : List Ty) : prune x (a ++ b) = prune x a ++ prune x b := by
  unfold prune
  exact List.filter_append a b

/-- The domain of a select in the schema with specification `x`. -/
def domainPruned (f : Family) (x : List String) (n : String) : List Ty := prune x (domainIn f x n)

theorem domainPruned_follow (f : Family) (x : List String) (hbc : BaseClosed f x) (n : String) (hn : n ∈ x) :
    prune x (domainFollow f x n) = domainPruned f x n := by
  unfold domainPruned
  rw [domainFollow_eq f x hbc n hn]

#print axioms prune_append
#print axioms domainPruned_follow

/- ── The family of the unit tests ──
   TYPE root_select  = EXTENSIBLE GENERIC_ENTITY SELECT;
   TYPE ext_a_select = EXTENSIBLE GENERIC_ENTITY SELECT BASED_ON root_select WITH (a1, a2);
   TYPE ext_b_select = SELECT BASED_ON root_select WITH (b1, b2);
   TYPE ext_c_select = SELECT BASED_ON root_select WITH (c1);
   TYPE ext_d_select = SELECT BASED_ON ext_a_select WITH (d1, d2);            -/
def item (n : String) : Ty := .ent n []
def family : Family :=
  [ ⟨"root_select", none, []⟩,
    ⟨"ext_a_select", some "root_select", [item "a1", item "a2"]⟩,
    ⟨"ext_b_select", some "root_select", [item "b1", item "b2"]⟩,
    ⟨"ext_c_select", some "root_select", [item "c1"]⟩,
    ⟨"ext_d_select", some "ext_a_select", [item "d1", item "d2"]⟩ ]
def T (n : String) : Ty := asTy family n

-- the base admits every extension's items; an extension its bases', its own and its extensions'
#guard spec (T "ext_c_select") (T "root_select") == true
#guard spec (item "d2") (T "root_select") == true
#guard spec (item "c1") (T "ext_c_select") == true
#guard spec (item "d1") (T "ext_a_select") == true
#guard spec (T "ext_d_select") (T "ext_a_select") == true
#guard spec (item "a1") (T "ext_d_select") == true
#guard spec (T "ext_a_select") (T "ext_d_select") == true

-- an extension does not admit the items the other extensions of its base add
#guard spec (T "ext_b_select") (T "ext_c_select") == false
#guard spec (item "b1") (T "ext_c_select") == false
#guard spec (item "b1") (T "ext_d_select") == false
#guard spec (item "d1") (T "ext_b_select") == false
#guard spec (item "unrelated") (T "ext_c_select") == false

-- counting the base's other extensions into an extension (the reading this replaces)
-- would make every select of the family admit every item of it:
def foldedFamily (n : String) : Ty := .defn n (.sel n (domain family "root_select"))
#guard spec (item "b1") (foldedFamily "ext_c_select") == true

/- ── Specifications (src/test/implicit-interfaces.test.ts) ──
   Each universe lists the declarations of the schemas the checked schema
   reaches; each seed, the declarations visible in it. -/
def it (name : String) (refs : List String := []) (selection : List String := [])
    (forList : List String := []) (constrains : List String := []) : Item :=
  ⟨name, refs, selection, forList, constrains⟩

def sameSet (a b : List String) : Bool := a.all b.contains && b.all a.contains

/-- The specification of a schema: `step` to a fixed point (the universe bounds the rounds). -/
def specOf (u : Universe) (seed : List String) : List String := specIter u seed (u.length + 1)

/-- Every specification below is stable, hence `Closed` (`closed_of_stable`). -/
def stable (u : Universe) (seed : List String) : Bool := sameSet (step u (specOf u seed)) (specOf u seed)

-- 11.4 EXAMPLE: s2 references e2; e1 (used by e2) and t1 (used by e1) are implicitly interfaced
def ex114 : Universe := [it "t1", it "e1" ["t1"], it "e2" ["e1"], it "unrelated", it "e3" ["e2"]]
#guard sameSet (specOf ex114 ["e2", "e3"]) ["e1", "e2", "e3", "t1"]
#guard stable ex114 ["e2", "e3"]

-- 11.4.2 EXAMPLE: s2 references t1; sel1 lists t1 and is implicitly interfaced; e1 is not
def ex1142 : Universe := [it "sel1" [] ["e1", "t1"], it "t1", it "e1"]
#guard sameSet (specOf ex1142 ["t1"]) ["sel1", "t1"]
#guard stable ex1142 ["t1"]

-- an interfaced extension interfaces its base, not the selectable items of either
def exBase : Universe := [it "a", it "b", it "base_select" [] ["a"], it "wider_select" ["base_select"] ["b"]]
#guard sameSet (specOf exBase ["wider_select"]) ["base_select", "wider_select"]

-- an interfaced entity interfaces its supertypes (not its subtypes) and the selects that list it
def exEntity : Universe :=
  [it "top", it "middle" ["top"], it "other" ["top"], it "bottom" ["middle"],
   it "base_select", it "middle_select" ["base_select"] ["middle"]]
#guard sameSet (specOf exEntity ["middle"]) ["base_select", "middle", "middle_select", "top"]

-- a schema the checked schema does not reach is not in its universe
def exUnreached : Universe := [it "a", it "base_select"]
#guard sameSet (specOf exUnreached ["a"]) ["a"]

-- a rule is interfaced once every entity of its FOR list is
def exRule : Universe := [it "a", it "b", it "ab" [] [] ["a", "b"]]
#guard sameSet (specOf exRule ["a"]) ["a"]
#guard sameSet (specOf exRule ["a", "b"]) ["a", "ab", "b"]

/- ── Redeclarations across schemas (src/test/redeclaration-specialization.test.ts) ── -/
/-- A select as the type builder gives it in the schema with specification `x`:
    the extensions in `x` followed, the items outside `x` pruned. -/
def Tin (f : Family) (x : List String) (n : String) : Ty := .defn n (.sel n (prune x (domainFollow f x n)))

-- only the extensions in the schema's specification count: without_extension does not reach
-- extension_schema, so wider_select is not in its universe; with_extension interfaces it
def baseItems : Universe := [it "a", it "b", it "base_select" [] ["a"], it "holder" ["base_select"]]
def withoutU : Universe := baseItems ++ [it "narrow" ["holder", "b"]]
def withU : Universe := baseItems ++ [it "wider_select" ["base_select"] ["b"], it "narrow_too" ["holder", "b"]]
def withoutF : Family := [⟨"base_select", none, [item "a"]⟩]
def withF : Family := withoutF ++ [⟨"wider_select", some "base_select", [item "b"]⟩]
def withoutX : List String := specOf withoutU ["a", "b", "base_select", "holder", "narrow"]
def withX : List String := specOf withU ["a", "b", "base_select", "holder", "wider_select", "narrow_too"]
#guard spec (item "b") (Tin withoutF withoutX "base_select") == false
#guard spec (item "b") (Tin withF withX "base_select") == true

-- an interfaced extension interfaces its base: user_schema sees leaf_select, and middle_select,
-- its base, comes in by 11.4.2; base_select then admits m and l
def chainU : Universe :=
  [it "a", it "base_select" [] ["a"], it "holder" ["base_select"],
   it "m", it "middle_select" ["base_select"] ["m"],
   it "l", it "leaf_select" ["middle_select"] ["l"],
   it "narrow_m" ["holder", "m"], it "narrow_l" ["holder", "l"]]
def chainF : Family :=
  [⟨"base_select", none, [item "a"]⟩, ⟨"middle_select", some "base_select", [item "m"]⟩,
   ⟨"leaf_select", some "middle_select", [item "l"]⟩]
def chainX : List String :=
  specOf chainU ["a", "base_select", "holder", "m", "leaf_select", "l", "narrow_m", "narrow_l"]
#guard chainX.contains "middle_select"
#guard spec (item "m") (Tin chainF chainX "base_select") == true
#guard spec (item "l") (Tin chainF chainX "base_select") == true

-- interfacing an item interfaces the extensions that list it (11.4.3): user_schema names c only
def listU : Universe :=
  [it "a", it "base_select" [] ["a"], it "holder" ["base_select"],
   it "c", it "c_select" ["base_select"] ["c"], it "narrow" ["holder", "c"]]
def listF : Family := [⟨"base_select", none, [item "a"]⟩, ⟨"c_select", some "base_select", [item "c"]⟩]
def listX : List String := specOf listU ["a", "base_select", "holder", "c", "narrow"]
#guard listX.contains "c_select"
#guard spec (item "c") (Tin listF listX "base_select") == true

/- ── Selectable items outside the specification (11.4.2) ── -/

-- 11.4.2 EXAMPLE: in s2, which references t1 only, sel1 = SELECT (e1, t1) holds t1 alone
def ex1142F : Family := [⟨"sel1", none, [item "e1", .defn "t1" (.simp .int)]⟩]
#guard (prune (specOf ex1142 ["t1"]) (domainFollow ex1142F (specOf ex1142 ["t1"]) "sel1")).map nameOf == ["t1"]

-- s1 declares wide = SELECT (e1, e2); the checked schema interfaces wide and e1, not e2, and
-- redeclares x : sel_e1 (= SELECT (e1)) as wide: in that schema wide holds e1 only
def wideU : Universe :=
  [it "e1", it "e2", it "wide" [] ["e1", "e2"], it "sel_e1" [] ["e1"],
   it "holder" ["sel_e1"], it "narrow" ["holder", "wide"]]
def wideF : Family := [⟨"wide", none, [item "e1", item "e2"]⟩, ⟨"sel_e1", none, [item "e1"]⟩]
def wideX : List String := specOf wideU ["wide", "e1", "sel_e1", "holder", "narrow"]
#guard !wideX.contains "e2"
#guard spec (Tin wideF wideX "wide") (Tin wideF wideX "sel_e1") == true
-- without the pruning, e2 would make it fail
#guard spec (.defn "wide" (.sel "wide" (domainFollow wideF wideX "wide"))) (Tin wideF wideX "sel_e1") == false

end SelectExtension
