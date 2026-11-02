# Releasing EXPRESSsuite

The extension reaches users through **two independent channels**. They can
drift apart, and have: 0.4.0 and 0.4.1 were published to the Marketplace but
never became GitHub Releases, and 0.4.2 became a GitHub Release two weeks
before it reached the Marketplace.

| Channel | Produced by | Audience |
|---|---|---|
| GitHub Release + `.vsix` asset | `release-it`, via the release workflows | anyone installing from source |
| VS Code Marketplace | `vsce publish` | everyone using the extension |

## Cutting a release

Both workflows are `workflow_dispatch` — run them from the Actions tab.

1. **`Create pre-release version`** (`release-pre.yaml`) — optional. Produces
   e.g. `0.4.2-0`, marked as a pre-release on GitHub. Never publishes to the
   Marketplace (see *Irreversibility* below).
2. **`Create release version`** (`release-public.yaml`) — the real release.

Both accept an optional **`version`** input. Leave it blank to infer the
increment from conventional commits. Supply it explicitly when **promoting a
pre-release**: there are no new `feat:`/`fix:` commits since the pre-release
tag, so the recommendation is empty and `release-it` would otherwise resolve
the version to `null`.

`release-it`'s `before:github:release` hook runs `vsce package`, so the
`.vsix` attached to the GitHub Release is built once and is the artifact
everything downstream should use.

## Marketplace publishing

`release-public.yaml` publishes automatically through **Marketplace Trusted
Publishing** (OpenID Connect). The job holds `permissions: id-token: write`,
and `vsce publish --oidc` exchanges the GitHub OIDC token for a 15-minute
Marketplace credential. No secret is stored anywhere. The Marketplace side is
a Trusted Publishing policy on the `TRThurman` publisher
(<https://marketplace.visualstudio.com/manage> → publisher → **Trusted
Publishing**) naming repository owner `TRThurman`, repository `EXPRESSsuite`,
workflow `release-public.yaml`, no environment; created 2026-11-02.

`--packagePath` points at the `.vsix` `release-it` just built, so the
Marketplace bits are byte-identical to the attached release asset rather than
a second independent build.

The step runs on every public release. A failed token exchange does not fall
back to anything, and it fails *after* `release-it` has already pushed the
release commit, the tag and the GitHub Release. Recovery is a manual upload
of the attached asset; the release itself does not need redoing:

```bash
gh release download <version> --repo TRThurman/EXPRESSsuite --pattern '*.vsix' -D ~/Downloads
```

Then at <https://marketplace.visualstudio.com/manage>, open the publisher,
and use the extension row's `...` → **Update** to upload that file. Prefer
uploading the release asset over repackaging locally — see *Local packaging*
below.

### Signing in

The `TRThurman` publisher is owned by a **personal Microsoft account**
(`thomas@trthurman.consulting`). Two things trip this up:

- The portal signs you in silently with whatever Microsoft session the
  browser already holds, so the wrong identity looks like a broken login or
  a missing publisher. Use a **private window**, or sign out of all three
  layers in order: `marketplace.visualstudio.com/_signout`,
  `app.vssps.visualstudio.com/_signout`, then `login.live.com/logout.srf`.
  The last is the one that otherwise hands the old account straight back.
- Use `marketplace.visualstudio.com/manage` (no publisher path). It
  enumerates every publisher the signed-in account can manage, instead of
  returning a bare 403 when you guess wrong.

## Personal Access Tokens (retired path)

The PAT route (a `VSCE_PAT` repository secret, `vsce publish --pat`) was
documented up to 0.4.2 but never exercised; those releases were uploaded by
hand. Azure DevOps global PATs, the "All accessible organizations" scope the
Marketplace required, are being decommissioned (VS Code docs: 2026-12-01;
Azure DevOps blog, 23 October 2026 update: 2027-01-27), and the VS Code docs
mark PAT publishing "Not Recommended". Trusted Publishing above replaces it.

If a token is ever needed again (for example `vsce verify-pat` or
`vsce ls-publishers`): it is an **Azure DevOps** credential, `dev.azure.com`,
*not* `portal.azure.com`, which rejects personal Microsoft accounts with a
tenant error. Pick an organization at <https://aex.dev.azure.com/me>, then
`https://dev.azure.com/{org}/_usersSettings/tokens`; organization "All
accessible organizations", scope Custom defined → show all scopes →
Marketplace → Manage. Verify with
`npx @vscode/vsce verify-pat TRThurman --pat "<token>"` before trusting it.

## Irreversibility

A Marketplace version number **can never be reused** — only unpublished. A
GitHub Release can be deleted and re-cut freely. This asymmetry is why:

- `release-pre.yaml` deliberately has **no** Marketplace publish step;
  pre-releases should not consume gallery version numbers.
- the publish step runs only *after* `release-it` succeeds.

## Local packaging

`vsce package` run locally will include whatever is in `out/` — including the
unbundled `tsc -b` output, which `.vscodeignore` does not exclude. CI is
immune because `out/` is gitignored and a fresh checkout has none of it. A
locally built `.vsix` can therefore carry ~45 redundant modules that may not
match the esbuild bundle. Publish the CI-built release asset.

## Checklist

- [ ] CI green on `main`
- [ ] `CHANGELOG.md`: the hand-written `## Unreleased` section is re-headed
      `## [<version>](https://github.com/TRThurman/EXPRESSsuite/compare/<previous>...<version>) (<date>)`
      and covers every `feat:`/`fix:` commit since the previous tag. `release-it`
      does not write to the file (no `infile` in `.release-it.json`); its generated
      commit list is the GitHub Release body only.
- [ ] run **Create release version**, supplying `version` if promoting a pre-release
- [ ] GitHub Release exists with the `.vsix` attached
- [ ] Marketplace shows the new version (automatic through Trusted Publishing; if the publish step failed, upload the release asset by hand)
- [ ] verify: the gallery query below returns the new version

```bash
curl -s -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
  -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=7.2-preview.1' \
  -d '{"filters":[{"criteria":[{"filterType":7,"value":"TRThurman.expresssuite"}]}],"flags":1}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["results"][0]["extensions"][0]["versions"][0]["version"])'
```
