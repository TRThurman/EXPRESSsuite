# Dependency Upgrade Protocol: easy-express

**Date:** 2026-04-20
**Scope:** Evaluate upstream (usnistgov/easy-express) dependabot issues, classify breaking changes, and define migration plan for this fork (TRThurman/easy-express-mirror).

---

## 1. Upstream Dependabot PR Inventory

### 1.1 MERGED Upstream (not yet incorporated into this fork)

| PR  | Dependency                                          | From       | To      | Breaking? |
|-----|-----------------------------------------------------|------------|---------|-----------|
| #33 | eslint + @typescript-eslint/eslint-plugin + parser  | 8.33/5.62  | 9.39/8.54 | **YES** |
| #32 | release-it + @release-it/conventional-changelog     | 17.1/8.0   | 19.2/10.0 | Minor   |
| #34 | ajv                                                 | 6.12.6     | 6.14.0  | No        |
| #41 | picomatch                                           | (transitive) | patch | No        |

### 1.2 OPEN Upstream (pending)

| PR  | Dependency                          | From    | To     | Breaking? |
|-----|-------------------------------------|---------|--------|-----------|
| #45 | **langium + langium-cli**           | 2.1.3/2.1.0 | **4.2.2/4.2.0** | **YES - MAJOR** |
| #49 | basic-ftp                           | 5.1.0   | 5.3.0  | No (transitive) |
| #47 | brace-expansion                     | (transitive) | patch | No |
| #46 | minimatch                           | (transitive) | patch | No |
| #44 | vite                                | 7.1.9   | 7.3.2  | N/A (not in our fork) |
| #43 | defu                                | 6.1.4   | 6.1.6  | No (transitive) |
| #42 | handlebars                          | 4.7.8   | 4.7.9  | No |
| #40 | flatted                             | 3.3.3   | 3.4.2  | No (transitive) |
| #37 | rollup                              | 4.52.4  | 4.59.0 | No (transitive) |

### 1.3 Version Comparison: Our Fork vs Upstream HEAD

| Dependency                           | Our Fork   | Upstream HEAD | Notes                    |
|--------------------------------------|------------|---------------|--------------------------|
| langium                              | ^2.1.3     | ^2.1.3        | Same spec; PR #45 pending |
| langium-cli                          | ^2.1.0     | ^2.1.0        | Same spec; PR #45 pending |
| eslint                               | ~8.33.0    | ~9.39.2       | Upstream merged PR #33   |
| @typescript-eslint/eslint-plugin     | ~5.62.0    | ~8.54.0       | Upstream merged PR #33   |
| @typescript-eslint/parser            | ~5.62.0    | ~8.54.0       | Upstream merged PR #33   |
| release-it                           | ^17.1.1    | ^19.2.4       | Upstream merged PR #32   |
| @release-it/conventional-changelog   | ^8.0.1     | ^10.0.4       | Upstream merged PR #32   |
| typescript                           | ~5.9.3     | ~5.0.4        | **We are ahead**         |
| chalk                                | ~5.6.2     | ~5.3.0        | **We are ahead**         |
| @types/vscode                        | ~1.107.0   | ~1.67.0       | **We are ahead**         |

---

## 2. Breaking Change Analysis

### 2.1 TIER 1: Langium 2.1.3 -> 4.2.2 (Source Refactoring Required)

This is the highest-impact upgrade. Langium is the core framework powering the entire language server. The upgrade spans **two major versions** (3.0 and 4.0) with cumulative breaking changes.

#### 2.1.1 Langium 3.0.0 Breaking Changes (Feb 2024)

**Import Path Reorganization** -- affects every source file:
- LSP types/services moved: `langium` -> `langium/lsp`
  - `LangiumServices`, `LangiumSharedServices`, `startLanguageServer`
  - `DefaultCompletionProvider`, `DefaultDocumentSymbolProvider`
  - `DefaultNameProvider`, `DefaultLanguageServer`
  - `CodeActionProvider`, `NodeKindProvider`
  - `CompletionAcceptor`, `CompletionContext`, `CompletionValueItem`, `NextFeature`
  - `AbstractExecuteCommandHandler`, `ExecuteCommandAcceptor`
- Code generation exports moved: `langium` -> `langium/generate`
  - `CompositeGeneratorNode`, `NL`, `toString`
- Utility functions moved into namespaces:
  - `getContainerOfType` -> `AstUtils.getContainerOfType`
  - `streamContents` -> `AstUtils.streamContents`
  - `streamAst` -> `AstUtils.streamAst`
  - `streamAllContents` -> `AstUtils.streamAllContents`
  - `streamReferences` -> `AstUtils.streamReferences`
  - `isNamed` -> `AstUtils.isNamed`
  - `getDocument` -> `AstUtils.getDocument`
  - `findNodeForProperty` -> `CstUtils.findNodeForProperty`

**Async API Change:**
- `LangiumDocuments#getOrCreateDocument` now returns `Promise<LangiumDocument>` (was synchronous)
  - **Affected:** `express-p11-document-builder.ts:65` -- must be `await`ed

**Completion API:**
- `DefaultCompletionProvider#filterCrossReference` replaced with `getReferenceCandidates`

#### 2.1.2 Langium 3.1.0 Breaking Changes (Jun 2024)

- `ConfigurationProvider` must implement `onConfigurationSectionUpdate`
- `ServiceRegistry` must implement `hasServices` method
  - **Affected:** `express-p11-service-registry.ts`

#### 2.1.3 Langium 3.2.0 Breaking Changes (Sep 2024)

- `BuildOptions#validationChecks` replaced with `validation?: boolean | ValidationOptions`
  - **Affected:** `express-p11-document-builder.ts` (uses `BuildOptions`)
- `IndexManager#getAffectedDocuments` changed to `isAffected` (returns boolean)
  - **Affected:** `express-p11-index-manager.ts`
- CST node property deprecations (removed in 4.0):
  - `CstNode#parent` -> `container`
  - `CstNode#feature` -> `grammarSource`
  - `CstNode#element` -> `astNode`
  - `CompositeCstNode#children` -> `content`
- Service containers now readonly

#### 2.1.4 Langium 4.0.0 Breaking Changes (Jul 2025)

- **Requires TypeScript >= 5.8** (we have 5.9.3 -- OK)
- `PrecomputedScopes` renamed to `LocalSymbols`
  - **Affected:** `express-p11-scope-computation.ts:7` (import), `express-p11-document-builder.ts:135`
- `References#findDeclaration` renamed to `findDeclarations` (returns array)
- `DefaultCompletionProvider#createReferenceCompletionItem` requires additional arguments
  - **Affected:** `express-p11-completion-provider.ts:25-86` -- override signature must change
- Deprecated CST properties from 3.2 now removed
- `DefaultServiceRegistry` singleton removed

#### 2.1.5 Files Requiring Changes (21 files)

| # | File | Changes Required |
|---|------|-----------------|
| 1 | `src/language/express-module.ts` | Import paths (langium/lsp for service types) |
| 2 | `src/language/main.ts` | `startLanguageServer` from `langium/lsp` |
| 3 | `src/language/express-p11-scope-computation.ts` | AstUtils namespace, PrecomputedScopes->LocalSymbols |
| 4 | `src/language/express-p11-scope-provider.ts` | AstUtils namespace imports |
| 5 | `src/language/express-p11-linker.ts` | AstUtils namespace imports |
| 6 | `src/language/express-p11-document-builder.ts` | BuildOptions change, getOrCreateDocument async, AstUtils, PrecomputedScopes->LocalSymbols |
| 7 | `src/language/express-p11-completion-provider.ts` | createReferenceCompletionItem new signature, imports to langium/lsp |
| 8 | `src/language/express-p11-name-provider.ts` | CstUtils.findNodeForProperty |
| 9 | `src/language/express-p11-document-symbol-provider.ts` | Imports to langium/lsp |
| 10 | `src/language/express-p11-code-action-provider.ts` | Imports to langium/lsp |
| 11 | `src/language/express-p11-validator.ts` | AstUtils namespace |
| 12 | `src/language/express-p11-type-container.ts` | AstUtils namespace |
| 13 | `src/language/express-p11-workspace-manager.ts` | Imports, possible API changes |
| 14 | `src/language/express-p11-execute-command-handler.ts` | Imports to langium/lsp |
| 15 | `src/language/express-p11-index-manager.ts` | isAffected API change |
| 16 | `src/language/express-p11-service-registry.ts` | hasServices method required |
| 17 | `src/language/express-p11-node-kind-provider.ts` | Imports to langium/lsp |
| 18 | `src/language/express-p11-document-validator.ts` | Possible validation API changes |
| 19 | `src/cli/main.ts` | AstUtils namespace |
| 20 | `src/cli/cli-util.ts` | getOrCreateDocument now async |
| 21 | `src/test/*.test.ts` | Test utility API changes |

**Additionally:** All generated files (`src/language/generated/`) must be regenerated via `langium-cli` 4.x. The generated `ast.ts`, `module.ts`, and `grammar.ts` will have different structure (type names, reflection API).

### 2.2 TIER 2: ESLint 8 -> 9 (Configuration Rewrite)

ESLint 9 replaced `.eslintrc.*` configuration with "flat config" (`eslint.config.js`). The `@typescript-eslint` packages also had major API changes from v5 to v8.

**What changes:**
- Delete `.eslintrc.json`
- Create `eslint.config.js` (or `.mjs`) using flat config format
- Replace `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` with `typescript-eslint` unified package (recommended) or update individual packages
- Update `package.json` lint script: `eslint src --ext ts` -> `eslint src` (flat config handles extensions)

**What does NOT change:** No source code changes. But new lint rules may flag existing code.

**Risk:** Low-medium. Configuration-only, well-documented migration path.

### 2.3 TIER 3: release-it 17 -> 19 (Minimal Changes)

- **v18:** Dropped Node 16 support (bump `engines.node` in package.json)
- **v19:** "No breaking changes" per changelog
- `.release-it.json` config format is unchanged
- `@release-it/conventional-changelog` 8->10: Plugin API compatible

**Risk:** Low. Mainly a version bump.

### 2.4 TIER 4: Non-Breaking Updates (Safe to Merge)

These are transitive dependency patches or minor version bumps that don't affect the API surface:
- basic-ftp, brace-expansion, minimatch, defu, handlebars, flatted, rollup
- Can be picked up via `npm audit fix` or `npm update`

---

## 3. Recommended Migration Sequence

The upgrades should be executed in a specific order to minimize risk and allow incremental testing.

### Phase 1: Safe Foundation (No Code Changes)

**Branch:** `feature/dep-upgrade-phase1`

1. **Bump non-breaking transitive dependencies**
   - `npm audit fix`
   - `npm update` for patch/minor ranges
   - Run tests to confirm nothing breaks

2. **Upgrade release-it 17->19 + @release-it/conventional-changelog 8->10**
   - Update `package.json` version specs
   - Bump `engines.node` from `>=16.0.0` to `>=18.0.0`
   - Verify `npm run release-pre --dry-run` still works

### Phase 2: ESLint 9 Migration (Config Only)

**Branch:** `feature/eslint9-migration`

1. Install new packages:
   ```
   npm install -D eslint@~9 typescript-eslint@~8
   npm uninstall @typescript-eslint/eslint-plugin @typescript-eslint/parser
   ```

2. Replace `.eslintrc.json` with `eslint.config.mjs`:
   ```js
   import tseslint from 'typescript-eslint';

   export default tseslint.config(
     { files: ['src/**/*.ts'] },
     ...tseslint.configs.recommended,
     { ignores: ['src/language/generated/**', 'out/**', 'dist/**'] }
   );
   ```

3. Update lint script in `package.json`:
   ```
   "lint": "eslint src"
   ```
   (Remove `--ext ts` which is not supported in flat config)

4. Fix any new lint errors revealed by updated rules.

5. Run full build + tests.

### Phase 3: Langium 2 -> 4 Migration (Major Refactoring)

**Branch:** `feature/langium4-migration`

This is the largest and riskiest phase. Recommended sub-steps:

#### Step 3a: Upgrade langium-cli and regenerate

```
npm install -D langium-cli@^4.2.0
npx langium generate
```

Review changes to generated `ast.ts`, `module.ts`, `grammar.ts`. The generated types may have structural differences that cascade into all consuming code.

#### Step 3b: Upgrade langium runtime

```
npm install langium@^4.2.2
```

This will immediately cause compile errors across 21+ files.

#### Step 3c: Fix import paths (mechanical -- bulk find/replace)

Apply import reorganization systematically:

| Old Import | New Import |
|-----------|------------|
| `from "langium"` (LSP types) | `from "langium/lsp"` |
| `from "langium"` (generate types) | `from "langium/generate"` |
| `getContainerOfType` | `AstUtils.getContainerOfType` (import `AstUtils` from `"langium"`) |
| `streamContents` | `AstUtils.streamContents` |
| `streamAst` | `AstUtils.streamAst` |
| `streamAllContents` | `AstUtils.streamAllContents` |
| `streamReferences` | `AstUtils.streamReferences` |
| `isNamed` | `AstUtils.isNamed` |
| `getDocument` | `AstUtils.getDocument` |
| `findNodeForProperty` | `CstUtils.findNodeForProperty` (import `CstUtils` from `"langium"`) |

#### Step 3d: Fix API changes (requires understanding)

1. **PrecomputedScopes -> LocalSymbols**
   - Rename all references in scope computation and document builder

2. **getOrCreateDocument now async**
   - Add `await` in `express-p11-document-builder.ts:65`
   - Add `await` in `cli-util.ts` where used

3. **createReferenceCompletionItem signature change**
   - Check Langium 4.x source for new parameter list
   - Update override in `express-p11-completion-provider.ts`

4. **ServiceRegistry.hasServices**
   - Add method to `ExpressP11ServiceRegistry`

5. **BuildOptions.validationChecks -> validation**
   - Update document builder usage

6. **IndexManager.isAffected**
   - Update index manager override

#### Step 3e: Fix CST node property renames

Search and replace:
- `.parent` on CstNode -> `.container`
- `.feature` on CstNode -> `.grammarSource`
- `.element` on CstNode -> `.astNode`
- `.children` on CompositeCstNode -> `.content`

#### Step 3f: Test and validate

- `npx langium generate` (clean generation)
- `npm run build` (TypeScript compilation)
- `npm test` (all tests pass)
- Manual smoke test in VS Code with sample .exp files

---

## 4. Risk Assessment

| Phase | Risk | Impact | Mitigation |
|-------|------|--------|------------|
| Phase 1 (non-breaking) | Very Low | None | Tests catch regressions |
| Phase 2 (ESLint 9) | Low | Build tooling only | Flat config well-documented; no runtime effect |
| Phase 3 (Langium 4) | **High** | Core language server | Incremental sub-steps; type checker catches most errors; regression tests cover functionality |

**Langium 4 specific risks:**
- Generated AST types may have subtle structural changes that break runtime behavior even after compilation succeeds
- Document building pipeline timing/ordering may differ
- Scope resolution behavior may change in ways that affect EXPRESS reference resolution
- Performance characteristics may differ (Langium 4 has profiler service -- useful for validation)

---

## 5. Relationship to Upstream

The upstream (usnistgov/easy-express) has **not** merged the Langium upgrade (PR #45 is still open). They **have** merged the ESLint 9 upgrade (PR #33) and release-it upgrade (PR #32).

**Strategy options:**

1. **Wait for upstream** to merge PR #45, then cherry-pick their changes
   - Pro: Less work for us, benefit from their testing
   - Con: PR has been open since 2026-04-08 with no activity; upstream may be stalled

2. **Do it ourselves** following this protocol
   - Pro: We control the timeline; we can test against our EXPRESS schemas
   - Con: More work; risk of divergence if upstream takes a different approach

3. **Hybrid**: Do Phase 1+2 now (catching up with upstream's merged PRs), defer Phase 3 until upstream moves on Langium or we have capacity
   - Pro: Pragmatic; gets security fixes and tooling updates now
   - Con: Langium stays at 2.x, missing 2 years of improvements

**Recommendation:** Option 3 (Hybrid). Phases 1-2 are low-risk and align us with upstream's merged changes. Phase 3 should be planned as a dedicated effort (estimate: 1-2 focused sessions) and can be triggered either by upstream merging PR #45 or by our own timeline.

---

## 6. Decision Log

| Decision | Rationale | Date |
|----------|-----------|------|
| *Pending* | *This protocol awaits review and approval before execution* | 2026-04-20 |
