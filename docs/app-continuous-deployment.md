# Journal continuous deployment

Ops owns Journal's independent App CD line through the same `app-cd.yml` →
reusable `app-publish.yml` used by Writer and Reader. Exact green main → staging
→ fresh-browser smoke → production → fresh-browser smoke. The publisher receives
an exact forty-hex `source_sha`, not moving main. Each boundary rechecks exact
main-push CI, ancestry and the live-production SDK producer compatibility gate.
An incompatible or unreadable server contract quietly waits without uploading.
A failed app holds only itself, never Server CD or another app.

`deploy-journal.yml` replaces the native tag publisher and weekly native handoff.
The local `sdk-repin.yml` and its owner-packet refusal are retired; ops' single
continuous SDK repinner owns future archive/pin/lock PRs. SDK originals remain
file-pinned, byte-identical to provenance-verified npm publications; the direct
protocol comes unchanged from that SDK's bundled archive. The existing UI original
is retained, with its frozen npm integrity and every installed member checked.
No archived SDK is patched, repacked, relabelled or made newly authoritative.

Before candidate dependency execution the workflow authenticates npm/Sigstore
producer identity and the same producer's signed staging archive, then binds
packaged target/origins, raw protected trust hash, native/SQLite assets, frozen
npm inputs and complete installed originals. Staging derives an ephemeral npm
install from that authenticated archive; committed production inputs stay intact.
The read token is scoped to workflow-owned SDK intake and API checks, never
registry/blob hosts or candidate dependency/application execution.

Protected upload executes only workflow-owned helpers and isolated pinned tools.
It verifies immutable same-run artifact ID/digest/source/tree/target and the full
inventory, offline shell, exact source-bound entry, native/trust bytes and static
hosting policy. It verifies deployment URL and alias bytes and callback/header/
missing-route behavior. Journal remains a static Pages app; no Functions or R2
policy is copied from Writer. Its existing project and approved staging/production
origins are unchanged.

The built entry is `assets/index-journal-SOURCE12.js`. Both ops `live()` and the
release dashboard read that served marker; a desired repository pin is not live
identity. Normal local/LAB fixture builds retain their old root entry name.
Fresh-browser smoke disables cache/service workers, checks the source module,
opens Journal settings, requires Sign in, and rejects page errors/readiness fences.
It does not sign in or write a note.

## Recovery and drill

Production captures the existing canonical Pages UUID and its transitive static
asset bytes before upload, retaining the recovery point independently. Incomplete
upload/verification, smoke failure or cancellation invokes ordinary predecessor
recovery and a stable alias/byte verification interval. It never undoes a newer
publisher and never makes the failed run green. External Google font services and
injected Insights are not recoverable Pages assets; SDK/native bytes are.

A direct human main production dispatch may opt into default-off `drill: true`.
The exact source must already be canonical and served. After a distinct UUID is
uploaded and normal smoke passes, workflow-owned code deliberately fails smoke.
Ordinary recovery must retain `restored: true`, `ok: true` and the captured UUID.
This proves live same-source Pages recovery, not changed-source or broken-upload
recovery, signed-in operations, user-data restore or external font availability.
A direct drill does not itself exercise ops hold creation or webhook delivery.

Inspect exact attempt, smoke and recovery receipts, then clear only Journal via
ops `bin/release app-line clear journal`. Unknown writes are reconciled, not
redispatched. Retain bounded artifacts and complete/merge the normal ops deployment
report after each deployment/drill. Raw API, browser or Wrangler logs are not
uploaded.

## Existing environment settings

`journal-staging` and `journal-production` retain their scoped Cloudflare secrets.
They admit main only, without a separate GO, reviewer or UI approval. The protected
`JOURNAL_TRUST_ASSET_SHA256` pins the raw signed target asset committed unchanged
under `config/next-trust/`: production `7912e408…`, staging `18ae86a2…` (full values
in `config/sdk-publication.json`). Production trust bytes are unchanged; staging
differs from the retired asset only in issuance/source attribution. Roots, policy
keys, origins, signing identities and all user data are unchanged. A real change
to any of those trust/signing boundaries must return to the owner.

## Authenticated SDK intake

When `GITHUB_TOKEN` is present, SDK release metadata and staging archive/bundle
bytes use GitHub REST. Asset bytes use
`/repos/mdbase-dev/mdbase-connect/releases/assets/<id>` with
`Accept: application/octet-stream` and Bearer authentication. Without a token,
assets use their exact `browser_download_url`; authenticated failures never fall
back anonymously. Exact asset names and browser URLs, SHA256 digests, and the
repository/workflow/ref/source attestation identity remain mandatory. npm and
unrelated archive hosts never receive the token; tokens and asset IDs are not
persisted in plans.

Staging installation uses the same transport. Journal then compares the downloaded
local original archive and all installed members, preserving its existing local
custody gate; it does not re-download originals during comparison. The workflow
supplies the read-only job token only to intake, installation and comparison,
alongside existing workflow-owned API checks. The build wrapper deletes it after
the original gate and before dynamic candidate imports. Dependency installation
itself does not receive it. All jobs
inherit `actions: read` and `contents: read`, with no write overrides.

Transient reads retain retryable 403/408/429/5xx responses and network failures,
with waits of 5, 20, 60 and 120 seconds and a 30-second per-attempt timeout. One
read permits five attempts over 355 seconds; the protected guard step allows
seven minutes. Existing job deadlines and upload/recovery constraints are
unchanged.
