#!/usr/bin/env python3
"""Cyclomatic complexity per diagnostic check, as cited on the capabilities deck.

Runs ESLint's `complexity` rule over src/language (threshold 0, so every
function is reported), then sums McCabe complexity per check: the validator
method that implements the check, its anonymous inner functions, and the
module that implements the check's relation. The resolved-type builder
(type-system/express-type-builder.ts) serves only the two type checks and is
split evenly between them. Attribution is by function name, so a renamed
function must be renamed here too; an unknown name is reported, not ignored.

Usage, from the repository root:  python3 docs/check-complexity.py
"""
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = "express-p11-validator.ts"
MODEL = "type-system/express-type-model.ts"
BUILDER = "type-system/express-type-builder.ts"
SCOPE_INDEX = "express-p11-scope-index.ts"
UTILITIES = "express-p11-type-utilities.ts"
INFORMAL = "informal-proposition-validator.ts"

# check -> (validator methods, (file, function names) for the transcribed relation, builder share)
CHECKS = {
    "redeclaration-not-specialization": (
        ["checkRedeclaredAttributeTypes"], [(MODEL, {"spec", "simpLe", "aggLe", "boundsOk"})], True),
    "duplicate-interfaced-declaration (and redundant-declaration)": (
        ["checkDuplicateInterfacedDeclarations"], [(SCOPE_INDEX, None)], False),
    "index-on-non-aggregate": (
        ["checkIndexQualifierOperands"],
        [(MODEL, {"notIndexable", "indexableSimple", "notIndexableClosed", "mentionsExtensibleSelect"})], True),
    "ambiguous-attribute-reference": (
        ["checkAmbiguousAttributeReference"],
        [(UTILITIES, {"getVisibleLevels", "getAncestorLevels", "getDescendantLevels", "getVisibleSet", "visible"})], False),
    "informal-proposition-*": ([], [(INFORMAL, None)], False),
    "annotation-*": ([], [("annotation/check.ts", None)], False),
    "reference-statement-missing": (
        ["checkReferencesAreImported", "issueReferenceStatementDiagnostic", "issueRenameReferenceDiagnostic"], [], False),
    "declaration-name-case": (["checkDeclarationNameCasing", "checkAttributeNameStartsWithLowerCase"], [], False),
    "duplicate-loop-index": (["checkLocalVariablesDoNotDuplicateLoopIndices"], [], False),
}
PROVED = {"redeclaration-not-specialization", "duplicate-interfaced-declaration (and redundant-declaration)",
          "index-on-non-aggregate", "ambiguous-attribute-reference"}
MESSAGE = re.compile(r"(?:\S+ )*?'?([^' ]+)?'? has a complexity of (\d+)")


def measure() -> dict[str, list[tuple[str, int, int]]]:
    """file -> [(function name or '(anonymous)', line, complexity)], via ESLint JSON output."""
    result = subprocess.run(
        ["npx", "eslint", "src/language", "--rule", 'complexity: ["warn", 0]', "-f", "json"],
        cwd=ROOT, capture_output=True, text=True)
    if not result.stdout.strip():
        sys.exit(f"eslint produced no output:\n{result.stderr}")
    functions: dict[str, list[tuple[str, int, int]]] = defaultdict(list)
    for entry in json.loads(result.stdout):
        path = entry["filePath"].split("/src/language/")[-1]
        for message in entry["messages"]:
            if message.get("ruleId") != "complexity":
                continue
            match = MESSAGE.search(message["message"])
            name = match.group(1) if match and match.group(1) and not match.group(1).startswith("has") else "(anonymous)"
            if "Arrow function" in message["message"] or "'" not in message["message"]:
                name = "(anonymous)"
            functions[path].append((name, message["line"], int(match.group(2))))
    return functions


def validator_totals(functions) -> dict[str, int]:
    """Named validator methods, each with its anonymous inner functions folded in."""
    entries = sorted(functions[VALIDATOR], key=lambda f: f[1])
    totals: dict[str, int] = defaultdict(int)
    current = None
    for name, _line, complexity in entries:
        if name != "(anonymous)":
            current = name
        if current is not None:
            totals[current] += complexity
    return totals


def main() -> None:
    functions = measure()
    validator = validator_totals(functions)
    builder = sum(c for _n, _l, c in functions[BUILDER])
    rows = []
    for check, (methods, modules, uses_builder) in CHECKS.items():
        total = 0
        for method in methods:
            if method not in validator:
                sys.exit(f"validator method {method!r} not found; the attribution table needs updating")
            total += validator[method]
        for path, names in modules:
            found = functions.get(path, [])
            if names is None:
                total += sum(c for _n, _l, c in found)
            else:
                present = {n for n, _l, _c in found}
                missing = names - present
                if missing:
                    sys.exit(f"{path}: functions {sorted(missing)} not found; the attribution table needs updating")
                total += sum(c for n, _l, c in found if n in names)
        if uses_builder:
            total += builder // 2
        rows.append((check, check in PROVED, total))
    rows.sort(key=lambda r: -r[2])
    width = max(len(r[0]) for r in rows)
    print(f"{'check':{width}}  proof  complexity")
    for check, proved, total in rows:
        print(f"{check:{width}}  {'yes' if proved else 'no ':5}  {total:5d}")
    proved_total = sum(t for _c, p, t in rows if p)
    all_total = sum(t for _c, _p, t in rows)
    print(f"\nproved checks: {proved_total} of {all_total} decision points ({proved_total / all_total:.0%}); "
          f"type builder {builder}, split between the two type checks; "
          f"{sum(len(v) for v in functions.values())} functions measured")


if __name__ == "__main__":
    main()
