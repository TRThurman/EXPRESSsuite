#!/usr/bin/env python3
"""Extract diverse AsciiMath examples from an annotated EXPRESS schema.

Pulls inline `stem:[...]` expressions, classifies each by AsciiMath features
(subscripts, Greek letters, operators, brackets, fractions, ranges, etc.),
and selects N examples that maximize feature coverage.

Output: JSON fixture suitable for driving math-renderer tests.

Usage:
    extract-asciimath-fixtures.py <input.exp> -o <out.json> [-n 10]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path


GREEK_NAMES = {
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "rho", "sigma",
    "tau", "upsilon", "phi", "chi", "psi", "omega",
    "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Theta", "Lambda",
    "Pi", "Sigma", "Phi", "Omega",
}

FUNCTION_NAMES = {
    "sin", "cos", "tan", "log", "ln", "exp", "abs", "det", "lim", "sup", "inf",
    "max", "min", "hat", "bar", "vec", "tilde", "dot", "ddot", "bb", "bbb",
    "cc", "tt", "fr", "sf", "ul",
}


@dataclass(frozen=True)
class Features:
    """Boolean features used to score AsciiMath construct diversity."""
    has_subscript: bool = False
    has_superscript: bool = False
    has_greek: bool = False
    has_function: bool = False
    has_cross: bool = False
    has_dot_product: bool = False
    has_arrow: bool = False
    has_inequality: bool = False
    has_fraction: bool = False
    has_paren_group: bool = False
    has_angle_bracket: bool = False
    has_unit_string: bool = False
    is_short: bool = False
    is_long: bool = False

    def to_set(self) -> set[str]:
        return {k for k, v in asdict(self).items() if v}


@dataclass
class StemExpr:
    line: int
    column: int
    raw: str
    context_before: str
    context_after: str
    features: Features = field(default_factory=Features)

    def to_json(self) -> dict:
        d = asdict(self)
        d["features"] = sorted(self.features.to_set())
        return d


def extract_stem_expressions(text: str) -> list[StemExpr]:
    """Find every stem:[...] in text, respecting balanced brackets.

    Asciidoctor's stem macro terminates on a balanced ']'; nested '[..]'
    inside the expression (e.g. matrices) are allowed.
    """
    lines = text.splitlines()
    results: list[StemExpr] = []
    line_starts: list[int] = []
    pos = 0
    for line in lines:
        line_starts.append(pos)
        pos += len(line) + 1  # +1 for the newline

    pattern = re.compile(r"stem:\[")
    for m in pattern.finditer(text):
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            c = text[i]
            if c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth != 0:
            continue  # unbalanced; skip
        raw = text[start:i]

        # locate line/column for the stem:[ start
        macro_start = m.start()
        line_idx = 0
        for j in range(len(line_starts)):
            if line_starts[j] > macro_start:
                line_idx = j - 1
                break
        else:
            line_idx = len(line_starts) - 1
        column = macro_start - line_starts[line_idx] + 1

        ctx_before = lines[line_idx - 1] if line_idx > 0 else ""
        ctx_after = lines[line_idx + 1] if line_idx + 1 < len(lines) else ""

        results.append(
            StemExpr(
                line=line_idx + 1,
                column=column,
                raw=raw,
                context_before=ctx_before,
                context_after=ctx_after,
                features=classify(raw),
            )
        )
    return results


def classify(expr: str) -> Features:
    """Tag an AsciiMath expression with diversity features."""
    has_greek = any(re.search(rf"\b{g}\b", expr) for g in GREEK_NAMES)
    has_function = any(re.search(rf"\b{f}\b", expr) for f in FUNCTION_NAMES)
    return Features(
        has_subscript="_" in expr,
        has_superscript="^" in expr,
        has_greek=has_greek,
        has_function=has_function,
        has_cross="xx" in expr,
        has_dot_product="cdot" in expr,
        has_arrow=("->" in expr) or ("=>" in expr),
        has_inequality=any(t in expr for t in (" le ", " ge ", " < ", " > ", " <= ", " >= ", "leq", "geq")),
        has_fraction=" / " in expr or expr.startswith("frac") or "frac " in expr,
        has_paren_group="(" in expr and ")" in expr,
        has_angle_bracket="langle" in expr or "rangle" in expr,
        has_unit_string=bool(re.search(r'"[^"]+"', expr)),
        is_short=len(expr) <= 5,
        is_long=len(expr) >= 30,
    )


def select_diverse(exprs: list[StemExpr], n: int) -> list[StemExpr]:
    """Greedy-pick exprs to maximise feature-set coverage."""
    chosen: list[StemExpr] = []
    covered: set[str] = set()
    candidates = list(exprs)

    while len(chosen) < n and candidates:
        best_idx = -1
        best_gain = -1
        best_size = -1
        for i, e in enumerate(candidates):
            new = e.features.to_set() - covered
            gain = len(new)
            # tiebreak: prefer non-trivial expressions over single-token ones
            size = len(e.raw)
            if (gain > best_gain) or (gain == best_gain and size > best_size):
                best_gain = gain
                best_size = size
                best_idx = i
        if best_idx == -1:
            break
        pick = candidates.pop(best_idx)
        chosen.append(pick)
        covered |= pick.features.to_set()
        # if we've covered everything, fill remaining slots with longest distinct expressions
        if best_gain == 0:
            break

    if len(chosen) < n:
        already = {(e.line, e.column) for e in chosen}
        leftovers = [e for e in candidates if (e.line, e.column) not in already]
        leftovers.sort(key=lambda e: (-len(e.raw), e.line))
        chosen.extend(leftovers[: n - len(chosen)])

    chosen.sort(key=lambda e: (e.line, e.column))
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path, help="Path to .exp source file")
    ap.add_argument("-o", "--output", type=Path, required=True, help="Output JSON path")
    ap.add_argument("-n", "--count", type=int, default=10, help="Number of examples to pick (default: 10)")
    args = ap.parse_args()

    text = args.input.read_text(encoding="utf-8")
    all_exprs = extract_stem_expressions(text)
    if not all_exprs:
        print(f"warning: no stem:[...] found in {args.input}", file=sys.stderr)
        return 1

    chosen = select_diverse(all_exprs, args.count)

    payload = {
        "source": str(args.input),
        "total_found": len(all_exprs),
        "selected": len(chosen),
        "examples": [e.to_json() for e in chosen],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"extracted {len(all_exprs)} stem:[...] expressions from {args.input.name}")
    print(f"selected {len(chosen)} diverse examples -> {args.output}")
    for e in chosen:
        feats = ", ".join(sorted(e.features.to_set())) or "(no tags)"
        print(f"  line {e.line:>5}: stem:[{e.raw}]  [{feats}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
