# Changelog

## [Unreleased] (2026-09-15)

### Product identity

- Rename the independently maintained derivative to **EXPRESSsuite**, with
  Visual Studio Marketplace identity `TRThurman.expresssuite` and repository
  location `TRThurman/EXPRESSsuite`. Preserve NIST easyEXPRESS attribution and
  the stable `express` language identifier.
- Add a distinct EXPRESSsuite application icon and coordinated Marketplace
  gallery banner, visually separate from NIST branding.
- Move commands and settings to the independent `expresssuite.*` namespace so
  EXPRESSsuite can run alongside NIST easyEXPRESS without global ID collisions.

### Security

- Upgrade vulnerable development and release tooling, including ESLint,
  Vitest, Vite, release-it, jsdom, and their transitive dependencies.
- Upgrade Asciidoctor.js to 4.0 and migrate the description viewer to its
  asynchronous API, removing the vulnerable legacy glob dependency while
  preserving the secure render-and-sanitize pipeline.
- Make the complete dependency audit a required CI step instead of allowing
  production-only audit failures to pass.

### Validation

- Hold diagnostics and navigation requests until the initial workspace build
  is complete, and report loading completion only when references are ready.
- Read the renamed `expresssuite.*` optimization settings through Langium's
  configuration service instead of silently falling back to an empty section.
- Allow quick-fix requests once references are indexed, avoiding a startup
  failure for workspace documents that are not eagerly validated.
- Enforce SC4 declaration-name casing: initial-uppercase entity names in ARM
  schemas, lowercase entity names outside ARM schemas, and lowercase type
  names everywhere. Casing diagnostics provide a rename quick fix.
- Detect explicit `LOCAL` declarations that duplicate the index implicitly
  declared by a `REPEAT` increment control. Identifier matching is
  case-insensitive.
- Add **EXPRESSsuite: Detect Duplicate Declarations in Schema Closure** to the
  Command Palette and EXPRESS editor context menu. The cancellable check walks
  transitive `USE FROM` and `REFERENCE FROM` relationships and publishes
  cross-linked Problems diagnostics for conflicting schema-level declarations.
- Validate informal proposition (`IPn`) signatures and annotation keys.
  Diagnostics cover missing, malformed, misplaced, non-final, and unmatched
  signatures as well as malformed `.IPn` / `.ipn` annotation keys.

### Tests

- Add coverage for ARM/non-ARM naming, duplicate loop indices, direct and
  transitive schema closures, cyclic interfaces, renamed resources, all
  surveyed IP signature forms, and comment-scanning false positives.
- 98 automated tests now pass.

## [0.4.0] (2026-05-02)

### Features

- **Description preview**: AsciiDoc renderer for `(*"tag" body *)` named-remark
  comments in EXPRESS schemas. Renders Metanorma constructs (cross-refs,
  emphasis, listings, tables) and embedded math via Plurimath → MathML →
  Chromium-native rendering.
- **EXPRESS-G SVG preview**: interactive viewer for `<schema>expg<N>.svg`
  diagrams with hot-spot navigation. Click a labeled box to jump to the
  entity's source declaration. The diagram picker narrows to SVGs that
  reference the cursor entity.
- **AsciiMath playground**: live-render webview that converts AsciiMath
  input to MathML (debounced ~200 ms after last keystroke). "Insert at
  cursor" pastes the source as `stem:[…]` into the active EXPRESS file.
- **Hover provider**: rich `MarkdownString` hovers showing the named-remark
  description of the entity at the cursor, with `<<express:…>>` xrefs
  rendered as clickable command-links and `stem:[…]` rendered as inline
  SVG (via MathJax v4). Cross-schema lookup falls back to a workspace-wide
  annotation index.
- Three new commands and two context-menu entries:
  - `EXPRESSsuite: Show Description`
  - `EXPRESSsuite: Show EXPRESS-G Diagram`
  - `EXPRESSsuite: Open AsciiMath Playground`

### Architecture

- New language-server-side `ExpressP11AnnotationIndex` service walks the CST
  for hidden `ML_COMMENT` tokens on each parse and maintains a per-document
  annotation map. Exposed via custom LSP requests `express/getAnnotations`
  and `express/findAnnotationsForEntity`.
- New custom LSP request `express/resolveEntity` uses Langium's
  `IndexManager.allElements()` for entity-name → source-location lookup
  (used for EXPRESS-G hot-spot navigation). Falls back to a filesystem
  scan for files the language server has not yet indexed.
- Plurimath rendering runs in an isolated `node:worker_threads` worker with
  a 2-second per-render timeout. Hung renders terminate the worker; the
  next call respawns it.
- Webview vendor assets ship as native ESM under `out/webview/vendor/`;
  controllers load them via dynamic `import()`. Math rendering happens
  host-side because the Opal-runtime backed Plurimath cannot be bundled by
  esbuild and cannot run inside a webview's CSP `unsafe-eval` context —
  the resulting MathML is sent to the webview through the JSON payload.

### Security model

Per-surface webview isolation with strict CSP, `unsafe-eval` confined to
surfaces that need it. SVG sanitized via DOMPurify with explicit tag/attr
allow-list and a URI-scheme filter that permits the EXPRESS-G
integer-href hot-spot convention while stripping `javascript:`,
`data:text/html`, etc. Asciidoctor runs with `:safe-mode: secure`; output
is also DOMPurified because secure mode does not strip `pass:[]` /
`+++…+++` passthroughs. `MarkdownString.isTrusted` uses the array form to
whitelist only `vscode.open` and `expresssuite.*` commands. Webview→host
messages are schema-validated; resource limits cap per-expression and
per-document math work to prevent DoS via pathological input.

### Tests

- 73 tests (was 42) covering remark parsing, message validation, and
  defense-in-depth security mitigations (SVG sanitization, Asciidoctor
  passthrough stripping, MathML preservation, command-URI whitelisting).
- Renderer comparison fixtures for geometry_schema, topology_schema,
  mesh_topology_schema, presentation_appearance_schema, and
  equations_schema in `test-fixtures/asciimath/`.

### Dependencies

- Added (runtime, exact-pinned): `@asciidoctor/core@3.0.4`,
  `@plurimath/plurimath@0.2.2`, `dompurify@3.4.2`, `mathjax@4.1.1`.
- `@plurimath/plurimath` and `mathjax` are esbuild externals; they ship
  in `node_modules` of the published `.vsix` (whitelisted in
  `.vscodeignore`).

## [0.3.4](https://github.com/usnistgov/easy-express/compare/0.3.3...0.3.4) (2024-01-24)


### Bug Fixes

* update error messages ([5cbf1a5](https://github.com/usnistgov/easy-express/commit/5cbf1a5196283f6f5ab294f7f7dbfc85dfde3800))
* update scope of entities in subtype/supertype constraints ([9d30f17](https://github.com/usnistgov/easy-express/commit/9d30f17fc46034dac41eefe1b802a39202cefec5))
* update SELF resolution for qualifiers ([5a275bf](https://github.com/usnistgov/easy-express/commit/5a275bf368f767bb0bbf70c8018bc47bac4d073a))
* update USEDIN resolution and return type ([631374f](https://github.com/usnistgov/easy-express/commit/631374fa12c1e71ba00f451f3bc857d06d8a5efb))

## [0.3.3](https://github.com/usnistgov/easy-express/compare/0.3.2...0.3.3) (2024-01-23)


### Bug Fixes

* add contextual scope resolution for type extension ([59e2f8b](https://github.com/usnistgov/easy-express/commit/59e2f8bf4315743edf8fbaa8654934a6a6fad61c))
* add processing of incomplete type extension ([e34f2de](https://github.com/usnistgov/easy-express/commit/e34f2de19c1df08b0ea8e16ccc191ed4ba1f706f))
* update memoization of interface resolution ([cb752f8](https://github.com/usnistgov/easy-express/commit/cb752f8b90f44017e37f146ff711a6f39a881230))

## [0.3.2](https://github.com/usnistgov/easy-express/compare/0.3.1...0.3.2) (2024-01-16)


### Bug Fixes

* retrieve attributes without name from an optimized list ([6648f7e](https://github.com/usnistgov/easy-express/commit/6648f7e087c74e40ce06a0a46fdf5d757076180d))
* update extension packaging options ([82a3354](https://github.com/usnistgov/easy-express/commit/82a3354432c539900e03f4227dd75bee567361cc))

## [0.3.1](https://github.com/usnistgov/easy-express/compare/0.3.1-0...0.3.1) (2024-01-11)

## [0.3.1-0](https://github.com/usnistgov/easy-express/compare/0.3.0...0.3.1-0) (2024-01-09)


### Bug Fixes

* Change attribute snippet description ([bd8e7f3](https://github.com/usnistgov/easy-express/commit/bd8e7f370a80ff516847f170df561402268c344c))
* update type system computation ([#20](https://github.com/usnistgov/easy-express/issues/20)) ([eababce](https://github.com/usnistgov/easy-express/commit/eababce945fa5e38ac5eee169eeeb6d2d4c831e5))

## [0.3.0](https://github.com/usnistgov/easy-express/compare/0.3.0-4...0.3.0) (2023-12-04)

## [0.3.0-4](https://github.com/usnistgov/easy-express/compare/0.3.0-3...0.3.0-4) (2023-12-04)

## [0.3.0-3](https://github.com/usnistgov/easy-express/compare/0.3.0-2...0.3.0-3) (2023-12-04)


### Features

* add partial resolution of query variables ([55bd1c5](https://github.com/usnistgov/easy-express/commit/55bd1c594ea179c89836c4548e919fddc465b58e))
* add qualifiers on function call ([318ca45](https://github.com/usnistgov/easy-express/commit/318ca45a19163ec950dabdc085916bf9c425bceb))
* add release workflow ([42183fd](https://github.com/usnistgov/easy-express/commit/42183fd43fb630331df3bb4339c7a046fc99a47c))


### Bug Fixes

* add constants to document exports ([0b530a9](https://github.com/usnistgov/easy-express/commit/0b530a99fdba9473f76442d85c28af179657c92f))
* add proper highlighting of subtype_constraint ([40c5aa9](https://github.com/usnistgov/easy-express/commit/40c5aa90f8e0b2dfe61b8865dd4e84d0468003fe))
* change multiplicity in Total_over entities ([3040c7b](https://github.com/usnistgov/easy-express/commit/3040c7b50d51fd2f5539303e1b744b0017525db2))
* misc syntax highlighting ([c9aed1f](https://github.com/usnistgov/easy-express/commit/c9aed1f667a9734123a781c7765baabaab7f74b1))
* remove unwated fullgraph return ([c2f9ada](https://github.com/usnistgov/easy-express/commit/c2f9ada97eabcb6d92b64e891af97008d1a9c7b5))
* update string syntax highlight match ([89a71fb](https://github.com/usnistgov/easy-express/commit/89a71fbb6ee4982674c992ae4c0ffa736ca9baf2))

## [0.3.0-2](https://github.com/usnistgov/easy-express/compare/0.3.0-1...0.3.0-2) (2023-11-13)


### Bug Fixes

* assets folder to vscodeignore ([1f86283](https://github.com/usnistgov/easy-express/commit/1f86283041263694bb0ccfedae7be91b2a9197eb))

## [0.3.0-1](https://github.com/usnistgov/easy-express/compare/0.3.0-0...0.3.0-1) (2023-11-13)


### Bug Fixes

* add step to pre-release workflow ([07b2eaf](https://github.com/usnistgov/easy-express/commit/07b2eaf28e70e1385bc70f3afee8d53d8f55a79f))
* missing assignment in Local_variable ([ee9519f](https://github.com/usnistgov/easy-express/commit/ee9519feb1622f549bf248ba6ab882f45dcbde83))

## 0.3.0-0 (2023-11-13)


### Features

* add prerelease version workflow ([868293a](https://github.com/usnistgov/easy-express/commit/868293a39581988ec5e51afb0b88a9bf22501314))
* migrate core to v2 ([5a74866](https://github.com/usnistgov/easy-express/commit/5a7486629817856807991dc5762acd12cabb119b))
