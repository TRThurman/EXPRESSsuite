# Cross-platform smoke-test checklist (DESIGN §4.2.1)

Manual verification steps for a fresh install on each target OS.
Run after `vsce package` produces `expresssuite-<version>.vsix`.

The CI workflow (`.github/workflows/ci.yaml`) covers `npm test` + `vsce package`
on macOS, Ubuntu, and Windows automatically. **This document covers the
visible-UI parts that CI cannot exercise.**

## Prerequisites

- VS Code or VS Code Insiders, latest stable.
- A clone of `https://sd.iso.org/bitbucket-pilot/scm/isotc184sc4/wg12-step.git`
  to provide `geometry_schema.exp` and friends.
- Sign **out** of GitHub Copilot Chat in this VS Code window if you handle
  pre-publication content (see DESIGN §4.2.5).

## Install

```
code --install-extension expresssuite-0.4.0.vsix
```

Reload VS Code.  Open `wg12-step/schemas/resources/geometry_schema/geometry_schema.exp`.

## Smoke tests (run on each target OS)

### S1 — Hover

- Place cursor on `point` (line 3294).
- Expected: hover popup shows
  - bold heading `geometry_schema.point`
  - rendered description with `cartesian_representation_item` as a clickable link
  - inline rendered ℝᵐ glyph (the `stem:[RR^m]` → SVG)
  - "Show full description" link at bottom
- **PASS** if all four elements are visible.  **FAIL** if popup is empty,
  if math shows as `\`stem:[RR^m]\`` code, or if the xref is raw text.

### S2 — Description preview

- Right-click `point` → **Show Description**.
- Expected: webview opens beside the editor with
  - "Rendering description…" spinner momentarily
  - rendered AsciiDoc body (paragraphs, bold, links)
  - typeset MathML for `stem:[RR^m]` and `stem:[m]`
- **PASS** if the rendered description appears within ~2 seconds.

### S3 — EXPRESS-G hot-spot navigation

- With cursor still on `point`, right-click → **Show EXPRESS-G Diagram**.
- Expected: `geometry_schemaexpg4.svg` opens directly (no picker, since
  `point` only appears in expg4).
- Click any labelled box (e.g. *cartesian_point*).  The editor should
  jump to that entity's `ENTITY` declaration.
- **PASS** if the click navigates to the correct source location.

### S4 — Math playground

- `Cmd+Shift+P` → "Open AsciiMath Playground".
- Expected: two-pane webview opens; right pane renders the seed expression
  `sum_(i=1)^n i^3=((n(n+1))/2)^2` as typeset math.
- Type `(a+b)^2 = a^2 + 2ab + b^2` in the left pane.  After ~200 ms of
  stop-typing, the right pane updates.
- Click **Insert at cursor** with the editor focused.  The text
  `stem:[(a+b)^2 = a^2 + 2ab + b^2]` is inserted.

### S5 — Cross-schema hover (Phase 3 §3.2.5c)

- Open `presentation_appearance_schema.exp` (which references
  `cartesian_point` from geometry_schema).
- Hover any `cartesian_point` reference.
- Expected: hover popup shows the description **from geometry_schema.exp**
  even though the active file is presentation_appearance_schema.

### S6 — Dev-host fallback (single-file mode)

- Open just `geometry_schema.exp` without a workspace folder.
- Run S1–S4.  Should still work; the LSP is fine, the host-side fallback
  resolver kicks in for cross-file xrefs.

## Per-schema acceptance run (DESIGN §4.2.4)

After S1–S6 pass on `geometry_schema.exp`, repeat the core surfaces on
the four other canonical schemas in the wg12-step corpus.  Each schema
exercises a slightly different mix of features.

Open each `.exp` file in turn and run the abbreviated checklist.

### geometry_schema (rich AsciiMath, many entities, 16 expg diagrams)

Already covered by S1–S6 above.  Includes the canonical fixture (`point`
on line 3294 → expg4).

### topology_schema

| File | `~/test_git/sd.iso.org/wg12-step/schemas/resources/topology_schema/topology_schema.exp` |
|---|---|
| Hover (with math) | `shell` (line 78) — has stem expressions in the description |
| Show Description | `shell`, `connected_edge_set`, `loop`, `face`, `closed_shell` |
| Show EXPRESS-G | should narrow to the diagrams referencing the cursor entity; falls back to picker among 7 SVGs otherwise |
| Expected math | yes — measure first-render latency |

### mesh_topology_schema

| File | `~/test_git/sd.iso.org/wg12-step/schemas/resources/mesh_topology_schema/mesh_topology_schema.exp` |
|---|---|
| Hover (with math) | `product_of_mesh` (line 212), `cell_shape` |
| Show Description | `product_of_mesh`, `cell_shape`, `array_based_unstructured_mesh`, `connected_edge_set`, `cell` |
| Show EXPRESS-G | only one SVG (`mesh_topology_schemaexpg1.svg`); picker should auto-select |
| Expected math | yes |

### presentation_appearance_schema

| File | `~/test_git/sd.iso.org/wg12-step/schemas/resources/presentation_appearance_schema/presentation_appearance_schema.exp` |
|---|---|
| Hover (with math) | `one_direction_repeat_factor` (line 646), `two_direction_repeat_factor` |
| Show Description | `one_direction_repeat_factor`, `two_direction_repeat_factor`, `fill_area_style`, `fill_area_style_hatching`, `pre_defined_tile_style` |
| Show EXPRESS-G | 11 candidate SVGs; cursor-narrowing should reduce the picker |
| Expected math | yes (rare — only 13 stem instances total) |

### equations_schema (the latexmath case — Phase 3 §3.2.6)

| File | `~/test_git/sd.iso.org/wg12-step/schemas/resources/equations_schema/equations_schema.exp` |
|---|---|
| Hover (with math, AsciiMath) | `force_moment_data_name` (line 52), `thermal_conductivity_model_data_name` |
| Hover (with **latexmath**) | any entity whose description references `latexmath:[\\vec{f}]` etc.  Search for `latexmath:[` to find a fixture |
| Show Description | `fd_diffusion_equation`, `fd_governing_equation`, `linear_acoustics_equation`, plus 2 random others |
| Show EXPRESS-G | 6 candidate SVGs |
| Expected math | **both AsciiMath and LaTeX must render**.  If a `latexmath:[…]` falls back to code form (` `latexmath:[\vec{f}]` `), record it as a §3.2.6 regression. |

### Schema-walk regression (one-time per smoke run)

For each schema above, scroll through the file once with Page Down.  No
errors should appear in the OutputChannel `EXPRESSsuite Viewers` or in
the dev-tools console.  Any "⚠ over budget" `[perf]` line is a finding
to record (not necessarily a failure).

## Platform-specific things to look for

### Windows

- Path separators in the resolver should be normalised by `path.join`.
  Confirm hot-spot navigation lands on the right line (no off-by-one
  due to `\r\n` vs `\n` in the source — line numbers are computed from
  `before.split("\n").length - 1`, which counts `\r\n` as one newline).
- File-watcher glob `**/*.exp` should match without manual normalisation.

### Linux

- `vsce` packaging should not include any macOS-specific resource forks.
- File-system case-sensitivity: ensure the `.vscodeignore` `LICENSE`
  exclusion prevents the `License.txt` / `LICENSE.txt` collision warning.

### macOS (primary)

- Already exercised in dev-host workflow.  Re-run as regression check
  after each Phase 3 commit.

## Performance targets (DESIGN §4.2.2)

The extension instruments key paths with `perf.time()`.  Numbers land in
the **EXPRESSsuite Viewers** OutputChannel as `[perf] <label>: <Nms>`.
During the smoke test, capture the values and compare to these targets:

| Label | Target | Triggers warning if over |
|-------|--------|--------------------------|
| `activate` | ≤ 500 ms typical | 1500 ms |
| `hover.<word>` | ≤ 100 ms warm, ≤ 250 ms first-with-math | 200 ms |
| `command.showDescription` | ≤ 600 ms first call, ≤ 200 ms warm | 1000 ms |
| `command.showExpressG` | ≤ 400 ms | 800 ms |
| `command.openMathPlayground` | ≤ 200 ms | 500 ms |
| math-playground render-after-stop-typing | ≤ 200 ms (visible in webview status line) | (manual) |

If a `[perf]` line includes "⚠ over budget", record which one and the
value in the smoke-test results so we can investigate.

## Recording results

In `docs/smoke-test-results.md`, append a section per OS run:

```markdown
## <OS> <date> (tester: <name>)

### Core surfaces (geometry_schema)
- S1 hover: PASS|FAIL — [notes]
- S2 description preview: PASS|FAIL — [notes]
- S3 hot-spot navigation: PASS|FAIL — [notes]
- S4 math playground: PASS|FAIL — [notes]
- S5 cross-schema hover: PASS|FAIL — [notes]
- S6 single-file mode: PASS|FAIL — [notes]

### Per-schema acceptance
- topology_schema: PASS|FAIL — [notes]
- mesh_topology_schema: PASS|FAIL — [notes]
- presentation_appearance_schema: PASS|FAIL — [notes]
- equations_schema (AsciiMath): PASS|FAIL — [notes]
- equations_schema (latexmath): PASS|FAIL — [notes]

### Performance numbers (from OutputChannel)
- activate: <ms>
- first hover (no math): <ms>
- first hover (with math): <ms>
- first showDescription: <ms>
- first showExpressG: <ms>
- math playground render: <ms>
- any "⚠ over budget" entries: [list]

### Other observations
- <any unexpected errors in OutputChannel or DevTools console>
- <any UX issues or surprises>
```

When all six pass on all three OSes, Phase 4 §4.2.1 is closed.
