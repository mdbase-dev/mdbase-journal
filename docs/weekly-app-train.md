# Weekly app train

## Status and boundaries

This adopts the Reader PR 113 provenance/repin contract with Journal's npm v3
lock and original-file boundaries, required CI, and a guarded publisher handoff.
It does **not yet establish unattended production readiness**:

- `@mdbase-dev/sdk@0.1.0-beta.149` is published and production-verified.
  Live verification on November 2, 2026 authenticated its real Sigstore
  provenance and downloaded bytes against the exact production tag/commit.
  The remaining blocker is native intake, **not** an absent SDK.
- Callum is arranging installation of the release App and will add its tag
  creation bypass after installation. The current creation ruleset permits
  only repository admins, not the App. This change does not install an App,
  alter any setting/credential, or fall back to `GITHUB_TOKEN`.
- Journal's existing native intake explicitly requires a `file:vendor/*.tgz`
  SDK, its complete owner-delivered production packet, bundled protocol byte
  equality and independent environment hashes. A provenance-verified npm pin
  alone does not satisfy that contract. `sdk-repin` now authenticates the real
  archive and refuses **before manifest, lock, integrity/output writes or PR
  creation** when it does not match the qualified packet. It preserves every
  `file:`/workspace/link input, including SDK. The existing native validator is
  called on any matching admitted original; missing independent hashes or any
  member/packet failure also refuses. No new vendor original or packet is
  synthesized, and no knowingly unmergeable npm-SDK PR is opened.

The runtime's published artifact cannot be qualified by a synthetic fixture.
These are explicit release blockers, not waived checks. No production
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
before any manifest is written. All local originals stay file-pinned. The root
npm lock must retain each verified package's exact version, integrity and
registry tarball URL. No SDK is pinned by this tooling PR.

The existing release App opens/updates only `automation/sdk-repin`, with exact
manifest/lock changes, then enables squash auto-merge. Required `Journal CI`
runs for every PR and main push: frozen no-script/no-bin-link installation,
strict typecheck, all tests, publisher tests and `build:ci`. ESLint and
typescript-eslint are removed; Sigstore stays.
`build:ci` calls the existing `native-build.mjs --ci` path, with four fixed,
source-reviewed fingerprints independently read from the existing production
environment on November 2. It never computes expectations from candidate bytes.
The same native builder verifies installed originals before SDK imports,
builds all tracked static files and the consumer/offline shell, then validates
the full publication inventory. This source-only mode creates no tag/event,
publisher envelope or upload. The duplicate `build-production.mjs` is removed.
Protected publication still receives its independent hashes from its protected
environment. Existing local/LAB build commands are unchanged.

After successful main-push CI, `weekly-native-production.yml` handles only a
same-repository merged train PR whose merge SHA is that exact successful main
commit. Ordinary main changes do nothing. Before acquiring write authority it
checks every PR commit's GitHub author **and** committer, their App bot ID/login
and canonical Git name/email, plus a complete bounded commit list ending at the
recorded PR head. It accepts only modifications to the existing root
`package.json` and `package-lock.json`, never a new/nested manifest or file-type
change. It regenerates the exact npm pin plan from the pre-merge manifest and
compares the entire manifest, so scripts, overrides and non-pin fields cannot
change. Lock changes are limited to those direct `@mdbase-dev/*` entries and
matching root pins; unrelated/new/transitive entry changes fail closed.
Each allowed resolution is reauthenticated against npm provenance, exact
version, tarball and integrity. Reviewed ancestry, clean checkout and current
main also bind the candidate. With the App token it rechecks the exact App
identity, all commits/content, current main and the
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

## Settings — creation restriction API-verified November 2, 2026

The original PR applied the first four rows. Callum subsequently applied the
fifth row; this revision makes **no** live settings changes.

| Setting | Before | After |
| --- | --- | --- |
| Main protection | No branch protection; no matching ruleset | Active `main-journal-ci`, ID `26307054`, matches only `refs/heads/main`: PR required, zero required approving reviews, strict/up-to-date required `Journal CI` from GitHub Actions integration `15368`, deletion and non-fast-forward blocked, no bypass actors |
| Repository auto-merge | `allow_auto_merge=false` | `allow_auto_merge=true`, needed for the reference repin contract |
| Production deployment tag policies | Policy `64408483`: `native-publish-production-1adce042083abcf171c419ce589a0bd924ddfbbd`; policy `64153959`: `native-publish-production-983a5d8fd497999d3abe0e9bc3520f8976e55db6` | Policy `64408483` updated to tag pattern `native-publish-production-*`; policy `64153959` deleted; exactly one tag policy remains |
| Native publication tag immutability | Existing staging-only ruleset, no all-native-tag update/delete rule | Additional active `immutable-native-publication-tags`, ID `26307053`, matches `refs/tags/native-publish-*`, update and deletion blocked, no bypass actors |
| Production tag creation (Callum-added) | No production tag creation restriction; write actors could create matching tags | Active `native-production-tag-creation`, ID `26312904`, matches `refs/tags/native-publish-production-*`, creation blocked; only bypass is `RepositoryRole` ID `5` (admin), mode `always`; **no release App bypass yet** |

The wildcard is an environment admission policy, **not** a source-review or
separate-GO check. Creation restrictions now prevent ordinary writers from
reaching production secrets via newly created production tags. Admins can
bypass creation; there is no separately enforced manual-GO approval. Immutable
update/delete restrictions have no bypass actors and remain separate. The
App's atomic push will fail until Callum installs and explicitly admits it.

GET readback verified both new rulesets, effective main rules, repository
auto-merge and the full environment deployment policy list. The
`journal-production` environment still has no required reviewers,
`can_admins_bypass=false`, and custom tag policies; its other settings,
credentials and four independent hash variables were not changed. Both older
staging rulesets remain untouched. The existing production release branch has
no matching ruleset; this PR does not claim otherwise or change that additional
setting. The publisher continues to enforce its exact current-HEAD rules.

## Exact beta.149 native-intake answer

The live registry tarball is unchanged `sdk-0.1.0-beta.149.tgz`, SHA256
`e573c3c2df74076a868e8422ec4e6cf233ede3007806757a03000aed865dedb6`,
bound to production commit `4443fd15c4a591e46538eae24cf8425708e6a7f0`.
The existing admitted SDK SHA256 is
`e64771a90bed2fb3837d4b65df8930fcd124d3059fcb0bcbaf9d64dbfb148205`.
The archive's embedded native provenance is `mdbase-sdk/npm-publication/1`,
with runtime producer `mdbase-dev/mdbase-connect` at
`e161f426a521c39adf8ca057255fa940338f7de4`; Journal currently requires
`mdbn-sdk/application-assets/1` and native producer `mdbase-dev/mdbase-next`.
The new archive bundles protocol `0.1.0-beta.145` and names
`vendor/mdbase-dev-connect-protocol-0.1.0-beta.145-e6e66bcd172f.tgz`;
Journal's independently pinned original is beta.129. Its current bundled-member
equality check must not be waived.

To admit these bytes without weakening checks, the owner must provide/review:

1. A producer-authenticated complete production packet for these exact bytes:
   archive facts/source/tree/digests and all members; byte-identical embedded
   provenance; original build receipt/verifier evidence; production trust
   asset/context; original release-trust and image JSON/Sigstore proofs and
   qualification/publication bindings. Existing beta.141 archive facts cannot
   be relabelled. The npm package still embeds the beta.141 trust asset hash
   `7912e40838213e60b65848350d319a48019021317b112e3326429b250f0133d7`;
   its reuse must be independently authenticated, not assumed invalid or new.
2. The exact beta.145 protocol original, its full bundled-member qualification,
   a qualified UI original, and a frozen npm file-pin intake with every
   installed member and `inBundle` dependency binding preserved.
3. An explicit, source-reviewed migration of the native validator to the new
   embedded provenance schema/producer, with equivalent runtime/SQLite/trust
   source, size, digest and packet bindings. Sidecars alone cannot fix a schema
   the unchanged SDK embeds. Alternatively the producer must supply a genuinely
   compatible original; do not repack/patch the npm tarball or relax a check.
4. Independently approved public hash custody for intake and publisher, updated
   source-reviewed CI expectations, and the normal consumer/type/build and
   publisher qualification. The repin requires all four independent hash
   expectations rather than deriving them from candidate files.

No compatible packet or schema migration is fabricated in this revision, so
the real repin intentionally refuses before any PR. Preserving `file:` is
necessary but not sufficient for qualification.

## Validation

The provenance tests use mocked Sigstore verification and registry responses,
including wrong repo/workflow/tag/commit/digest, tampered archive, missing
provenance, HTTP 404/500, and npm lock digest/URL drift. The repin fixture tests
beta.149, atomic intake refusal, preserved file pins and repeat no-op.
Handoff tests cover a human commit on the App branch, changed scripts/overrides,
new nested manifests, lock edits outside the allowed scope, provenance-bound
resolutions, complete App commit identities and all prior ref/CI/ancestry guards.
`npm run test:sdk-intake:live` passed with the real beta.149 artifact and full
Sigstore verification, then exercised the actual repin refusal and checked that
manifest/lock/output/integrity files were untouched. This read-only network test
is opt-in, not a network dependency of ordinary CI. No test publishes anything.

Run `npm ci --ignore-scripts --no-bin-links --no-audit --no-fund`,
`npm run typecheck`, `npm test`, `npm run test:publisher`, `npm run build:ci`
with the four fixed public expectations from CI, and `actionlint` on the three
new workflows. The live SDK test is a separate explicit command above.
