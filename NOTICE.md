# NOTICE — Modifications to NIST-developed software

This repository is a derivative work based on the NIST-developed software
**easyEXPRESS** (https://github.com/usnistgov/easy-express).  In accordance
with the NIST Software Licensing Statement preserved in [LICENSE.md](LICENSE.md):

> *Modified works should carry a notice stating that you changed the
> software and should note the date and nature of any such change.
> Please explicitly acknowledge the National Institute of Standards and
> Technology as the source of the software.*

This file is that notice.

The derivative application is now named **EXPRESSsuite**. The distinct name
avoids suggesting that this independently maintained product is the NIST-owned
easyEXPRESS application or Marketplace listing.

## Acknowledgement of source

The original easyEXPRESS was developed at the U.S. National Institute of
Standards and Technology (NIST) by:

- Sylvere Krima
- Allison Barnard Feeney
- Rosemary Astheimer

NIST-developed software is not subject to copyright protection within the
United States under 17 U.S.C. § 105.  The original software is preserved
under its NIST licensing statement; see [`LICENSE.md`](LICENSE.md) for the
complete text.

## Provenance of this fork

This independently maintained fork was created by Thomas Thurman
(TRThurman Consulting) in 2025 from
[usnistgov/easy-express](https://github.com/usnistgov/easy-express).  The
fork is distributed under the MIT License (see [`LICENSE`](LICENSE)) for
all *new* code, while the NIST-developed portions remain subject to the
NIST Software Licensing Statement.

## Summary of modifications

The following sections summarise modifications made to the NIST-developed
software in this fork.  Detailed history is available in `git log` and
[`CHANGELOG.md`](CHANGELOG.md).

### 2025-Q1 — fork bootstrap

- **Date**: 2025 (initial fork; see git history for exact dates).
- **Nature**: relicensed *new code* under MIT; preserved the NIST
  Software Licensing Statement for *original* portions.  Renamed
  publisher and repository to identify the fork.

### 2026-02 — dependency modernisation

- **Date**: 2026-02 through 2026-03.
- **Nature**: upgraded Langium framework from 2.1.3 to 4.2.2 (two major
  version migrations); migrated ESLint to flat config (8 → 9); upgraded
  `release-it` 17 → 19 → 20; replaced unmaintained `uuidv4` package with
  `uuid` v14; resolved upstream Dependabot advisories on `vite`,
  `handlebars`, `flatted`, `defu`, `basic-ftp`, `minimatch`,
  `brace-expansion`, `lodash`, and `postcss`.

### 2026-05 — Annotation viewers (version 0.4.0)

- **Date**: 2026-05.
- **Nature**: added four viewer surfaces for the annotated EXPRESS
  convention used by ISO TC 184/SC 4 schema authors:
  - Hover provider with rendered descriptions, clickable
    cross-references, and inline math.
  - Description preview (full Asciidoctor render with embedded MathML
    via Plurimath).
  - EXPRESS-G interactive SVG viewer with hot-spot navigation backed by
    Langium's `IndexManager` (with filesystem-scan fallback for
    non-workspace contexts).
  - AsciiMath playground with prose-with-math rendering and a
    "Send Selection to Playground" command.
- Added a language-server-side `ExpressP11AnnotationIndex` service and
  three custom LSP requests: `express/getAnnotations`,
  `express/findAnnotationsForEntity`, `express/resolveEntity`.
- Added `node:worker_threads` isolation for synchronous math rendering
  with a hard 2-second per-render timeout.
- Added a layered security model: per-surface webview Content Security
  Policy, DOMPurify SVG / HTML sanitisation, Asciidoctor `:safe-mode:
  secure`, `MarkdownString.isTrusted` allow-list, schema-validated
  webview→host messages, and per-expression / per-document resource
  limits.
- Added cross-platform CI (`.github/workflows/ci.yaml`) for Ubuntu,
  macOS, and Windows runners.
- Added documentation set: white paper
  (`docs/easyEXPRESS-viewers.adoc`), implementor and user-guide
  PowerPoint decks, smoke-test checklist, and the full
  design-protocol document
  (`DESIGN-viewers-integration.md`).

### 2026-09 — SC4 validation improvements

- **Date**: 2026-09-15.
- **Nature**: expanded EXPRESS validation for ISO TC 184/SC 4 schema
  maintenance:
  - Enforced ARM and non-ARM entity/type naming conventions with quick fixes.
  - Detected explicit local declarations that duplicate implicit `REPEAT`
    loop indices.
  - Added an on-demand, cancellable schema-closure duplicate declaration
    check with native Problems diagnostics and source navigation.
  - Validated informal proposition signatures and `.wr:IPn` annotation keys,
    including missing, malformed, misplaced, non-final, and unmatched forms.
- Added automated regression coverage for each validation class across direct,
  transitive, cyclic, renamed-resource, and malformed-comment cases.

### 2026-09 — EXPRESSsuite product identity

- **Date**: 2026-09-15.
- **Nature**: renamed the derivative application and repository to
  **EXPRESSsuite** and assigned it the independent Visual Studio Marketplace
  identity `TRThurman.expresssuite`. The EXPRESS language identifier remains
  `express`, while commands and settings use the independent `expresssuite.*`
  namespace so both products can be installed together. NIST easyEXPRESS
  attribution is preserved throughout the project.

The complete list of source-level changes since the fork point can be
obtained via:

```
git log usnistgov/easy-express/main..HEAD --oneline
```

against an appropriately configured remote.

## Citation

If you use this fork or its derivatives in academic, standards, or
regulatory work, please cite:

- **The NIST original** (the substrate this work builds on):
  > Krima, S., Barnard Feeney, A., and Astheimer, R.
  > *easyEXPRESS: A Visual Studio Code Extension for ISO 10303-11.*
  > U.S. National Institute of Standards and Technology, 2024.
  > https://github.com/usnistgov/easy-express.
  > Public-domain in the U.S. under 17 U.S.C. § 105.

- **This fork's modifications** (when the modifications are material to
  the work cited):
  > Thurman, T.  *EXPRESSsuite.*  TRThurman Consulting,
  > 2025–.  https://github.com/TRThurman/EXPRESSsuite.
  > MIT-licensed for code originating in this fork; NIST-developed
  > portions remain subject to the NIST Software Licensing Statement.

A machine-readable citation file suitable for tools that consume
[Citation File Format 1.2](https://citation-file-format.github.io/) is
provided as [`CITATION.cff`](CITATION.cff).
