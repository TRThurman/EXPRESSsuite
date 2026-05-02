# DESIGN-viewers-integration.md — AsciiDoc + EXPRESS-G SVG + AsciiMath Viewers
#
# USAGE: This file is a DESIGN PROTOCOL document for the easy-express fork.
# Phases are gated: do not advance until the current phase's exit criteria
# are met and signed off below.

## PROJECT IDENTITY

**Project**: AsciiDoc, EXPRESS-G SVG, and AsciiMath viewer integration
**Owner**: Thomas Thurman, TRThurman Consulting
**Repository**: `/Users/tom/work/easy-express` (fork: `TRThurman/easy-express-mirror`)
**Context**: VS Code extension for ISO 10303-11 (EXPRESS) language support
**Motivation**: Annotated EXPRESS schemas embed Metanorma AsciiDoc descriptions and reference EXPRESS-G SVG diagrams. Surrounding IGR/document AsciiDoc may embed AsciiMath via `stem:[…]`. The current extension has no UI to render any of these — users see raw `(* ... *)` comments, raw `.svg` source, and raw `stem:[…]` text.

---

## PROBLEM STATEMENT

Annotated EXPRESS (per `~/test_git/annotated-express/syntax.adoc`) embeds Metanorma AsciiDoc inside named remark comments of the form `(*"dotted.tag" body *)`. These remarks attach to schemas, entities, attributes, functions, and WHERE rules; subtypes include `__note`, `__example`, `__figure`, `__fund_cons`, and `__expressg`. The Langium grammar (`src/language/express.langium:323`) treats `ML_COMMENT` as a **hidden** token, so the AST contains no remark structure — any viewer must scan source text directly.

EXPRESS-G diagrams referenced from `__expressg` remarks use Metanorma's `[.svgmap]` block construct: an `image::file.svg[]` macro plus a numbered `<<express:...>>` xref list, paired against invisible `<a href="N"><rect/></a>` hot-spots inside the SVG. Vanilla VS Code shows `.svg` files as XML source; there is no built-in rendered preview.

In adjacent IGR documentation `.adoc` files, math expressions appear via Metanorma's STEM mechanism (`stem:[…]` inline; default is AsciiMath). Plurimath is the converter Metanorma uses to normalize AsciiMath/LaTeX → MathML → renderer.

Goal: deliver inline reading + interactive cross-navigation of annotated descriptions, their associated EXPRESS-G diagrams, and any embedded AsciiMath, without breaking the existing language-server workflow. A popup math editor/viewer with rendering equivalent to plurimath.org examples is part of scope.

---

## DESIGN PROTOCOL

### Protocol Phases

```
PHASE 0: RECONNAISSANCE       → Facts only. Inventory current architecture,
                                 input formats, renderer landscape, VS Code
                                 patterns, math-rendering options, and bundle
                                 implications. No design.
PHASE 1: DESIGN SPEC          → Resolve open questions from Phase 0. Choose
                                 viewer surface(s), renderer(s), math pipeline,
                                 and integration boundary with Langium.
PHASE 2: PROOF OF CONCEPT     → Smallest end-to-end slice covering all three
                                 viewers on real annotated content. Measured.
PHASE 3: FULL IMPLEMENTATION  → Production providers, command surface,
                                 packaging, lazy-loading.
PHASE 4: VALIDATION           → Acceptance tests on real annotated schemas
                                 and IGR documents. Performance + bundle
                                 measurements vs Phase 0 baseline.
                                 Cross-platform smoke test.
```

**MANDATORY: Do not advance to the next phase until the current phase's exit criteria are met and the gate is signed off below.**

---

## PHASE 0: RECONNAISSANCE

### Recon area 1: easy-express architecture (FACTS)

- Activation event: `workspaceContains:**/*.exp` (single event) — `package.json:150-152`.
- Main entry: `./out/extension/main.cjs`, bundled CJS — `package.json:153`.
- Two-process LSP: client at `src/extension/main.ts`, server bundled separately at `out/language/main.cjs`, IPC transport — `src/extension/main.ts:23-36`.
- Document selector for client: `{ scheme: "file", language: "express" }` — `src/extension/main.ts:43`.
- **No webviews / custom editors / hover providers / tree views currently** — confirmed by `grep` over `src/`.
- Existing UI surface: only `ExpressP11StatusBarItem` (status bar with build button) — `src/extension/express-p11-status-bar-item.ts:6-49`.
- Contributed commands: `express.buildWorkspace`, `express.buildGraph` — `package.json:65-76`.
- Contributions present: commands, configuration, languages, grammars, snippets — `package.json:64-148`. **No** `customEditors`, `views`, or `viewsContainers`.
- Bundle: esbuild produces two CJS bundles in single pass; `entryPoints: ["src/extension/main.ts", "src/extension/language/main.ts"]`, `outdir: out`, `external: ["vscode"]`, `platform: node`, `target: ES2017`, `format: cjs` — `esbuild.mjs:31-46`.
- Bundle sizes (current minified): `out/extension/main.cjs` = 765,187 B (748 KB); `out/language/main.cjs` = 1,814,032 B (1.7 MB). Combined ≈ 2.45 MB.
- Langium grammar: `src/language/express.langium`, 323 lines. Critical: `(* ... *)` block comments are **hidden tokens** — `hidden terminal ML_COMMENT: /\(\*[\s\S]*?\*\)/`.
- Custom Langium services wired in `src/language/express-module.ts:45-85` (Validator, ScopeProvider, Linker, WorkspaceManager, IndexManager, etc.).
- Engines: `vscode: ^1.67.0`, `node: >=18.0.0` — `package.json:57-60`.
- Dependencies: `chalk`, `commander`, `uuid`, `vscode-languageclient ~8.0.2`. No asciidoctor, no SVG library, no math library currently.

### Recon area 2: AsciiDoc in EXPRESS (FACTS)

- Specification: `~/test_git/annotated-express/syntax.adoc` defines "Annotated EXPRESS" using Metanorma AsciiDoc.
- Comment syntax: `(*"NAME" body *)` where `NAME` is a dotted path tag — `syntax.adoc:23-31`. Leading `(*` is column-0 and unmistakable.
- Tag grammar (from `syntax.adoc:32-58`):
  - `"schema_name"` — schema description
  - `"schema_name.entity_name"` — entity description
  - `"schema_name.entity_name.attribute_name"` — attribute
  - `"schema_name.entity_name.wr:WR1"` — WHERE rule
  - Subtypes: `__note`, `__example`, `__figure`, `__fund_cons` (STEPmod), `__expressg` (STEPmod)
- Subtype frequency across 27 annotated files in `~/test_git/annotated-express/data/resources`:
  `__note`: 108, `__expressg`: 67, `__fund_cons`: 25, `__example`: 23, `__figure`: 5.
- Surveyed schemas with named-remark tags: 25 of 27 `*_annotated.exp` files.
- Concrete reference (`basic_attribute_schema_annotated.exp`, 543 lines): schema-level remark at line 161; entity-level remarks line 311+; attribute-level remarks lines 343-405; function-level remarks lines 495-543; WHERE-rule tag `wr:WR1` confirmed in `approval_schema_annotated.exp:12-13`.
- AsciiDoc constructs verified in remark bodies:
  - Bold/strong: `*entity_name*`
  - Cross-references: `<<express:schema.entity,render text>>`
  - Image macro: `image::basic_attribute_schemaexpg1.svg[]`
  - Block role + delimited block: `[.svgmap]` followed by `====` (Metanorma-specific clickable image map)
  - Numbered xref lists inside `[.svgmap]` (each entry `* <<express:foo>>; N`)
  - Bulleted lists, paragraphs.
- Placement (per `syntax.adoc:90-92`): "These named remarks are not bound to any particular location in an EXPRESS file." In `basic_attribute_schema_annotated.exp` they are collected at end-of-file, after `END_SCHEMA;`.
- Per-attribute granularity confirmed (e.g. `basic_attribute_schema.aggregate_id_attribute.attribute_value.__note`).
- No `:description:`-style structured keys; only `(*"…"…*)`.
- Includes / `[source,…]` blocks not observed in surveyed schemas (limited to one file inspected deeply — see open question 5).

### Recon area 3: AsciiDoc renderer landscape (FACTS)

- **`asciidoctor`** (npm wrapper) — v3.0.4, MIT, 129 KB unpacked. Re-exports `@asciidoctor/core`. Pulls in `ejs`, `pug`, `nunjucks`, `handlebars` transitively.
- **`@asciidoctor/core`** — v3.0.4, MIT, 6.4 MB unpacked. Tarball contents (verified):
  - `dist/browser/asciidoctor.min.js`: **746,900 B (728 KB)** — primary candidate for bundling
  - `dist/node/asciidoctor.cjs`: 1.0 MB
  - `dist/css/asciidoctor.css`: 29 KB
  - `types/index.d.ts`: 124 KB
- **`@asciidoctor/opal-runtime`** — 2.3 MB unpacked (Ruby→JS bridge), pulled transitively.
- Browser usage confirmed by upstream docs (`https://docs.asciidoctor.org/asciidoctor.js/latest/`).
- **`asciidoctor.js@1.5.9`** — DEPRECATED, replaced by `@asciidoctor/core`.
- **`downdoc`** — 44 KB, MIT, no deps. Down-converts AsciiDoc → Markdown. Limited fidelity but tiny.
- **`asciidoctor-kroki`** — 728 KB, MIT, embeds Kroki diagrams. Not strictly needed (EXPRESS-G SVGs are pre-rendered).
- **VS Code AsciiDoc extension `asciidoctor.asciidoctor-vscode`**: no public `exports`; 13 user-invocable commands, no `customEditors`. **Cross-extension API consumption is not a documented option.**

### Recon area 4: SVG viewer landscape (FACTS)

- VS Code natively shows `.svg` as XML source — confirmed indirectly by ecosystem (entire third-party preview-extension category exists). See open question 1.
- `vscode.openWith` opens a URI with a specific editor viewType; rendering requires registering a custom editor or webview.
- **`jock.svg`**: last updated 2 July 2023 (v1.5.3); author paused updates pending rewrite. Live preview, PNG export, autocomplete, color picker, document symbol tree.
- **`SimonSiefke.svg-preview`**: v2.8.3, ~Feb 2020, 1.4M+ installs. Webview preview with zoom/pan.
- **Custom webview (zero dep)**: feasible. `WebviewPanel.webview.html` can embed `<svg>` directly. Load files via `webview.asWebviewUri(...)` with `localResourceRoots` whitelist. Click interception via `postMessage` is required to wire `<a href="N">` overlays back to extension navigation.
- EXPRESS-G SVG output format (verified, annotated-express convention):
  - Files named `<schema>expg<N>.svg`, co-located with `_annotated.exp`.
  - 65 SVG files in `data/resources/`, total 2.3 MB; per-file 4.5–63 KB.
  - Internal structure (verified for `basic_attribute_schemaexpg1.svg`): single `<svg>` containing `<image href="data:image/gif;base64,…">` (the diagram is a base64-encoded GIF) plus `<a href="N"><rect>` invisible hot-spots. `href` integers pair with the numbered list in the corresponding `[.svgmap]` block.
- The `express-g` skill at `~/my-claude-skills/express-g/SKILL.md` generates SVG via `~/work/p21-instance-diagram/p21_diagram.py` using `ExpressGLayoutEngine.render_svg()`. Output convention may differ from annotated-express (pure SVG primitives vs base64-GIF). See open question 3.

### Recon area 5: VS Code patterns (FACTS)

- **`CustomTextEditorProvider`** — text-based; uses `TextDocument`. VS Code handles save/dirty state. (`vscode.d.ts:10336-10358`).
- **`CustomReadonlyEditorProvider`** — own document model; binary-friendly; correct shape for read-only viewers (`vscode.d.ts:10498-10516`).
- **`registerCustomEditorProvider(viewType, provider, options)`** — `vscode.d.ts:11758`. `options.supportsMultipleEditorsPerDocument` controls split-view.
- `customEditors` contribution priority values: `"default"` (auto-claims) and `"option"` (user must reopen-with). `"override"` does not exist.
- **`WebviewPanel`** — `vscode.window.createWebviewPanel(viewType, title, showOptions, options?)` (`vscode.d.ts:11514`). Right for stand-alone preview alongside an editor (not file-backed), with explicit "show preview" command.
- **`HoverProvider`** — `vscode.languages.registerHoverProvider(selector, provider)` (`vscode.d.ts:14872`). Returns `Hover` with `contents: Array<MarkdownString | MarkedString>`.
- **`MarkdownString.supportHtml = true`** allows a sanitized HTML subset:
  - Verified via `markdownRenderer.ts` source: allowed tags = `basicMarkupHtmlTags` + `input`. `svg` is NOT allowed; **`img` IS allowed** (`src, alt, height, width`). Style attributes restricted.
  - **Hovers can render AsciiDoc → HTML** (paragraphs, lists, bold, links, images) but cannot inline `<svg>`.
  - Hovers have no JavaScript — `[.svgmap]` interactivity is inert in hover; full interaction needs a webview.
- **`MarkdownString.isTrusted`** enables `command:` URLs (programmatic command links).
- Cross-extension API consumption: `vscode.extensions.getExtension('publisher.id')?.exports`. For `asciidoctor.asciidoctor-vscode`: no documented exports — treat as unavailable.

### Recon area 6: Bundle / packaging measurements — base (FACTS)

- Current bundle (minified): `extension` 748 KB + `language` 1.7 MB ≈ 2.45 MB combined.
- Asciidoctor weight added if bundled into client:
  - Smallest browser drop-in: `@asciidoctor/core/dist/browser/asciidoctor.min.js` = 728 KB → roughly doubles client bundle to ~1.5 MB.
  - Node CJS variant: `dist/node/asciidoctor.cjs` = 1.0 MB.
  - Full `npm install asciidoctor` pulls 129 KB wrapper + 6.4 MB core (most are dist variants — esbuild can pick one) + 2.3 MB opal-runtime.
  - **Post-esbuild tree-shaken size unmeasured.** See open question 6.
- Activation-time cost: asciidoctor's Opal runtime is large; cold-load adds parse time. Easy-express activates immediately on `workspaceContains:**/*.exp`. Lazy-load via dynamic `import()` / esbuild splitting is feasible but current `esbuild.mjs:31-46` uses a single bundle without splitting. Unmeasured.
- VSIX upload limit is 100 MB per Microsoft docs — adding ~1 MB stays well under.
- Pure-SVG rendering has near-zero bundle cost: `<img src>` or `webview.asWebviewUri(...)`; no library.

---

### Recon area M1: AsciiMath syntax + scope (FACTS)

- "AsciiMath is an easy-to-write markup language for mathematics" (`asciimath.org`). Grammar published as BNF on the home page; no separate normative spec document.
- Original implementation `ASCIIMathML.js` (community-maintained) at `github.com/asciimath/asciimathml`. Header self-identifies as "Version 2.4 April 13 2026"; npm `asciimathml@2.4.3` published 2026-04-14, MIT, unpacked 744 KB / 65 files; `ASCIIMathML.js` is 57.7 KB / 1280 lines.
- Constructs (per asciimath.org): matrices `[[a,b],[c,d]]`, column vectors `((a),(b))`, integrals/sums/products, Greek letters, accents (`hat`, `bar`, `vec`, `tilde`, `dot`), font commands (bold/blackboard/calligraphic/typewriter), standard functions (`sin`, `cos`, `log`), sub/super-scripts.
- Where AsciiMath appears in AsciiDoc / Metanorma:
  - Asciidoctor (`docs.asciidoctor.org/asciidoc/latest/stem/stem/`): inline `stem:[H_2O]`; block `[stem]` on `++++ … ++++` passthrough; document attribute `:stem:` activates STEM; default subtype is `asciimath`.
  - Metanorma (`metanorma.org/author/topics/blocks/math/`) adds explicit `asciimath:[…]` / `latexmath:[…]` and `[asciimath]` / `[latexmath]` block forms.
- **EXPRESS-schema scan (annotated-express only):** `grep -rn "stem:\|\[stem\|asciimath\|AsciiMath" ~/test_git/annotated-express/data/resources/` → 0 hits.
- **CORRECTED 2026-05-02 (owner input):** AsciiMath **is** present in `.exp` schema files in the larger wg12-step corpus. `~/test_git/sd.iso.org/wg12-step/schemas/resources/geometry_schema/geometry_schema.exp` contains **754 `stem:[…]` instances** (extracted via `scripts/extract-asciimath-fixtures.py`). Examples include:
  - `stem:[xx]` (cross product symbol — line 2395)
  - `stem:[0 le theta le 180 "P{degree}"]` (Greek + inequality + Metanorma unit string — line 3404)
  - `stem:[x = langle a - (a cdot z) z rangle ]` (angle brackets + dot product — line 3741)
  - `stem:[s = 1 / 2 r u^2]` (fraction + superscript — line 4379)
  - `stem:[bb"P" -> bb"A" + bb"S TP"]` (bold-vector function + arrow — line 3816)
- The annotated-express corpus is therefore not representative; full ISO 10303 schemas in wg12-step contain rich AsciiMath, especially in geometry/topology/measure schemas.
- 10 diverse fixture examples extracted to `test-fixtures/asciimath/geometry_schema-examples.json` for downstream renderer testing.
- **IGR document scan.** `~/test_git/annotated-express/data/documents/resources/fundamentals_of_product_description_and_support/sections/96-examples.adoc` contains 13 additional `stem:[…]` instances. No `[stem]` blocks elsewhere; no `:stem:` attribute declared anywhere.
- **Revised conclusion: AsciiMath rendering is needed in both `.exp` schema files and surrounding IGR `.adoc` documents.**

### Recon area M2: plurimath positioning (FACTS)

- Plurimath is a Ruby gem (Ribose, BSD-2-Clause) at `github.com/plurimath/plurimath`, with a JavaScript distribution at `github.com/plurimath-js/plurimath-js` (npm `@plurimath/plurimath`).
- The JS implementation is **not** a native port — it is the Ruby gem compiled via Opal. Verified in `dist/index.js` (603 B): `import "./plurimath-opal.js"; Opal.require("plurimath"); … Opal.Plurimath.Math.$parse(data, format);`. The payload `dist/plurimath-opal.js` is **2,785,725 B** per `curl -sI`. Published unpacked: 11,732,469 B / 28 files.
- API methods: `toAsciimath`, `toLatex`, `toMathml`, `toHtml`, `toOmml`, plus UnicodeMath in/out.
- **Plurimath converts; it does not render.** Per plurimath.org and Metanorma docs (`metanorma.org/author/topics/blocks/math/`): "Metanorma uses Plurimath to convert AsciiMath/LaTeX → MathML, then for HTML the MathML is processed by MathJax for browser compatibility." plurimath.org's demo "rendered" view is MathJax acting on plurimath's MathML output.
- Demo example on plurimath.org: `sum_(i=1)^n i^3=((n(n+1))/2)^2`.
- Metanorma's AsciiMath dialect adds extensions over standard ASCIIMathML v1.4.7 (`metanorma.org/author/ref/asciimath/`):
  - Symbols: `dx`, `dy`, `dz`, `dt`, `lim`, `qquad`, `setminus`, `frown`
  - Custom brackets: `|:` and `:|`
  - Capital Greek: `Alpha`, `Beta`, `Epsilon`, …
  - Extra fonts: `ii`, `bii`, `bcc`, `bfr`, `sfbi`
  - OOXML invisible brackets: `{:`, `:}`

### Recon area M3: JS AsciiMath renderer landscape (FACTS)

| npm name | latest | publish | license | unpacked / files | AsciiMath in? | output |
|---|---|---|---|---|---|---|
| `mathjax` | 4.1.1 | 2026-02-19 | Apache-2.0 | 19.97 MB / 105 | yes (legacy v2 jax patched into v3/v4) | CHTML, SVG, MathML |
| `mathjax` (v3) | 3.2.2 | 2022-06-08 | Apache-2.0 | 24.15 MB / 109 | yes | CHTML, SVG, MathML |
| `katex` | 0.16.45 | 2026-04-05 | MIT | 4.02 MB / 210 | **no** (LaTeX only) | HTML+CSS |
| `asciimath2tex` | 1.5.0 | 2024-04-19 | Apache-2.0 | 412 KB / 12 | yes (input only) | LaTeX |
| `asciimathml` | 2.4.3 | 2026-04-14 | MIT | 744 KB / 65 | yes | direct DOM MathML |
| `@plurimath/plurimath` | 0.2.2 | n/a | BSD-2-Clause | 11.73 MB / 28 | yes | AsciiMath/LaTeX/MathML/HTML/OMML (conversion only) |

Browser bundle sizes (raw, jsDelivr `content-length`):
- `katex@0.16.11/dist/katex.min.js`: 275,414 B
- `katex@0.16.11/dist/katex.min.css`: 23,335 B
- `mathjax@3.2.2/es5/tex-svg-full.js`: 2,275,113 B
- `mathjax@3.2.2/es5/tex-svg.js`: 2,108,580 B
- `mathjax@3.2.2/es5/tex-mml-chtml.js`: 1,173,007 B
- `asciimath2tex@1.5.0/dist/asciimath2tex.umd.js`: 25,510 B
- `asciimathml@2.4.3/ASCIIMathML.js`: 58,781 B
- `@plurimath/plurimath/dist/plurimath-opal.js`: 2,785,725 B

KaTeX explicitly does not accept AsciiMath (issue `#1472`). MathJax v3/v4 AsciiMath support is partial: `docs.mathjax.org/en/latest/input/asciimath.html` — "the AsciiMath input jax has not yet been fully ported to version 3 or 4. Instead, the AsciiMath component uses the version 2 AsciiMath input jax… handles only the original ASCIIMathML notation (from ASCIIMathML v1.4.7)" and does NOT include the extended LaTeXMathML notation. `asciimath2tex` README: "All tests render correctly under KaTeX, apart from `\twoheadrightarrowtail`."

### Recon area M4: Plurimath vs JS-renderer equivalence (FACTS)

- Single worked example available (plurimath.org demo): `sum_(i=1)^n i^3=((n(n+1))/2)^2`. The plurimath.org "rendered" output is **rendered by MathJax** consuming plurimath's `toMathml()` — i.e. plurimath itself doesn't draw.
- Documented divergence sources:
  - Metanorma extensions (M2 list) are outside ASCIIMathML v1.4.7, which is what MathJax-AsciiMath targets per its own docs. Therefore inputs using Metanorma extensions parse under Plurimath but may fail under MathJax-AsciiMath / ASCIIMathML.js / asciimath2tex.
  - `asciimath2tex` README acknowledges glyph divergence on `\twoheadrightarrowtail` under KaTeX.
- The 13 in-corpus `stem:[…]` examples use only simple constructs (`kg·m·s^{-2}`, `T_{f} = 1.8 x T_{c} + 32`) within the intersection of all candidate parsers. Nothing in the corpus exercises Metanorma-specific extensions.
- **Pixel-level equivalence is not measured.** See open question M3.

### Recon area M5: VS Code popup editor/viewer surfaces (FACTS)

- **Math is NOT rendered in hover-widget markdown.** Per microsoft/vscode-discussions search-result excerpt: "Math rendering is not supported in markdown displayed in the hover widget, unlike regular markdown rendering. The markdown previewer is implemented in a sandbox using iframes, while the hover widget is not." Listed unsupported features: math, mermaid.
- Microsoft's `extensions/markdown-math` README: KaTeX is bundled and active **only in markdown preview / notebook markdown cells**. Not in hover.
- LaTeX-Workshop's documented workaround for hover math: pre-rasterize via MathJax in a webview, capture as PNG data URI, embed `<img>` in the MarkdownString.
- **Webview surfaces:**
  - `vscode.window.createWebviewPanel` (`code.visualstudio.com/api/extension-guides/webview`) is the standard surface. Webviews run in Chromium; current VS Code ships Chromium 124+; Chromium 109+ (Jan 2023) supports MathML-Core natively (Igalia/chromestatus 2023-01-10). **MathML renders in webviews without any JS library.**
  - `CustomEditor` API: text-backed or readonly variants — covered in base recon area 5.
  - **Embedding the Monaco editor inside a webview is officially out-of-scope** per VS Code issue `#153198`. Custom WebView Editor API explicitly lists "Embedding of VS Code's text editor in webviews" as a Non-Goal. Bundling Monaco separately (`@codingame/monaco-vscode-api`) loses theme/setting parity.
  - Notebook math is `.ipynb`-only; not relevant to `.exp` files.
  - `QuickPick` / `InputBox`: text-only — too constrained for math editing.

### Recon area M6: Bundle implications — math (FACTS)

| Candidate | What ships to webview | Raw cost | Activation |
|---|---|---|---|
| KaTeX (LaTeX only) | `katex.min.js` 275 KB + CSS 23 KB + ~28 woff/woff2 files | ≈ 300 KB JS+CSS plus fonts | webview asset, lazy on first preview |
| KaTeX + asciimath2tex | + 26 KB shim | ≈ 325 KB | same |
| MathJax v3 tex-svg | 2.11 MB single self-contained file | ≈ 2.1 MB | dynamic-import-able into webview |
| MathJax v3 tex-svg-full | 2.28 MB | ≈ 2.3 MB | same |
| MathJax v4 with AsciiMath component | unmeasured for v4 | open question M1 | must explicitly load `input/asciimath` |
| ASCIIMathML.js direct | 58.8 KB raw | ≈ 60 KB; produces MathML; relies on Chromium native MathML | trivial |
| Plurimath JS | 2.79 MB Opal blob + 603 B wrapper | conversion only — needs renderer downstream | dynamic-import-able |

Activation discipline: all candidates can be loaded **as webview assets**, not into the extension host. The relevant cost surface is `.vsix` package size on the marketplace and webview load time on first popup open.

**Native-MathML escape hatch:** "Plurimath JS in webview → MathML string → set `<math>` innerHTML in webview → Chromium renders natively" needs zero rendering library, only Plurimath's converter. Cost ≈ 2.8 MB Opal blob, no fonts. Equivalent fidelity to Metanorma's authoring stack since the same converter runs.

Not measured: gzipped sizes; MathJax v4 AsciiMath component breakdown; KaTeX font subset cost; esbuild tree-shake on KaTeX.

---

### Open questions log (to address in Phase 1)

| # | Area | Question | Next research path |
|---|------|----------|--------------------|
| 1 | base | Vanilla VS Code SVG behavior — source-only inferred but not officially confirmed | Launch clean VS Code, observe; or find authoritative GitHub issue |
| 2 | base | Stock asciidoctor.js fidelity for Metanorma `[.svgmap]` extension | Survey Metanorma asciidoctor extensions on npm; determine acceptable degraded rendering |
| 3 | base | ~~EXPRESS-G `p21_diagram.py` SVG format vs annotated-express base64-GIF format~~ — **RESOLVED (owner): the SVG viewer must support both formats** (annotated-express base64-GIF wrapped + `<a href="N">` hot-spots, AND express-g skill pure-SVG primitives) | n/a — Phase 1 designs both code paths |
| 4 | base | Should AsciiDoc viewer parse `(*"…"…*)` independently or via Langium hidden-token API? | Inspect Langium CST hidden-token retention; fallback regex source scan |
| 5 | base | Do annotated `.exp` files use `[source,…]` listings, AsciiDoc tables, or `include::`? | `grep -E "include::\|^\[source\|^\|===" data/resources/*/*_annotated.exp` |
| 6 | base | Activation cost of bundling asciidoctor into client | Throwaway esbuild build; time `require()` cold start |
| 7 | base | Can Langium's IndexManager resolve `<<express:schema.entity>>` xrefs to source URIs? | Inspect `src/language/express-p11-index-manager.ts` |
| 8 | base | File-watcher concurrency between LSP and preview for same `.exp` | Langium docs on multiple-consumer file watching |
| 9 | base | Where do `.svg` files live in typical user workspaces (vs annotated-express co-located)? | Survey `wg12-stepmod`, `tf1-srl-prototype` and similar |
| 10 | base | MarkdownString hover image loading from local file URIs — trusted-source / `baseUri` rules | VS Code source on `MarkdownString.baseUri` resolution |
| M1 | math | MathJax v4 AsciiMath component file size | Inspect `mathjax@4.x` `es5/input/asciimath*.js` directly |
| M2 | math | Pure-WASM TeX renderers (`tectonic-web`, `swiftlatex`) viability and size | WebSearch + check repos |
| M3 | math | Pixel/glyph diff between Plurimath, MathJax-AsciiMath, ASCIIMathML.js, asciimath2tex+KaTeX on the 13 in-corpus stem expressions | Run all four parsers on each example in a throwaway harness |
| M4 | math | Whether Metanorma-specific AsciiMath constructs appear in any other annotated-express resource (outside `96-examples.adoc`) | Wider grep across all ISO 10303 IGR repos accessible to user |
| M5 | math | VS Code hover-widget MathML support — does raw `<math>` survive `MarkdownString.supportHtml=true` sanitisation? | Markdown-it pipeline source review; or empirical test |
| M6 | math | Plurimath JS `toHtml()` output shape — pre-rendered or just MathML wrapped? | Run plurimath in node throwaway script |
| M7 | math | Gzipped sizes for all math-renderer candidates | jsDelivr or local `gzip --best` measurement |
| M8 | math | Metanorma's PDF/Word path beyond MathML | Lower priority; not gating the VS Code popup |

---

### Phase 0 addenda (owner inputs, 2026-05-02)

1. **AsciiMath corpus correction.** The annotated-express survey was not representative — wg12-step schemas (e.g. `geometry_schema.exp`) contain hundreds of `stem:[…]` expressions with rich Metanorma constructs. AsciiMath rendering is required for `.exp` files, not just IGR `.adoc` documents.
2. **SVG dual-format requirement.** The SVG viewer must support both the annotated-express format (base64-GIF wrapped in `<svg>` with `<a href="N">` hot-spots) and the `express-g` skill format (pure SVG primitives). Open question 3 is resolved as "both" — Phase 1 must design both code paths.
3. **Renderer selection priority: accuracy.** The owner has no strong preference among the three math-rendering paths beyond *accurate rendering of the math*. Phase 1 should weight rendering fidelity against the corpus (now 754 examples in geometry_schema alone) above bundle size. This nudges Phase 1 toward Plurimath (since it is the same converter Metanorma uses, giving behavioural parity), but does not yet decide.

## Phase 0 exit gate

**Annotated EXPRESS** is a fully specified format used in 25 schemas in the annotated-express corpus and additionally across wg12-step. The Langium grammar treats remarks as hidden tokens, so any viewer must scan source text directly. **EXPRESS-G SVGs** referenced via `__expressg` remarks couple AsciiDoc rendering and SVG rendering functionally — they are not independent features; both annotated-express base64-GIF format and pure-SVG (express-g skill) format must be supported. **AsciiMath** appears richly in `.exp` files (754 instances in geometry_schema alone) and in IGR `.adoc` documents — it is in scope as a first-class rendering target, not a peripheral nicety. Easy-express has no webviews / custom editors / hover providers today; bundle is ~2.45 MB combined. AsciiDoc rendering options span 728 KB (asciidoctor.js browser min) to 44 KB (downdoc, lossy) to zero (depend on the `asciidoctor.asciidoctor-vscode` extension — but it has no public API). SVG rendering has multiple zero-dependency paths via webview. Hover popups support a sanitized HTML subset with `<img>` but not `<svg>`, so AsciiDoc-in-hover is feasible for short snippets while EXPRESS-G interactive maps require a webview. Three feasible math-rendering paths exist: KaTeX+asciimath2tex (~325 KB, risk of construct gaps), MathJax (2.1–2.3 MB, ASCIIMathML v1.4.7 only), or Plurimath→native-MathML in Chromium (~2.8 MB, behaviour parity with Metanorma since same converter runs). Owner has set rendering accuracy as the priority criterion. VS Code hovers do **not** render math; webviews do. Seventeen open questions remain (one resolved by addendum); all are addressable in Phase 1; **no blockers prevent advancement**.

### Critical files for downstream phases

- `/Users/tom/work/easy-express/package.json` — dependencies, activation events, `contributes`
- `/Users/tom/work/easy-express/src/extension/main.ts` — extension host entry, where webview/hover providers register
- `/Users/tom/work/easy-express/esbuild.mjs` — bundling pipeline; needs splitting if lazy-loading
- `/Users/tom/work/easy-express/src/language/express.langium` — grammar; hidden-token policy
- `/Users/tom/work/easy-express/src/language/express-p11-index-manager.ts` — possible source for resolving `<<express:…>>` xrefs
- `/Users/tom/test_git/annotated-express/syntax.adoc` — annotated-EXPRESS spec
- `/Users/tom/test_git/annotated-express/data/documents/resources/fundamentals_of_product_description_and_support/sections/96-examples.adoc` — 13 stem test fixtures
- `/Users/tom/test_git/annotated-express/metanorma.yml` — collection-level Metanorma config

### Phase 0 sign-off

- [x] Owner has reviewed Phase 0 evidence
- [x] Open questions 1–10 (base) and M1–M8 (math) acknowledged for Phase 1 resolution
- [x] Approved to proceed to Phase 1: Design Spec

**Signed off by:** Thomas Thurman
**Date:** 2026-05-02

---

## PHASE 1: DESIGN SPEC

### 1.1 Open question resolutions

| # | Status | Resolution |
|---|--------|------------|
| Q1 | RESOLVED | VS Code 1.97+ (Jan 2025) renders `.svg` natively in the built-in image preview. **Implication:** vanilla SVG display is no longer a gap; our SVG viewer's job is **interactive hot-spot navigation**, not display. |
| Q2 | RESOLVED-AS-CONSTRAINT | Stock asciidoctor.js does not implement Metanorma's `[.svgmap]` block. Phase 2 POC will accept degraded rendering (image + bullet list, no clickable map); interactivity comes from the dedicated SVG viewer + IndexManager xref resolution. |
| Q3 | RESOLVED (owner) | SVG viewer must support both formats: annotated-express base64-GIF wrapped + `<a href="N">` hot-spots, AND express-g skill pure-SVG primitives. |
| Q4 | RESOLVED | Langium retains `ML_COMMENT` as hidden CST leaves. Extract via `streamCst(doc.parseResult.value.$cstNode!).filter(n => n.hidden && n.tokenType?.name === 'ML_COMMENT')`. The `(*"tag" body *)` substructure is not split — regex-parse `leaf.text` for tag and body. |
| Q5 | RESOLVED | Real `.exp` named-remarks use AsciiDoc tables (`\|===`), `[source]----…----` listings, `[example]` and `[.svgmap]` open-blocks, `image::*.svg[]`, `stem:[]`, `latexmath:[]`, `<<express:…>>` xrefs. **No `include::` directives** — preprocessor support not needed. |
| Q6 | DEFERRED-TO-POC | Activation cost of bundled asciidoctor measured during Phase 2; mitigation strategy already chosen (run renderer in webview, not extension host). |
| Q7 | RESOLVED | `services.shared.workspace.IndexManager.allElements()` returns `Stream<AstNodeDescription>` carrying `documentUri` + `nameSegment.range`. Direct lookup by name. Open detail: whether qualified-name keys are `"entity"` or `"schema.entity"` — verify with 5-line probe in Phase 2. |
| Q8 | RESOLVED | VS Code dedupes identical `(resource, options)` watchers at IFileService — no duplicate disk reads. Both subscribers receive each event; preview must idempotently handle change events. |
| Q9 | RESOLVED | Dominant convention: SVGs **co-located** with `.exp`, named `<schema>expg<N>.svg` (matches `image::file.svg[]` implicit relative resolution). Minor exception: `images/` subdir in some directories. Document-level images live in `documents/iso-10303-*/images/`. |
| Q10 | RESOLVED-WITH-WORKAROUND | `<img>` is allowed in `MarkdownString.supportHtml=true`. `<img src="file:///…">` historically failed (issue #136027); reliable path is **markdown image syntax `![alt](abs/path)`** or raw filesystem path in `<img src="/abs/path">`. `webview.asWebviewUri` does NOT apply outside webviews. |
| M1 | RESOLVED | MathJax v4 `input/asciimath.js` = 104 KB; minimum runtime stack ~270 KB raw. Moot — Plurimath chosen. |
| M2 | RESOLVED | `tectonic-web` and `swiftlatex` do **not exist on npm**. SwiftLaTeX is `<script>`-tag only. Pure-WASM TeX path not viable as a packaged dependency. |
| M3 | RESOLVED-EMPIRICALLY | All three candidates (Plurimath, MathJax v4 AsciiMath, asciimath2tex+KaTeX) handle all 10 fixtures plus all stress cases including Metanorma `bb"…"`. Comparison artifact at `test-fixtures/asciimath/render-comparison.html`. **Owner chose Plurimath.** |
| M4 | RESOLVED | Metanorma AsciiMath extensions are sparse in wg12-step: `:}` (piecewise/cases) in 3 schemas, `bii` (bold-italic) in 1 schema, `dx/dy/dz` are just identifiers. Standard Plurimath handles all natively (it's the source converter). |
| M5 | RESOLVED | Raw MathML elements (`<math>`, `<mi>`, etc.) are stripped by `MarkdownString.supportHtml=true` sanitization. Hover-side math must use `<img>` (pre-rasterized PNG) or `![]()` markdown image. **Implication:** in-hover math rendering is degraded vs webview rendering. |
| M6 | RESOLVED | Plurimath `toHtml()` returns a low-fidelity inline `<i>/<sub>/<sup>` rendering, **not** MathML or self-styled output. **Use `toMathml()`** and rely on Chromium native MathML rendering inside webviews. |
| M7 | RESOLVED | Gzipped sizes: KaTeX 74 KB, MathJax v3 tex-svg 660 KB, ASCIIMathML 14.5 KB, **Plurimath engine 480 KB**, asciimath2tex 6 KB. Plurimath's gzipped weight (~480 KB) is much more tractable than its 2.79 MB raw. |
| M8 | RESOLVED | Metanorma's PDF/Word output paths use `mn2pdf`/JEuclid/OMML — **irrelevant to the VS Code popup**. Choosing Plurimath JS for the popup matches Metanorma's own AsciiMath→MathML conversion upstream of formatting. |

### 1.2 Architectural decisions

#### 1.2.1 Viewer surfaces

| Surface | Purpose | VS Code primitive | Renders |
|---------|---------|-------------------|---------|
| `description.hover` | Short remark preview on hover over an entity/attribute name | `HoverProvider` + `MarkdownString` (`supportHtml=true`) | First N words of remark text, AsciiDoc → markdown via `downdoc` (lossy but ~6 KB gz, no host activation cost). Math degraded to plain text fallback. Cross-refs as `command:` URLs. |
| `description.preview` | Full-fidelity rendering of a single remark or all remarks for a schema | `WebviewPanel` (read-only, retainable) | Asciidoctor.js → HTML; `stem:[]` extracted and replaced with Plurimath-emitted `<math>`; Chromium-native MathML rendering. |
| `expressg.preview` | Interactive EXPRESS-G diagram viewer with hot-spot navigation | `WebviewPanel` | Native `<svg>` inline (both formats: base64-GIF wrapped + pure SVG primitives). Click on `<a href="N">` → `postMessage` to extension host → IndexManager xref resolution → `showTextDocument` at target. |
| `math.playground` | Popup AsciiMath editor + live preview | `WebviewPanel` | Two-pane: textarea on left, Plurimath-emitted MathML on right (debounced). "Insert" button posts the source back into the active editor at cursor. |

#### 1.2.2 Renderer pipeline

```
named-remark (raw text)
        │
        ▼
┌──────────────────────────────┐
│ remark-parser (regex on      │   runs in extension host;
│ ML_COMMENT hidden tokens)    │   ~50 LOC, no deps
└──────────────────────────────┘
        │ {tag: "schema.entity.__note", body: "…"}
        ▼
┌──────────────────────────────┐   ┌──────────────────────┐
│ asciidoctor (browser bundle) │   │ stem:[] preprocessor │
│ runs in webview              │◄──│ extracts each stem,  │
│                              │   │ asks plurimath, swaps│
│                              │   │ in <math>            │
└──────────────────────────────┘   └──────────────────────┘
        │ HTML with embedded <math>
        ▼
   webview body
   (Chromium-native MathML rendering)
```

#### 1.2.3 Math pipeline

- **Choice: Plurimath JS** (engine ~480 KB gzipped). Same converter Metanorma uses — guaranteed parity for `:}`/cases, `bii`, and any future Metanorma extensions.
- Extension host imports `@plurimath/plurimath` lazily via dynamic `import()`; the heavy Opal blob is shipped as a webview asset and run in-webview, not in the extension host.
- Render path: `stem:[asciimath]` → `new Plurimath(asciimath, 'asciimath').toMathml()` → splice MathML into AsciiDoc-rendered HTML → Chromium renders natively.
- **`toHtml()` is not used** (low-fidelity per M6).
- **Hover degradation** (M5 constraint): inline `stem:[]` in hovers becomes the raw AsciiMath source surrounded by backticks, OR a pre-rasterized SVG image embedded as data URI (Phase 2 will measure cost).

#### 1.2.4 Langium integration boundary

- **Annotation Index service** (new): a workspace-level service that, on document parse, walks the CST for `ML_COMMENT` hidden leaves, regex-parses each into `{tag, body, range}`, and indexes by tag (e.g. `schema_name.entity_name.__note`). Implements `LangiumDocumentBuilder` listener.
- **Xref resolver**: `<<express:schema.entity>>` → `services.shared.workspace.IndexManager.allElements()` → match → `vscode.window.showTextDocument(uri, {selection: nameSegment.range})`.
- **Hover provider**: `vscode.languages.registerHoverProvider({language: 'express'}, ...)` — at cursor, find the AST entity/attribute, query the Annotation Index for its tag, return `MarkdownString` with truncated body.

#### 1.2.5 package.json contribution-point changes

```json
{
  "activationEvents": [
    "workspaceContains:**/*.exp"           // unchanged
  ],
  "contributes": {
    "commands": [
      // existing:
      { "command": "express.buildWorkspace", ... },
      { "command": "express.buildGraph", ... },
      // new:
      { "command": "express.showDescription", "title": "Show Description", "category": "EXPRESS" },
      { "command": "express.showExpressG",   "title": "Show EXPRESS-G Diagram", "category": "EXPRESS" },
      { "command": "express.openMathPlayground", "title": "Open AsciiMath Playground", "category": "EXPRESS" }
    ],
    "menus": {
      "editor/context": [
        { "command": "express.showDescription", "when": "editorLangId == express", "group": "navigation" },
        { "command": "express.showExpressG",    "when": "editorLangId == express", "group": "navigation" }
      ]
    }
  }
}
```

No `customEditors`, `views`, or `viewsContainers` contributions needed for Phase 2 POC. (Optional Phase 3: register a `customEditor` for `*.svg` next to `.exp` files, gated by `priority: option`.)

#### 1.2.6 Bundle strategy

```
out/
├── extension/
│   └── main.cjs                       (~770 KB, unchanged from baseline)
├── language/
│   └── main.cjs                       (~1.8 MB, unchanged)
└── webview/
    ├── description-preview.html       (loads vendor assets)
    ├── expressg-preview.html
    ├── math-playground.html
    └── vendor/
        ├── asciidoctor.min.js         (~728 KB raw / ~250 KB gz)
        ├── plurimath/                 (engine + wrapper)
        │   ├── plurimath-opal.js      (~2.8 MB raw / ~480 KB gz)
        │   └── index.js               (603 B)
        ├── dompurify.min.js           (~50 KB raw / ~21 KB gz)  [new — security]
        └── shared.css
```

Renderers ship as **webview assets**, not as host-bundle dependencies — the extension host imports nothing heavier than its current 770 KB. Esbuild config gains a third entry point for tiny TypeScript controllers attached to each webview HTML file.

Direct deps added (exact-version pinned per §1.2.8.8):
- `@asciidoctor/core` (NOT the `asciidoctor` wrapper, which pulls `ejs`/`pug`/`nunjucks`/`handlebars` transitively)
- `@plurimath/plurimath`
- `dompurify`

#### 1.2.7 Activation cost ceiling

- Cold-start (no preview): unchanged from baseline.
- First preview open: load Asciidoctor.js into webview (~250 KB gz over local fs).
- First math render: load Plurimath into webview (~480 KB gz).
- Both webview-resident; navigating away from the panel discards them.

#### 1.2.8 Security model

Concrete mitigations applied to each viewer surface. All `.exp` content (and any embedded SVG) is treated as **untrusted project data**, on the same trust boundary as a markdown preview.

##### 1.2.8.1 Per-surface webview isolation

Each viewer is its own `WebviewPanel` with its own HTML, CSP, and message channel. A compromise in one webview cannot escalate to another. Specifically:

| Webview | Loads | CSP `script-src` |
|---------|-------|------------------|
| `description.preview` | Asciidoctor.js + DOMPurify + Plurimath (for embedded `stem:[]`) | `'self' 'unsafe-eval'` |
| `expressg.preview` | DOMPurify + tiny click-handler shim | `'self'` (no eval needed) |
| `math.playground` | Plurimath only | `'self' 'unsafe-eval'` |

##### 1.2.8.2 Content Security Policy

`unsafe-eval` is **required** in two of the three webviews because both Plurimath/Opal (15 `eval(` + 5 `new Function(`) and Asciidoctor.js (2 `new Function(`) use runtime code generation as part of Opal's Ruby method dispatch. This is unavoidable for these libraries; mitigation is per-surface isolation (above).

Webview HTML `<head>` template:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src ${webview.cspSource} 'unsafe-eval';
               style-src ${webview.cspSource} 'unsafe-inline';
               img-src ${webview.cspSource} data: file:;
               font-src ${webview.cspSource};
               connect-src 'none';">
```

Notes:
- `script-src ${webview.cspSource}` (drop `'unsafe-eval'` for `expressg.preview`)
- `connect-src 'none'` blocks any outbound network call from a compromised webview
- `default-src 'none'` denies anything not explicitly allowed
- `style-src 'unsafe-inline'` is needed for Asciidoctor's stylesheet injection; trade-off accepted

##### 1.2.8.3 SVG sanitization

Inlined SVG is required for hot-spot click interception (`<img src>` does not propagate `<a href>` clicks back to JS). Inline SVG is an XSS vector — `<script>`, `<foreignObject>` with HTML, `javascript:` URLs, `on*` event attributes can all execute.

**Mitigation**: sanitize via [DOMPurify](https://github.com/cure53/DOMPurify) (MIT, ~21 KB gz) before injection. Configured allow-list:

```js
DOMPurify.sanitize(svgText, {
  USE_PROFILES: { svg: true, svgFilters: false },
  ALLOWED_TAGS: ['svg', 'g', 'rect', 'path', 'text', 'tspan', 'a', 'image', 'defs', 'marker', 'line', 'circle', 'ellipse', 'polygon', 'polyline'],
  ALLOWED_ATTR: ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'fill', 'stroke', 'stroke-width', 'transform', 'viewBox', 'xmlns', 'href', 'xlink:href', 'class', 'id', 'style'],
  ALLOWED_URI_REGEXP: /^(#|data:image\/(gif|png|jpeg|jpg|svg\+xml);base64,|[0-9]+$)/,
  FORBID_TAGS: ['script', 'foreignObject', 'use'],
  FORBID_ATTR: ['onload', 'onclick', 'onerror', 'onmouseover', 'onmouseout', 'onfocus', 'onblur'],
});
```

The `ALLOWED_URI_REGEXP` is critical: it permits `#fragment`, base64-encoded image data URIs (the annotated-express embedded-GIF format), and bare integer `href` values (the EXPRESS-G hot-spot indices). All other URI schemes (`javascript:`, `data:text/html`, `vbscript:`, `file:`, `http(s):`) are stripped.

##### 1.2.8.4 AsciiDoc safe mode + HTML sanitization (defense in depth)

**Empirical finding (Phase 2)**: Asciidoctor's `:safe-mode: secure` blocks `include::` and external attribute reads, but **does NOT strip `pass:[…]` or `+++…+++` passthroughs**. Tests in `src/test/security.test.ts` confirm both surface in the rendered HTML even at the strictest safe level.

**Mitigation**: layered defense — Asciidoctor with `:safe-mode: secure` followed by DOMPurify HTML sanitization on the output before injection. The HTML allow-list permits MathML elements (for `stem:[]` rendering) and a restricted `command:` URI scheme (only `vscode.open` and `express.*`).

```js
const html = asciidoctor.convert(body, {
  safe: 'secure',
  doctype: 'article',
  attributes: { showtitle: false, noheader: true },
});
const sanitized = DOMPurify.sanitize(String(html), HTML_PURIFY_CONFIG);
// HTML_PURIFY_CONFIG: ALLOWED_TAGS includes MathML;
// ALLOWED_URI_REGEXP: /^(https?:|mailto:|#|command:vscode\.open|command:express\.)/
// FORBID_TAGS: script, style, iframe, object, embed, form, input, button
// FORBID_ATTR: onload/onclick/onerror/onmouseover/.../style
```

This change adds DOMPurify to `description.preview` (it was already loaded in `expressg.preview`). The `math.playground` does not need it — its only input is the user's own AsciiMath source going to Plurimath, never HTML.

**Architecture revision (post-Phase-2)**: math is pre-rendered **on the host** via Plurimath in node, and the resulting MathML is sent to the webview through the JSON payload. The webview no longer loads or executes Plurimath — its Opal runtime fails to initialize via webview dynamic `import()` (Opal's "r is not a function" inside `Opal.modules.parser`). This shrank the webview attack surface (Opal's 15× `eval()` is no longer in webview's `'unsafe-eval'` context). The host-side parser is now a new attack-surface concern; see §1.2.8.10.

##### 1.2.8.5 MarkdownString hover trust scope

`MarkdownString.isTrusted: true` enables ALL `command:` URLs — including destructive ones (`workbench.action.terminal.sendSequence`, etc.). Always use the **array form**:

```ts
const md = new vscode.MarkdownString();
md.supportHtml = true;
md.isTrusted = { enabledCommands: [
  'vscode.open',
  'express.showDescription',
  'express.showExpressG',
] };
```

##### 1.2.8.6 Webview→host message validation

All messages from webviews are validated against a strict schema before any host action. Example shape:

```ts
type WebviewMessage =
  | { kind: 'navigate'; targetName: string }     // SVG hot-spot click
  | { kind: 'insert'; text: string }              // math playground "Insert"
  | { kind: 'log'; level: 'info'|'warn'|'error'; message: string };

function validate(msg: unknown): WebviewMessage | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as any;
  switch (m.kind) {
    case 'navigate':
      if (typeof m.targetName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(m.targetName)) return null;
      return { kind: 'navigate', targetName: m.targetName };
    case 'insert':
      if (typeof m.text !== 'string' || m.text.length > 4096) return null;
      return { kind: 'insert', text: m.text };
    case 'log':
      if (typeof m.message !== 'string' || m.message.length > 1024) return null;
      return { kind: 'log', level: m.level === 'info' || m.level === 'warn' || m.level === 'error' ? m.level : 'info', message: m.message };
    default: return null;
  }
}
```

Host handlers must:
- Never `require()`/`import()` based on message data
- Never spawn child processes from message contents
- Resolve any file paths through workspace `Uri` APIs (which respect `localResourceRoots`)
- Validate `targetName` against IndexManager output (i.e. only navigate to known schema entities)

##### 1.2.8.7 `localResourceRoots` scope

Each `WebviewPanel.webview.options.localResourceRoots` whitelist is **the minimum needed**:

```ts
{
  localResourceRoots: [
    extensionContext.extensionUri,                 // for vendor assets (asciidoctor, plurimath, dompurify)
    vscode.workspace.getWorkspaceFolder(activeUri)?.uri,  // for SVGs and other project-relative assets
  ].filter(Boolean)
}
```

Never pass the user's home directory, `vscode.Uri.file('/')`, or arbitrary paths from messages.

##### 1.2.8.8 Dependency hygiene

- `@asciidoctor/core` (NOT the `asciidoctor` wrapper) — direct dep avoids transitive `ejs`, `pug`, `nunjucks`, `handlebars` (we use none of them).
- Pin versions exactly in `package.json` (`"@asciidoctor/core": "3.0.4"`, not `"^3.0.4"`). Lock-file integrity hashes catch tampering.
- `npm audit` on the renderer set is currently clean (0 vulnerabilities, audited 2026-05-02).
- Subscribe to advisories on `asciidoctor/asciidoctor.js`, `plurimath/plurimath`, `plurimath-js/plurimath-js`; re-audit before each release.

##### 1.2.8.9 Trust boundaries summary

| Trust source | Treatment |
|--------------|-----------|
| `.exp` file content | Untrusted data; goes to Asciidoctor (safe:secure) and Plurimath (host-side) parsers; renderer input only; never executed |
| AsciiMath in `stem:[]` | Untrusted string; goes to Plurimath/MathJax parsers in **node** (extension host); not eval'd as code |
| Co-located `*.svg` files | Untrusted; sanitized via DOMPurify before inline injection |
| User keystrokes in math playground | Untrusted; goes to Plurimath parser (in webview when Opal works, else host round-trip); debounced and length-capped |
| Hot-spot `targetName` from webview | Untrusted; regex-validated `[A-Za-z_][A-Za-z0-9_.]*`; no `/`, `\`, `..` |
| Webview→host messages | Untrusted; schema-validated; whitelisted commands only |
| Vendor JS (Asciidoctor, Plurimath, MathJax, DOMPurify) | Trusted under exact-version pinning; CSP confines webview runtime; host runtime relies on `npm audit` and pinned versions |

##### 1.2.8.10 Resource limits (post-Phase-2)

Host-side parsers (Plurimath, MathJax v4) now process untrusted AsciiMath content from `.exp` files. Bounding the work prevents pathological-input DoS and unbounded memory growth.

| Limit | Value | Where | Effect |
|-------|-------|-------|--------|
| Per-expression chars | 16,384 | `webviews.ts:prerenderMath`, `hover-math.ts:renderAsciiMathSvgAsync` | Reject oversized stems before parser entry |
| Stems per document (description preview) | 500 | `webviews.ts:prerenderMath` | Cap total Plurimath work per render |
| Stems per hover preview | 32 | `hover-provider.ts:gatherMathRenders` | Hover preview is already truncated to ~360 chars; defensive |
| MathJax SVG cache size | 1,000 entries (LRU) | `hover-math.ts` `cache` | Prevent unbounded memory growth in long sessions |
| Async render timeout | 2,000 ms per expression | `hover-math.ts:withTimeout` (MathJax `asciimath2svgPromise`) | Timeout for async path; sync Plurimath call cannot be timed out without worker-thread isolation — character cap is the practical bound there |

Future hardening (out of POC scope but tracked here):
- Move host-side Plurimath calls into a worker thread so a hang there doesn't block the extension event loop. Current design accepts a synchronous call because Plurimath JS doesn't expose an async API.
- Add a global per-second render budget if user reports show degraded responsiveness.

#### 1.2.9 Out of scope for Phase 2

- Live editing of AsciiDoc descriptions (description preview is read-only).
- Saving math from playground back to the schema (insert command exists but is a stub).
- LaTeX input mode in the math playground.
- `customEditor` registration for `*.svg`.
- AsciiDoc preview command for `*.adoc` files outside `.exp` (out of project scope).

### 1.3 POC exit criteria (Phase 2)

The Phase 2 POC succeeds when, on `~/test_git/sd.iso.org/wg12-step/schemas/resources/geometry_schema/geometry_schema.exp`:

1. `express.showDescription` over a cursor on `point` (line 3294) opens a webview rendering the `__note` AsciiDoc body with bold/links/cross-refs visible.
2. The same description's `stem:[RR^m]` renders as typeset math (vector "ℝᵐ" form), produced via Plurimath → MathML → Chromium.
3. `express.showExpressG` opens a co-located `geometry_schemaexpg<N>.svg`; clicking a hot-spot opens the target schema location.
4. `express.openMathPlayground` shows two panes; typing `sum_(i=1)^n i^3=((n(n+1))/2)^2` in the input pane renders typeset math in the output pane within 200ms of stop-typing.
5. Hover over the same `point` entity name in the editor shows a `MarkdownString` with the first ~200 chars of the description.
6. `npm run build` succeeds; combined extension-host bundle remains ≤ 800 KB; webview-vendor assets total ≤ 4 MB on disk.
7. All 42 existing tests still pass; new tests exercise (a) named-remark CST extraction and (b) tag-string regex parsing.
8. **Security verification** (§1.2.8): each webview's CSP headers are present and per-surface; DOMPurify strips a deliberately-malicious test SVG (containing `<script>`, `<foreignObject>`, `javascript:` URLs); Asciidoctor `:safe-mode: secure` rejects a deliberately-malicious test remark with `+++<script>`; `MarkdownString.isTrusted` is the array form; webview→host message validator rejects malformed/oversized payloads.

### 1.4 Phase 1 sign-off

- [x] Owner has reviewed Phase 1 design
- [x] All 17 Phase-0 open questions resolved or explicitly deferred
- [x] Security mitigations §1.2.8 reviewed and accepted
- [x] Approved to proceed to Phase 2: Proof of Concept

**Signed off by:** Thomas Thurman
**Date:** 2026-05-02

## PHASE 2: PROOF OF CONCEPT

### 2.1 What was built

Implementation of all four viewer surfaces per the §1.2 architecture, with the deliberate Phase-2 simplifications noted in §1.2.4 (regex-based annotation extraction in extension host instead of Langium server-side; direct-fs-scan xref resolver instead of IndexManager).

| Surface | Implementation file(s) | Status |
|---------|------------------------|--------|
| `description.hover` | `src/extension/hover-provider.ts`, `hover-math.ts` | Complete; renders xref command-links and stem:[] as inline SVG via MathJax-in-host |
| `description.preview` | `src/extension/webviews.ts:descriptionHtml`, `src/webview/description-preview.ts` | Complete; host-side Plurimath pre-render → Asciidoctor (safe:secure) → DOMPurify → Chromium native MathML |
| `expressg.preview` | `src/extension/webviews.ts:showExpressGPreview`, `src/webview/expressg-preview.ts` | Complete; SVG sanitized via DOMPurify; hot-spot navigation via `__expressg` `[.svgmap]` parsing |
| `math.playground` | `src/extension/webviews.ts:openMathPlayground`, `src/webview/math-playground.ts` | **Deferred to Phase 3.** Webview-side Plurimath dynamic import fails the same way the description preview's did before host-side pre-rendering. |

### 2.2 Architectural findings recorded for Phase 1 / Phase 3 reconciliation

- **Plurimath cannot run in the webview**: bundled via esbuild fails (`r2 is not a function` in `Opal.modules.parser`); native ESM via dynamic `import()` fails the same way (`r is not a function`). The Opal runtime's module loader is incompatible with both code paths. Description preview pivoted to host-side Plurimath rendering; the same pattern needs to apply to the math playground in Phase 3 with debounced bidirectional messaging.
- **Asciidoctor's `:safe-mode: secure` does not strip `pass:[…]` or `+++…+++`** — required adding DOMPurify sanitization on the HTML output as defense in depth (§1.2.8.4).
- **MathJax v4 cannot be esbuild-bundled** for extension host either (its v4 runtime path resolution breaks); marked external alongside `@plurimath/plurimath` (§1.2.6 bundle strategy revision).
- **VS Code 1.97+ renders SVG natively** in the built-in image preview (Q1 resolution after-the-fact confirmed in field). The EXPRESS-G viewer's value is **interactivity** (hot-spot click → entity navigation), not display.

### 2.3 POC exit criteria

Per §1.3 (with criterion 4 deferred):

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `showDescription` over `point` (line 3294) opens webview rendering body with bold/links/xrefs | ✓ verified live |
| 2 | `stem:[RR^m]` renders as typeset math | ✓ verified live (host-side Plurimath → Chromium-native MathML) |
| 3 | `showExpressG` opens correct SVG; hot-spot click navigates to target entity | ✓ verified live (point → polar_point via geometry_schemaexpg4.svg) |
| 4 | `openMathPlayground` renders within 200 ms | ⚠ **deferred to Phase 3** (math playground not yet host-side-rendered) |
| 5 | Hover shows `MarkdownString` with truncated description | ✓ verified live with rendered math + clickable xrefs |
| 6 | Bundle ceilings (host ≤ 800 KB, vendor ≤ 4 MB) | ✓ host 776 KB / vendor 3.9 MB |
| 7 | All 42 existing tests pass + new tests for parser/tag/security | ✓ 70/70 pass (42 + 13 unit + 15 security) |
| 8 | Security verification (CSP, sanitization, isTrusted, message validator) | ✓ 15 tests + post-pass hardening (resource limits §1.2.8.10) |

### 2.4 Phase 2 sign-off

- [x] Owner has reviewed Phase 2 implementation live in dev host
- [x] 7/8 POC criteria met; criterion 4 (math playground) explicitly deferred to Phase 3
- [x] Architectural findings (§2.2) recorded for Phase 3 incorporation
- [x] Approved to proceed to Phase 3: Full Implementation

**Signed off by:** Thomas Thurman
**Date:** 2026-05-02

---

## PHASE 3: FULL IMPLEMENTATION

### 3.1 Scope

Production-quality versions of the Phase 2 viewers plus the architectural items deliberately deferred from Phase 2. No new features beyond closing criterion 4 — Phase 3 is hardening, not expansion.

### 3.2 Work items

#### 3.2.1 Math playground completion (closes POC criterion 4)

Pattern: same host-side Plurimath rendering used by description preview, adapted for interactive input via debounced bidirectional messaging.

- **Webview → host**: new message kind `renderMath` carrying `{ id: number, expr: string }`. Validator (§1.2.8.6) extended to accept it; `expr` is char-capped at 16 KB per §1.2.8.10.
- **Host → webview**: new outbound kind `mathRendered` carrying `{ id, mathml?, error? }`. Outbound messages don't go through `validateMessage` (the host is trusted), but the math playground controller validates `id` matches a pending request.
- **Debounce**: 200 ms after last keystroke; in-flight render is cancelled (request superseded by id).
- **Insert button**: unchanged (already posts `kind: "insert"`).
- **Latency budget**: target < 100 ms for typical expressions on a warm Plurimath process.

#### 3.2.2 Annotation index → Langium server-side

Per §1.2.4 design intent. The Phase 2 regex-in-extension-host implementation works but duplicates the parse work the language server already does on every document edit.

- New service `ExpressP11AnnotationIndex` wired into `ExpressP11Module` (`src/language/express-module.ts`).
- Subscribes to `LangiumDocumentBuilder` post-parse events; walks `ML_COMMENT` hidden CST leaves via `streamCst(...).filter(n => n.hidden && n.tokenType?.name === 'ML_COMMENT')` (Q4 resolution).
- Regex-parses the leaf text into `{tag, body, range}` (the only structural extraction Langium can't do for us).
- Exposes a custom LSP request (e.g. `express/getAnnotations`) that the extension host calls.
- Extension-host `AnnotationIndex` becomes a thin client over the LSP request. Existing tests on the parser regex still apply (the regex moves but the contract doesn't).

#### 3.2.3 IndexManager-based xref resolution

Per §1.2.4 + Q7 resolution. The Phase 2 direct-fs-scan resolver ignores Langium's already-built symbol index.

- New LSP custom request `express/resolveEntity?{name|qualified}` returning `{uri, range}`.
- Server uses `services.shared.workspace.IndexManager.allElements()` per Q7.
- 5-line probe required first to confirm whether `AstNodeDescription.name` is `"entity"` or `"schema.entity"` (open detail from Q7 resolution).
- Fallback to current fs-scan only if IndexManager lookup misses (e.g. a referenced entity is in a file the workspace hasn't indexed).

#### 3.2.4 Worker-thread isolation for sync Plurimath

Per §1.2.8.10 future-hardening note. Currently a pathological AsciiMath input could hang the extension event loop because Plurimath JS is synchronous; the character cap is the only practical bound.

- Wrap `prerenderMath` in a `node:worker_threads` worker.
- Bidirectional protocol: host posts `{id, expr}` arrays, worker posts `{id, mathml | error}`.
- Hard 2 s timeout per expression (worker can be terminated and restarted).
- Cap the worker pool at 1 (math rendering is already batched per-document).

#### 3.2.5 UX polish

- Loading states ("Rendering description…") in description preview while host-side render is in flight. (Phase 2 currently shows "Loading…" until JS replaces it; first-render latency is noticeable on large bodies.)
- "No description for X" hint when xref target resolves but the annotation index has nothing (currently the hover just hides).
- Cross-schema hovers: hover over `cartesian_point` in a downstream schema should still resolve through the workspace's annotation index (currently scoped to active document).
- Error toast for renderer failures (currently logged to OutputChannel only).

#### 3.2.6 Wider corpus testing

Run `scripts/extract-asciimath-fixtures.py` against:
- `topology_schema.exp`
- `mesh_topology_schema.exp`
- `presentation_appearance_schema.exp`
- `equations_schema.exp` (uses both `stem:[]` AsciiMath and `latexmath:[]` LaTeX; Phase 2 only handles AsciiMath; Phase 3 should at least gracefully skip latexmath)

Expand `test-fixtures/asciimath/` with additional comparison artifacts. New unit tests if regressions surface.

#### 3.2.7 Release prep

- `CHANGELOG.md` entry summarising the viewer features.
- Version bump (`0.3.4 → 0.4.0` — minor since this is additive).
- Update `README.md` with screenshots / feature description.
- Verify `.vscodeignore` excludes test-fixtures, scripts, and DESIGN doc from the published `.vsix`.

### 3.3 Phase 3 exit criteria

The POC's eight criteria from §1.3 plus:

9. Math playground renders typeset math within 200 ms of stop-typing on the canonical sum-of-cubes example (closes Phase 2 criterion 4).
10. Annotation extraction runs in the language server, not the extension host. The host's `AnnotationIndex` class is a thin LSP client.
11. Xref resolution uses `IndexManager.allElements()` as primary path; fs-scan only as fallback for unindexed files.
12. Plurimath rendering happens in a worker thread; a 2 s timeout per expression is enforced as a hard limit (not just character-cap).
13. The four canonical schemas (geometry, topology, mesh_topology, presentation_appearance) all render without unhandled errors; `equations_schema.exp` `latexmath:[]` segments either render or are gracefully skipped with a warning.
14. `vsce package` produces a `.vsix`; `code --install-extension easyEXPRESS-0.4.0.vsix` installs cleanly; the four canonical surfaces work in the installed extension.
15. `CHANGELOG.md` documents the new viewer surfaces.

### 3.4 Phase 3 sign-off

- [x] All 7 work items §3.2 to be implemented
- [x] Exit criteria 9–15 to be met
- [x] Bundle sizes still within Phase-1 ceilings (host ≤ 1 MB after worker-thread infrastructure, vendor ≤ 5 MB)
- [x] All tests pass; lint clean; npm audit clean
- [x] Approved to proceed to Phase 3: Full Implementation

**Signed off by:** Thomas Thurman
**Date:** 2026-05-02

---

## PHASE 4: VALIDATION

### 4.1 Scope

Validate the Phase 3 implementation against real-world usage and produce external communication artifacts describing the new capabilities.

### 4.2 Work items

#### 4.2.1 Cross-platform smoke testing

- macOS (primary, already covered).
- Linux: install on Ubuntu via `code --install-extension`. Verify all four viewer surfaces work; run the test suite via `npm test`.
- Windows: same, on Windows 11. Pay attention to path-separator handling in the resolver (`path.join` should be platform-correct already; verify on real Windows path delimiters).

#### 4.2.2 Performance measurements vs Phase 0 baseline

| Measurement | Phase 0 baseline | Phase 4 target |
|-------------|------------------|----------------|
| Cold-start activation time | (measure now to establish baseline) | ≤ 1.5× baseline |
| First-hover latency (no math) | n/a | ≤ 50 ms |
| First-hover latency (with math, after MathJax warm) | n/a | ≤ 100 ms |
| First description preview render time on `point` (line 3294, geometry_schema) | n/a | ≤ 800 ms |
| First EXPRESS-G preview render time on geometry_schemaexpg4.svg | n/a | ≤ 200 ms |
| Math playground render-after-stop-typing | n/a | ≤ 200 ms (already in §3.3 #9) |

#### 4.2.3 `.vsix` packaging end-to-end

- `vsce package` produces `easyEXPRESS-0.4.0.vsix` cleanly.
- `code --install-extension easyEXPRESS-0.4.0.vsix` succeeds.
- Reload VS Code; all four surfaces work in the installed extension (not just dev host).
- `.vsix` size budget: ≤ 6 MB unpacked.

#### 4.2.4 Acceptance run against canonical schemas

For each of: `geometry_schema.exp`, `topology_schema.exp`, `mesh_topology_schema.exp`, `presentation_appearance_schema.exp`:

- Hover on every entity declared in the schema (script-driven walk through CST). No errors logged to OutputChannel.
- Trigger `showDescription` on 5 random entities per schema. Math renders. Xrefs are clickable.
- Trigger `showExpressG` on each schema. Hot-spot navigation works for entities the SVG depicts.

#### 4.2.5 Communication artifacts (powerpoint + white paper)

**PowerPoint presentation** (`docs/easyEXPRESS-viewers.pptx`):
- Audience: WG12 / SC4 stakeholders, EXPRESS schema authors.
- Length: 10–12 slides.
- Outline:
  1. Problem (raw `(* … *)` comments + raw SVG XML in current tooling)
  2. New capabilities at a glance (4 surfaces, screenshots)
  3. Annotated EXPRESS format support (`__note`/`__example`/`__expressg` etc.)
  4. EXPRESS-G hot-spot navigation demo (frame-by-frame)
  5. AsciiMath rendering pipeline (Plurimath same-as-Metanorma)
  6. Architecture (extension host vs webview, security model summary)
  7. Performance characteristics (numbers from §4.2.2)
  8. Installation + first-use walkthrough
  9. Roadmap (math playground polish, latexmath support, customEditor for SVG)
  10. Q&A / contact
- Use the `pptx-report` skill if present (see CLAUDE.md skills list).

**White paper** (`docs/easyEXPRESS-viewers.adoc` — written in AsciiDoc to dogfood the format):
- Audience: technical reviewers, integrators considering the extension for their workflow.
- Length: 8–12 pages.
- Sections:
  1. Abstract (one paragraph; capabilities and scope)
  2. Background — annotated EXPRESS, Metanorma authoring, and the gap the extension fills
  3. Architecture — webview vs host split, why Plurimath runs host-side, security model with §1.2.8 trust-boundary table reproduced
  4. Hot-spot navigation — `[.svgmap]` parsing, hotspot index → entity mapping, IndexManager xref resolution
  5. Math rendering — Plurimath for description preview, MathJax for hover; rationale for the dual-renderer split with §M3 fixture comparison cited
  6. Bundle and performance — host bundle stays ≤ 1 MB, vendor assets ≤ 5 MB, performance numbers from §4.2.2
  7. Security — concrete mitigations from §1.2.8 (CSP, DOMPurify, `:safe-mode: secure`, isTrusted array form, message validator, resource limits)
  8. Limitations and future work — latexmath, additional Metanorma constructs, customEditor for SVG, performance under very large schemas
  9. Acknowledgements (Plurimath, Asciidoctor, MathJax, DOMPurify, Langium, NIST upstream)
  10. References (DESIGN doc, ISO 10303-11 base spec, Metanorma docs, asciimath.org)
- Render to PDF via Metanorma (`metanorma -t standoc-presentation` or `asciidoctor-pdf`) for distribution.

### 4.3 Phase 4 exit criteria

The eight POC criteria + the seven Phase 3 criteria + these:

16. macOS, Linux, Windows: all four viewer surfaces verified on each platform.
17. Performance measurements (§4.2.2) recorded; all targets met.
18. `.vsix` builds, installs cleanly, and the four canonical schemas (§4.2.4) render without unhandled errors.
19. PowerPoint presentation produced and reviewed.
20. White paper produced and reviewed.

### 4.4 Phase 4 sign-off

- [ ] Cross-platform smoke (§4.2.1) complete
- [ ] Performance numbers recorded (§4.2.2) and within targets
- [ ] `.vsix` packaging end-to-end verified (§4.2.3)
- [ ] Acceptance run on canonical schemas (§4.2.4) passes
- [ ] PowerPoint deliverable complete
- [ ] White paper deliverable complete
- [ ] Project complete; ready for marketplace publish

**Signed off by:** _(pending)_
**Date:** _(pending)_
