# easyEXPRESS (Mirror)

A Visual Studio Code extension that provides language support and rich-content viewers for the [EXPRESS (ISO 10303-11)](https://www.iso.org/standard/38047.html) information modeling language used by ISO TC 184/SC 4 STEP standards.

This is an independently maintained fork of [usnistgov/easy-express](https://github.com/usnistgov/easy-express), originally developed at the National Institute of Standards and Technology (NIST).

## Features

### Language support (existing)

- Syntax highlighting and validation for `.exp` files.
- [IntelliSense](https://code.visualstudio.com/docs/editor/intellisense) with auto-completion of entities, types, and attributes.
- [Code navigation](https://code.visualstudio.com/docs/editor/editingevolved): Go to Definition, Peek Definition, Find All References, Go to Symbol.
- [Refactoring](https://code.visualstudio.com/docs/editor/refactoring): Rename Symbol with cross-file scope tracking.
- Code snippets for common EXPRESS patterns.

### Annotation viewers (new in 0.4.0)

Four surfaces that render the [annotated EXPRESS](https://github.com/metanorma/annotated-express) convention used by SC 4 schema authors — Metanorma AsciiDoc inside `(*"tag" body *)` named-remark comments:

- **Hover provider** — rich `MarkdownString` popups showing the description of the entity at the cursor, with cross-references rendered as clickable links and embedded math (`stem:[…]`) shown as inline SVG glyphs.
- **Show Description** — a webview panel beside the editor with the full description rendered via Asciidoctor.js, with embedded math typeset via Plurimath (the same converter Metanorma uses).
- **Show EXPRESS-G Diagram** — interactive SVG viewer for `<schema>expg<N>.svg` diagrams; click any labelled box to jump to the entity's source declaration.
- **AsciiMath Playground** — live-preview webview for AsciiMath input. Renders prose-with-math fragments in place; supports `stem:[…]` (AsciiMath) and `latexmath:[…]` (LaTeX). "Insert at cursor" pastes the source as `stem:[…]` into the active editor.

> Note to STEP developers: long-form and concatenated files are not currently supported.

## Install

### From a packaged `.vsix`

```
code --install-extension easyexpress-0.4.0.vsix
```

(Use `code-insiders --install-extension …` for VS Code Insiders.) Reload the window after install. The extension activates on the first `.exp` file encountered in the workspace.

### From source (development)

```
git clone https://github.com/TRThurman/easy-express-mirror.git
cd easy-express-mirror
npm ci
npm run build
```

To launch a development host with the extension loaded:

```
code --extensionDevelopmentPath="$(pwd)" --disable-extensions
```

To package a `.vsix` from source:

```
npm i -g @vscode/vsce
vsce package
```

## Quick start

Open any `.exp` file with named-remark annotations (e.g. those in [wg12-step](https://sd.iso.org/bitbucket-pilot/scm/isotc184sc4/wg12-step.git)). The four viewer surfaces are reachable as:

| Surface | Trigger |
|---|---|
| Hover description | hover the cursor on any entity name |
| Show Description | right-click → **Show Description** (or command palette) |
| Show EXPRESS-G Diagram | right-click → **Show EXPRESS-G Diagram** |
| AsciiMath Playground | command palette → **easyEXPRESS: Open AsciiMath Playground** |
| Send Selection to Playground | select text in editor → right-click → **Send Selection to AsciiMath Playground** |

Performance and diagnostic logs land in the **Output** panel under **easyEXPRESS Viewers**.

## Privacy and confidentiality

easyEXPRESS itself makes **zero outbound network calls**. Every webview is configured with CSP `connect-src 'none'`; the extension host source contains no `fetch`, no `http(s)` import, no telemetry. Math rendering happens entirely on your machine via Plurimath (in a `node:worker_threads` worker) and MathJax (lazy-loaded for hover SVGs).

> ⚠ However, modern VS Code (and especially VS Code Insiders) bundles **GitHub Copilot Chat** as a built-in feature. Its right-click context-menu entries (**Explain**, **Add File to Chat**, **Open Inline Chat**, **Review**) DO send the cursor word, enclosing scope, surrounding source lines, and snippets from other open editors to GitHub/Microsoft endpoints. `--disable-extensions` does NOT remove these.

For pre-publication standards work under non-disclosure, the recommended workflow is:

1. **Sign out of GitHub** in the affected VS Code window (account icon at bottom-left → Sign Out). Without auth, Copilot Chat cannot reach its API.
2. Or set **`"chat.disableAIFeatures": true`** in the workspace's `.vscode/settings.json`.
3. Best practice: a dedicated, signed-out window for any sensitive schema work; sign back in for non-confidential projects.

The companion white paper (see below) documents the data flows and verification steps in detail.

## Documentation

Project documentation under [`docs/`](docs/):

| Path | Audience |
|---|---|
| [`docs/easyEXPRESS-viewers.adoc`](docs/easyEXPRESS-viewers.adoc) | Technical white paper (architecture, security model, data privacy, performance) |
| [`docs/easyEXPRESS-viewers.pptx`](docs/easyEXPRESS-viewers.pptx) | Implementor-oriented PowerPoint deck (21 slides) |
| [`docs/easyEXPRESS-viewers-user-guide.pptx`](docs/easyEXPRESS-viewers-user-guide.pptx) | User-oriented PowerPoint deck (19 slides, screenshot-led) |
| [`docs/smoke-test-checklist.md`](docs/smoke-test-checklist.md) | Cross-platform manual smoke-test plan (S1–S6 + per-schema acceptance) |
| [`DESIGN-viewers-integration.md`](DESIGN-viewers-integration.md) | Full design protocol document (Phase 0 reconnaissance → Phase 4 validation) |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes |

### Rendering the white paper

The white paper is written in AsciiDoc to dogfood the format the extension renders. To preview it:

#### As HTML — in VS Code

Install the [Asciidoctor extension for VS Code](https://marketplace.visualstudio.com/items?itemName=asciidoctor.asciidoctor-vscode):

```
code --install-extension asciidoctor.asciidoctor-vscode
```

Open `docs/easyEXPRESS-viewers.adoc`, then **`Cmd+K V`** (preview to the side) or **`Cmd+Shift+V`** (preview in the same column). The preview updates as the file is edited.

#### As HTML — from the command line

```
asciidoctor docs/easyEXPRESS-viewers.adoc -o docs/easyEXPRESS-viewers.html
open docs/easyEXPRESS-viewers.html
```

#### As PDF

```
gem install asciidoctor-pdf
asciidoctor-pdf docs/easyEXPRESS-viewers.adoc -o docs/easyEXPRESS-viewers.pdf
open docs/easyEXPRESS-viewers.pdf
```

#### As Metanorma standoc (publication fidelity)

```
gem install metanorma-cli metanorma-standoc
metanorma compile docs/easyEXPRESS-viewers.adoc -t standoc -x html,pdf
```

This path uses Plurimath to render embedded math, exactly matching the rendering the extension itself produces.

## Build, lint, test

```
npm run build      # langium-generate + tsc + esbuild
npm run lint       # eslint
npm test           # vitest (73 tests)
npm run rebuild    # clean build from scratch
```

Continuous integration runs the build/lint/test matrix on macOS, Ubuntu, and Windows via [`.github/workflows/ci.yaml`](.github/workflows/ci.yaml). The workflow uploads platform-specific `.vsix` artifacts on each push.

## Origin and licensing

The original easyEXPRESS was developed at NIST by Sylvere Krima, Allison Barnard Feeney, and Rosemary Astheimer. The original NIST-developed software is not subject to copyright protection within the United States under 17 U.S.C. Section 105. See [`LICENSE.md`](LICENSE.md) for the original NIST software licensing statement.

This fork is maintained by Thomas Thurman under the [MIT License](LICENSE).

## Contributing

For bug reports and feature requests, please [open an issue](https://github.com/TRThurman/easy-express-mirror/issues).

For code contributions, the development workflow is:

1. Fork the repository and create a topic branch.
2. Make changes; ensure `npm run lint` and `npm test` pass.
3. Open a pull request against `main`.

Larger changes (new viewer surfaces, parser changes, security model adjustments) are guided by the design protocol document — see [`DESIGN-viewers-integration.md`](DESIGN-viewers-integration.md) for the phased process used for the 0.4.0 release.
