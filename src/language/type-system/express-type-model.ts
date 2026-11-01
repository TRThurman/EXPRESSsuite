/**
 * Resolved EXPRESS type domain and the specialization relation, as a literal
 * TypeScript transcription of lean/ExpressSuite/Specialisation.lean (`Ty`,
 * `boundsOk`, `spec`, `specAll`, `specAny`) and lean/ExpressSuite/IndexOperand.lean
 * (`neverAgg`). The Lean files carry the proofs (reflexivity, transitivity,
 * GENERIC as top, denotational soundness against eengine's value semantics);
 * this file must stay in lock-step with them, clause by clause.
 *
 * Reading of ISO 10303-11:2004 encoded here: `spec(n, o)` holds when every value
 * of `n` is a value of `o` (9.2.3.4 a, 9.2.7; defined types are transparent on
 * both sides, 9.2.3.4 c presupposes it on the original side).
 */
export type Simple = "integer" | "real" | "string" | "boolean" | "logical" | "number" | "binary";
export type AggK = "list" | "bag" | "set" | "array";

export type Ty =
  | { kind: "simp"; s: Simple }
  | { kind: "gen" }
  /** entity with its TRANSITIVE supertype names; names are compared case-insensitively, store them lower-cased.
   *  `node` is TypeScript-only bookkeeping for attribute lookup; the Lean relation has no such field */
  | { kind: "ent"; name: string; supers: string[]; node?: unknown }
  | { kind: "defn"; name: string; under: Ty }
  /** `extensible` is TypeScript-only bookkeeping (the Lean relation ignores it); see neverAggregateClosed */
  | { kind: "sel"; name: string; members: Ty[]; extensible?: boolean }
  /** hi === undefined encodes the unbounded upper bound `?` */
  | { kind: "agg"; k: AggK; lo: number; hi: number | undefined; elem: Ty };

/** Specialisation.lean `simpLe`: the 9.2.7 order on simple types (INTEGER < REAL < NUMBER, BOOLEAN < LOGICAL). */
export function simpLe(a: Simple, b: Simple): boolean {
  return a === b || (a === "integer" && (b === "real" || b === "number")) || (a === "real" && b === "number") || (a === "boolean" && b === "logical");
}

/** Specialisation.lean `aggLe`: the same aggregate kind, or SET where BAG was declared (ISO 10303-11:2004 9.2.7). */
export function aggLe(kN: AggK, kO: AggK): boolean {
  return kN === kO || (kN === "set" && kO === "bag");
}

/** Specialisation.lean `boundsOk`: NEW's bounds must lie within ORIG's. */
export function boundsOk(loN: number, hiN: number | undefined, loO: number, hiO: number | undefined): boolean {
  if (!(loO <= loN)) return false;
  if (hiO === undefined) return true; // ORIG unbounded: any NEW upper bound is fine
  if (hiN === undefined) return false; // ORIG bounded, NEW unbounded: not a specialization
  return hiN <= hiO;
}

/**
 * Specialisation.lean `spec new orig`: true iff `new` is a valid specialization
 * of `orig`. The NEW operand is resolved first (defined type unwrapped, SELECT
 * decomposed with "every member"), then the ORIGINAL (GENERIC accepts all,
 * defined type unwrapped, SELECT decomposed with "some member"), then the
 * concrete pairs. The order is load-bearing: see the Lean file's design note.
 */
export function spec(n: Ty, o: Ty): boolean {
  if (n.kind === "defn") return spec(n.under, o);
  if (n.kind === "sel") return n.members.every((m) => spec(m, o));
  if (o.kind === "gen") return true;
  if (o.kind === "defn") return spec(n, o.under);
  if (o.kind === "sel") return o.members.some((m) => spec(n, m));
  if (n.kind === "simp" && o.kind === "simp") return simpLe(n.s, o.s);
  if (n.kind === "ent" && o.kind === "ent") return o.name === n.name || n.supers.includes(o.name);
  if (n.kind === "agg" && o.kind === "agg") return aggLe(n.k, o.k) && boundsOk(n.lo, n.hi, o.lo, o.hi) && spec(n.elem, o.elem);
  return false;
}

/** IndexOperand.lean `indexableSimple`: STRING (12.5.1) and BINARY (12.3.1) values may be indexed. */
export function indexableSimple(s: Simple): boolean {
  return s === "string" || s === "binary";
}

/**
 * IndexOperand.lean `notIndexable t`: no value of `t` can be indexed by any of
 * the three indexing operators of ISO 10303-11:2004 (12.3.1 binary, 12.5.1
 * string, 12.6.1 aggregate). GENERIC and aggregates may hold aggregate values;
 * a SELECT is not indexable iff none of its members is.
 */
export function notIndexable(t: Ty): boolean {
  switch (t.kind) {
    case "simp":
      return !indexableSimple(t.s);
    case "ent":
      return true;
    case "gen":
    case "agg":
      return false;
    case "defn":
      return notIndexable(t.under);
    case "sel":
      return t.members.every(notIndexable);
  }
}

/**
 * The open-world guard for the validator: an EXTENSIBLE select may gain
 * indexable members in schemas outside the workspace, so a chain that passes
 * through one is not reported. Strictly stronger than `notIndexable`.
 */
export function notIndexableClosed(t: Ty): boolean {
  return notIndexable(t) && !mentionsExtensibleSelect(t);
}

export function mentionsExtensibleSelect(t: Ty): boolean {
  switch (t.kind) {
    case "sel":
      return Boolean(t.extensible) || t.members.some(mentionsExtensibleSelect);
    case "defn":
      return mentionsExtensibleSelect(t.under);
    case "agg":
      return mentionsExtensibleSelect(t.elem);
    default:
      return false;
  }
}

/** The element type reached through one index qualifier, when it is determined. */
export function elementType(t: Ty): Ty | undefined {
  switch (t.kind) {
    case "agg":
      return t.elem;
    case "defn":
      return elementType(t.under);
    default:
      return undefined;
  }
}

/** Human-readable form for diagnostics; names are printed as declared. */
export function renderType(t: Ty): string {
  switch (t.kind) {
    case "simp":
      return t.s.toUpperCase();
    case "gen":
      return "GENERIC";
    case "ent":
    case "defn":
    case "sel":
      return t.name;
    case "agg":
      return `${t.k.toUpperCase()} [${t.lo}:${t.hi === undefined ? "?" : t.hi}] OF ${renderType(t.elem)}`;
  }
}
