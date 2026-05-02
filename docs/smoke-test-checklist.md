# Cross-platform smoke-test checklist (DESIGN §4.2.1)

Manual verification steps for a fresh install on each target OS.
Run after `vsce package` produces `easyexpress-<version>.vsix`.

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
code --install-extension easyexpress-0.4.0.vsix
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

## Recording results

In `docs/smoke-test-results.md`, append a section per OS run:

```markdown
## <OS> <date>
- S1 hover: PASS|FAIL — [notes]
- S2 description preview: PASS|FAIL — [notes]
- S3 hot-spot navigation: PASS|FAIL — [notes]
- S4 math playground: PASS|FAIL — [notes]
- S5 cross-schema hover: PASS|FAIL — [notes]
- S6 single-file mode: PASS|FAIL — [notes]
```

When all six pass on all three OSes, Phase 4 §4.2.1 is closed.
