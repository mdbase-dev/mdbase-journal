# Weekly app train

## Status and boundaries

This adds the Reader PR 113 repin contract, adapted only for npm's v3
`package-lock.json`, ordinary required CI, and a guarded native publisher handoff.
It does **not yet establish unattended production readiness**:

- The production SDK's first supported npm version is `0.1.0-beta.149`.
  Until the exact version and its valid provenance exist, repinning fails before
  changing any manifest or opening a PR. No `latest`, older version or local
  archive substitutes for it.
- API inspection on November 1, 2026 found neither repository nor organization
  `RELEASE_AUTOMATION_CLIENT_ID` variables or
  `RELEASE_AUTOMATION_APP_PRIVATE_KEY` secrets. The release App must have the
  existing contract's repo Contents/Pull requests permissions, read access to
  private Ops, and Actions dispatch access for the Ops train. This PR does not
  install an App or create credentials and never falls back to `GITHUB_TOKEN`.
- Journal's existing native intake explicitly requires a `file:vendor/*.tgz`
  SDK, its complete owner-delivered production packet, bundled protocol byte
  equality and independent environment hashes. A provenance-verified npm pin
  alone does not satisfy that contract: CI and the publisher intentionally
  reject it. Qualification/adaptation to the **actual** published SDK's original
  and packet format is still required before a repin can merge. The old beta.141
  packet and protected hash values cannot qualify beta.149; they are not
  regenerated or updated here. npm provenance is not a substitute for them.

The runtime's forthcoming npm artifact cannot be qualified by a synthetic
fixture. These are explicit release blockers, not waived checks. No production
tag, publisher dispatch, environment secret/hash change or production upload
was performed while preparing this change. This tooling PR must not auto-merge.

## Contract and flow

Ops main's `.github/workflows/weekly-clients.yml`,
`docs/weekly-app-repin.md` and `config/weekly-apps.json` own selection and
dispatch. Ops verifies its production record and the annotated Connect tag,
then dispatches `sdk-repin.yml` on Journal main with `connect_release`.
The schedule currently uses Sunday 08:00 UTC: 19:00 Melbourne in AEDT,
18:00 in AEST. Journal adds no second scheduler or release selector.

`scripts/sdk-repin.mjs` and `scripts/lib/npm-provenance.mjs` come from merged
Reader PR 113. The repin reads Ops main's `render/release.env`, binds the supplied
tag's peeled commit, and authenticates npm's Sigstore provenance against the
exact repository, publisher workflow, tag, commit, package, version and SHA512.
The fetched tarball must match that signed digest. All packages are verified
before any manifest is written. Non-SDK local originals stay pinned. The root
npm lock must retain each verified package's exact version, integrity and
registry tarball URL. No SDK is pinned by this tooling PR.

The existing release App opens/updates only `automation/sdk-repin`, with exact
manifest/lock changes, then enables squash auto-merge. Required `Journal CI`
runs for every PR and main push: frozen no-script/no-bin-link installation,
lint, strict typecheck, all tests, publisher tests and `build:ci`.
`build:ci` verifies all installed production original members before importing
the build entrypoints, then builds the real production consumer and offline
shell in a temporary output directory. Its source-derived digest checks are
unprivileged CI validation, not independent publisher authority. Existing
`build`, `build:local`, LAB scripts and the protected publisher are unchanged.

After successful main-push CI, `weekly-native-production.yml` handles only a
same-repository merged train PR whose merge SHA is that exact successful main
commit. Ordinary main changes do nothing. Before acquiring write authority it
checks the PR, source diff, reviewed native ancestry, clean checkout and current
main. With the App token it rechecks the exact App author, current main and the
existing production release HEAD's ancestry, then performs **one atomic,
non-forced Git push** of:

- `release/native-production` advanced to the merged SHA;
- `native-publish-production-<fullSHA>` newly created at the same commit.

The App token is necessary for the push to trigger the existing tag workflow.
There is no workflow dispatch, CI-token fallback, pending-deployment approval,
automatic push retry or force update. An existing exact tag/current release
HEAD is observed without replaying the publisher; conflicting or moved refs
fail. A failed/unknown publisher result requires inspection, not automatic
retagging, rebuilding or rollback.

`native-journal.yml` remains unchanged: exact new tag/event/workflow SHA,
reviewed ancestry, current `release/native-production` HEAD (including its last
network recheck), independent environment hashes, npm original/member checks,
publisher tests, immutable artifact custody and all served-byte checks still
apply. A handoff or upload success is not proof of release success.

## Applied settings — API verified November 1, 2026

These are the explicitly authorized live changes, not pending YAML proposals.

| Setting | Before | After |
| --- | --- | --- |
| Main protection | No branch protection; no matching ruleset | Active `main-journal-ci`, ID `26307054`, matches only `refs/heads/main`: PR required, zero required approving reviews, strict/up-to-date required `Journal CI` from GitHub Actions integration `15368`, deletion and non-fast-forward blocked, no bypass actors |
| Repository auto-merge | `allow_auto_merge=false` | `allow_auto_merge=true`, needed for the reference repin contract |
| Production deployment tag policies | Policy `64408483`: `native-publish-production-1adce042083abcf171c419ce589a0bd924ddfbbd`; policy `64153959`: `native-publish-production-983a5d8fd497999d3abe0e9bc3520f8976e55db6` | Policy `64408483` updated to tag pattern `native-publish-production-*`; policy `64153959` deleted; exactly one tag policy remains |
| Native publication tag immutability | Existing staging-only ruleset, no all-native-tag update/delete rule | Additional active `immutable-native-publication-tags`, ID `26307053`, matches `refs/tags/native-publish-*`, update and deletion blocked, no bypass actors |

GET readback verified both new rulesets, effective main rules, repository
auto-merge and the full environment deployment policy list. The
`journal-production` environment still has no required reviewers,
`can_admins_bypass=false`, and custom tag policies; its other settings,
credentials and four independent hash variables were not changed. Both older
staging rulesets remain untouched. The existing production release branch has
no matching ruleset; this PR does not claim otherwise or change that additional
setting. The publisher continues to enforce its exact current-HEAD rules.

## Validation

The provenance tests use mocked Sigstore verification and registry responses,
including wrong repo/workflow/tag/commit/digest, tampered archive, missing
provenance, HTTP 404/500, and npm lock digest/URL drift. The repin fixture tests
beta.149, atomic refusal when the SDK is absent, exact pins and repeat no-op.
Handoff tests mock all GitHub/Git calls: main/CI/PR/App binding, ancestry,
manifest-only changes, atomic refs, moved refs, tag conflicts and no retry.
None of those fixtures publish an SDK or exercise production.

Run `npm ci --ignore-scripts --no-bin-links --no-audit --no-fund`,
`npm run lint`, `npm run typecheck`, `npm test`, `npm run test:publisher`,
`npm run build:ci` and `actionlint` on the three new workflows.
