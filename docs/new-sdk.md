# Local native SDK migration inventory

This repository is a local-only copy of the Journal prototype. It has no remote
and no deployment authorization. The canonical prototype remains untouched.
`public/index.html` still loads the old Connect beta123 CDN/SRI asset; no native
browser/session artifact has been consumed or enabled.

## Current boundaries

- One blank page per visit; local drafts and Undo preserve text independently
  of connectivity. Draft destinations are pinned across collection switches.
- The inline `JournalSelection`, popup callback marker, Connect construction and
  application-session setup are old-runtime glue, not a native implementation to
  port or duplicate. Native sign-in, selection, forget, bootstrap, host adapter,
  lease/lifetime and reviewed setup must come from shared SDK/factory helpers.
- Journal's contract is `journal.entry` **0.1.0**. The type pack is **0.1.1**;
  those are different identities. The starter is collection-owned `journal-entry`
  v2, with an exact reviewed v1 upgrade baseline. Native selection requires the
  actual admitted contract version/semantic digest and implementing type/field
  bindings, not starter filenames or a default `created` fallback.
- Journal supplies only the mapped `created` timestamp and body. Collection
  lifecycle semantics must stay native. Nested field-reference encoding needs a
  shared SDK accessor/update seam, not the prototype's `setField` parser.

## Native save/recovery requirements

The prototype's result-shaped create/update and path/conflict continuation
behavior cannot simply be relabelled as native writes:

1. Durably pin each draft to its selected collection and stable native record
   UUID. Names/timestamp paths remain presentation, not record identity.
2. Capture each native write's original UUID MID, target, body/base and recovery
   evidence. New edits use the shared lease/session or native write helpers, not
   an app SDK/autosave engine. An ambiguous reply never creates another MID,
   record or sibling path merely to retry.
3. Actual create/edit grants/state and genuine current source/CAS evidence are
   needed. `savedBody`, revision and draft cleanup require the original confirmed
   receipt plus qualified same-record current readback, without pending/held/
   unresolved layers. A receipt or successful transport alone is insufficient.
4. Unknown/pending/protected outcomes retain the exact draft and recovery identity
   through reload and collection switches. Recovery is receipt/readback only;
   conflicting/deleted remote state must not silently restart create at a new path.
5. Reader/Writer's shared native lease/session recovery and lifetime helpers must
   be reused when applicable. The SDK/host owns adapter and session teardown;
   stale callbacks cannot publish ready or saved in a different collection.

## Exact dependencies still missing

- Corrected browser classic-script asset, exported root/Client/AppHost types and
  release-qualified source/hash/provenance. SDK807/5ba is under the operational
  safety hold; intake requires actual SDK808 merge, coordinator GO and qualified
  successor rebuild. Packaging alone is not sign-in/runtime acceptance.
- Shared manifest-driven collection/setup assessment and native semantic digest
  provenance for `journal.entry@0.1.0`, approved-plan/apply/readback recovery and
  qualified trust/origin/native runtime inputs. Never derive semantic digest from
  raw Markdown/type-pack resource SHA or add a Journal setup fork.
- Actual merged/release-qualified native records lease/session ABI where used;
  SDK809's source ACK is not a packed artifact or operational approval.
- Final app identity/origins and hosted/relay-only launch policy. The copied
  throwaway preview alias is not authorization for a new public deployment.

## Evidence

The unchanged local prototype baseline passes **21 Node tests** (selection,
collection pinning, pending draft behavior, Undo and controls/spacing). These are
VM/stub tests, not native SDK, browser/runtime, parser, manifest install or LAB
acceptance. No headless browser is kept idle. Future browser tests are sequential
(one per agent), isolated and closed immediately when the run finishes.
