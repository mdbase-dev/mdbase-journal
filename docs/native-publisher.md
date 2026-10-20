# Native Journal publisher — source only

This NEW workflow is unregistered. Co approved a native-tag bootstrap, **not a
main merge to register dispatch**. Nothing here creates tags, resources, policies,
credentials or production authority. Existing LAB `deploy:lab`, project/profile,
SDK/UI/protocol pins and actual `runtime-lab.wasm` metadata remain unchanged.

## Authority and original intake

NX-TRUST/TNAPP perform full-chain authentication **once OFF-CI**, using private Ops
verify-trust and normal qualified owner custody. CI neither repeats nor claims
fresh Sigstore/expiry/default-clock authentication. There is no public full-chain
tool/API, new signing authority, artifact authentication flag or approval receipt.

Exactly four protected **per-environment** variables carry independent owner
expectations: `NATIVE_SDK_SHA256`, `NATIVE_UI_SHA256`, `NATIVE_PROTOCOL_SHA256`
(the three raw original tgz SHA256s), and `NATIVE_TRUST_ASSET_SHA256` (the **raw
signed** `next-trust/<environment>.json` bytes). The last equals authenticated
release inventory `trustAssets[0].sha256`, context `context.sha256`, SDK provenance
`trust.sha256`, and compiled `appReleaseTrust().assetSha256`, **not** module,
context, receipt or archive SHA. Module integrity is separately inventoried.
Variable format checks do not audit custody: GitHub repo/org fallback and actual
per-environment values/protection require external review, not self-certification.

Owner-delivered target originals must be committed unchanged under original
`vendor/*.tgz` filenames, with their exact file pins and **frozen NPM**
`package-lock.json` intake. The byte-verbatim public delivery packet is committed
at `vendor/native-release/<target>/`: `artifact-facts.json`, `members.json`,
`provenance.json`, `build-receipt.json`, `next-trust/<target>-context.json`,
`next-trust/<target>.json`, and the four original release/image JSON+Sigstore
proof files. These are TNAPP's existing schemas, not a Journal descriptor schema.
The immutable target source review must explicitly pin/review the complete
packet/facts, qualified SDK source/tree, native source/length/budget,
verifier source/hash, log/source/version, publication and qualification evidence
against the authenticated owner handoff. Candidate JSON cannot approve itself.
Do not introduce a fifth ad-hoc hash variable or invent absent target custody.

Before executing any installed SDK/UI/protocol code: verify three archive hashes,
SHA512 lock integrities, frozen root and original package/dependency pins, all
safe original members and **ALL installed** members, exact bundled protocol bytes
and nested NPM `inBundle` version/dependencies. Then verify canonical original
provenance/facts/context/receipt/proofs and compiled release literal bindings.
Actual native producer `runtime.source.repository` is `mdbase-dev/mdbase-next`,
DISTINCT from Connect trust/context source `mdbase-dev/mdbase-connect`.
Canonical protocol facts `dependencies[].file` is the full `vendor/...tgz` path,
not a basename alias. Actual facts environment/trust/handoff/verifier/module
hash must agree with original provenance/module; producer informational booleans
are never authentication gates.
Missing/noncanonical target originals refuse; LAB never becomes staging by an
origin/environment flag. TNAPP's actual STAGING SDK a3023aee is READY (05:48 owner handoff;
NXtrust authentication/readback05:38), with parent-preserved original custody.
This does not commit Journal's target intake: current Journal still pins LAB0ec
and cannot publish a native target. Target repin and target-source qualification
are separate future owner work; no pin or per-app UI choice changes here. No SDK/native build/repack
is part of this publisher.

## Exact publication reference and external protection

Only a newly created push event for
`native-publish-{staging|production}-<full lowercase 40-hex commit>` starts the
bootstrap. Runtime guards validate the **entire** tag/ref/event, repository,
workflow ref/SHA, peeled local tag commit, clean exact checkout, reviewed native
ancestry (baseline `2007dc4d7aa65a8dd6871e37532dde7a43eca674`) and exact current
`release/native-<target>` HEAD. An ancestor alone, matching tag glob or arbitrary
SHA is insufficient. Immediately before the single upload, GitHub's current
exact tag is peeled and the protected branch HEAD is re-read last.

External owners must protect reviewed release refs/workflow source and immutable
tags against update/deletion/force/bypass. YAML cannot establish immutability or
source review. Environment deployment policy must admit the **tag event target**,
not just `release/native-*` branch events. Environments are `journal-staging` and
`journal-production`. **Separate Callum GO before any production tag creation or
dispatch**; then protected production UI approval with Callum required reviewer
and no admin bypass. This is NOT a prevent-self-review requirement. Never use a
pending-deployments API, approval hash or machine approval substitute.

## Build once, isolate upload

1. No-checkout/no-candidate-code environment job exports only the four public
   byte expectations, without secrets.
2. Separate **unprivileged, no-environment/no-CF-secret** job checks originals,
   `npm ci --ignore-scripts --no-bin-links`, installed originals, explicit
   `node node_modules/typescript/bin/tsc --noEmit` and dependency-free publisher
   tests. Disabling installer-generated `.bin` symlinks preserves the strict
   no-link/ALL-original-members check; there is no link-exclusion exception. It builds the target app ONCE from tracked static inputs,
   uses the canonical strict protocol manifest validator (`allowLocal:false`),
   generates offline shell, then inventories **every final file**. No NPM hooks
   or SDK producer/native compilation is run. This is not a pnpm conversion.
3. Protected upload job has **job-scoped `contents:read` + `actions:read`**, not
   extra Actions access in the build job. Reviewed source checkout runs no app
   install, hooks/build or artifact-provided project code. It validates immutable
   artifact ID, actual ZIP SHA256, repository/run/attempt/event/tag/source/tree,
   metadata before/after download, safe bounded no-link extraction, envelope,
   full exact path set and independently rederived source plan/full inventory.
4. Official Wrangler **4.114.0** alone is installed via the dedicated minimal
   `tools/native-publisher/{package.json,package-lock.json}`, every transitive
   integrity frozen, `npm ci --ignore-scripts`. Fresh TEMP outside app/workspace,
   scrubbed install environment and **distinct empty** user/global npm configs
   prevent workspace/app configuration inheritance (including npm's double-load
   `/dev/null` failure). Tool installation is approved; no invented tool image,
   prebundled requirement or SDK verifier transport.
5. Publication artifact becomes read-only. Source-owned policy rejects executing
   Pages `_worker.js`, Functions, unknown/nested hosting controls or altered
   `_headers`/`_redirects`. `assertInventory` runs immediately before the last
   current-HEAD guard and sole `pages deploy --no-bundle`, in a config/Functions-
   free TEMP cwd. Post-upload inventory assertion gates served verification.

## Existing hosting, static control policy and receipts

Only the Ops-created Pages project **mdbase-journal**, ID
`b44ca562-d51c-4768-b3df-3b9e47b478f7`, is eligible. This is the **project UUID**,
not a Cloudflare account ID. A read-only planned project lookup validates exact
identity/name/production channel before upload; never auto-provision.

| Target | Exact origin | Pages channel | Exact CP |
| --- | --- | --- | --- |
| staging | https://staging.mdbase-journal.pages.dev | staging | https://connect-staging.mdbase.dev |
| production | https://journal.mdbase.dev | main | https://connect.mdbase.dev |

Pages `main` selects a hosting channel, never Git main merge authority. Native
staging has no loopback/LAB fallback. Protected secrets are named only:
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Parent owns policy/domain/credential
setup after source review; production is **not currently authorized**.

The trusted native static policy is source code, not an artifact flag: callback
`/auth/mdbase/callback` is an exact internal 200 rewrite to original index;
unknown/control/Worker paths must serve the original custom 404 bytes with 404;
final static responses require `nosniff`, `no-referrer`, `Cache-Control: no-store`
and correct WASM/JS/JSON MIME. CDN canonical HTML redirects are checked by the
shared verifier; header assertions apply to final responses, not redirect headers.
`_headers`/`_redirects` stay separately inventoried and verified through their
source-exact bytes **and live header/route probes**. Any unknown control remains
blocking. Static `mdbase-shell-sw.js` and SDK browser Worker JS are actual static
bytes, **not** Cloudflare's executing `_worker.js` mode.

Actual deployment UUID is resolved from the unique uploaded URL plus exact
commit/channel **before any served checks**. Upload success alone does not enable
verification: workflow requires successful capture. The unchanged shared byte
helper (SHA256 `a4336258cea726285573e9e667bba1c1ad6797fdba331715d0f17ea67ea5c66a`)
fetches ALL actual servable HTML/manifest/JS/native/SQLite/trust/dot/underscore/
offline bytes with credential omission and trusted origin/mappings. Live policy
probes and byte checks share a hard **180-second** total deadline. Every failure
and every unverified control blocks success; HTTP200/marker alone cannot pass.

Always-retained receipts/evidence include source/tree, original digests/packet
bindings, run/attempt/event/ref, artifact ID/metadata/actual ZIP digest, envelope,
full upload inventory, project identity, upload output, actual UUID (if captured),
verification successes/failures/unverified controls. A successful receipt also
independently binds immutable artifact metadata/run/digest and existing project.
Failure is a failed/incomplete receipt, never authority to automatically rebuild,
redeploy or roll back. Served-byte/source proof is NOT native sign-in, grant,
readiness, managed read or Journal acceptance/admission proof.

## Local checks and remaining gates

`npm run test:publisher` is dependency-free Node coverage (synthetic in-memory
packet/ZIP fixtures, not authenticated target originals). `npm run verify` is
full existing generic source compatibility; its builds remain pinned **LAB/local**,
not actual native staging/prod qualification. Neither invokes this workflow.

Still external: Journal's uncommitted intake of the now-READY authenticated
STAGING originals with its separately approved UI original, reviewed frozen
target NPM intake/packet facts, source/qualification evidence and target
compatibility (production originals/GO remain separate);
protected immutable branch/tag/workflow and exact environment/tag policies;
actual per-env public-hash custody/fallback audit; domains/credentials/Callum UI
review/no-bypass; real alias serving and native application acceptance. Production
GO is separate. No local unit test or green workflow can create these authorities.
