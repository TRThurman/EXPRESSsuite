#!/usr/bin/env bash
# Builds the proofs and checks the two claims README.md makes about them.
#
# - `lake build` fails when a proof does not check or a #guard does not hold.
# - A `sorry` is only a warning, so the build log is searched for one.
# - Every `#print axioms` result must name only propext, Classical.choice and
#   Quot.sound, and there must be one result per `#print axioms` command (a
#   missing result would let the axiom check pass vacuously).
#
# Run from anywhere; CI runs it in the `lean` job of .github/workflows/ci.yaml.
set -euo pipefail
cd "$(dirname "$0")"

log=$(mktemp)
trap 'rm -f "$log"' EXIT

lake build 2>&1 | tee "$log"

status=0
if grep -n "declaration uses .sorry." "$log"; then
  echo "error: a declaration uses sorry" >&2
  status=1
fi

allowed='(propext|Classical\.choice|Quot\.sound)'
if grep "depends on axioms" "$log" | grep -v -E "depends on axioms: \[$allowed(, $allowed)*\]\s*$"; then
  echo "error: a theorem depends on an axiom other than propext, Classical.choice and Quot.sound" >&2
  status=1
fi

expected=$(cat ExpressSuite/*.lean | grep -c "^#print axioms" || true)
results=$(grep -c -E "depends on axioms|does not depend on any axioms" "$log" || true)
if [ "$results" -ne "$expected" ]; then
  echo "error: $expected #print axioms commands but $results results in the build log" >&2
  status=1
fi

[ "$status" -eq 0 ] && echo "lean/check.sh: build ok, no sorry, $results axiom reports within propext, Classical.choice, Quot.sound"
exit "$status"
