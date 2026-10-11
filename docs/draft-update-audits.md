# Journal draft update audits

Coordinator co0578 / co0636: rows 12, 16, 17 and 20.

- Each draft independently acquires its original SDK record lease. One rejected
  acquisition or indefinitely pending confirmation does not block later notes.
  Failed acquisition backs off from one second to one minute. Once a create
  intent exists, recovery only reads its original receipt/record; it never
  resubmits creation, chooses a sibling path or replaces SDK autosave.
- Settings show each pending entry's state and offer local writing restoration.
  Readiness notifications for the same selection cannot clear restored text.
  An actual SDK selection change still preserves and pins the old note.
- Pending `journal.note.*` writing imports once per source key. Original bytes,
  text, dates, path and known destination remain intact. Prototype entries lack
  original native capture identities: imported text stays local and explicitly
  needs original-save review, even when edited. It is never automatically sent
  as a new native record. Oversized entries cannot block importing smaller ones.
  Malformed entries cannot hide later pending writing, invalid dates fall back
  locally without dropping text, and colliding IDs never overwrite even an
  unreadable original native copy. Actual first-run/reload tests verify quiet
  import and that resumed, edited writing is neither duplicated nor reset.
- New empty visits/pages allocate an in-memory draft, not a localStorage entry.
  The first input must persist before any remote capture. Undo retains the same
  old draft identity. New pages allocate unique initial filenames before capture;
  existing paths and uncertain intents never change.
- Journal-owned storage is bounded to 3 MiB (UTF-16 key/value accounting) and 256
  native draft entries. Only finished, confirmed copies older than six hours can
  be evicted. Unsaved, recovery, imported and live-lease-pinned copies remain;
  exceeding the bound refuses persistence and keeps current RAM text visible
  with the existing keep-page-open warning. Other applications' storage is not
  pruned. New visits proactively reclaim eligible old confirmed copies even
  below the cap; cleanup is best-effort and never interrupts writing. Tests
  exercise the actual default 256-entry and 3 MiB limits, not only small budgets.
- Existing theme/folder/type preferences survive. Legacy `journal.prefs.v1`
  and `journal.collection` migrate once to `journal.prefs.v2`; original bytes
  remain, but modern preferences never re-read or resurrect old choices.
  Storage failure retains the legacy choices and retries migration safely;
  a fresh visit with no legacy preferences allocates no preference storage.
  A saved type is restored only
  if it exists in the current canonical catalog. SDK memory/URL owns collection
  selection; a legacy last-collection hint offers an explicit SDK selection
  action, never an automatic approval, fallback, or URL override.

Coordinator co0728: row 13 returning-user notice.

- Before startup, presence of historical Journal preference, collection or draft
  keys shows one calm, dismissible notice with the CP's approve-once wording,
  unchanged collections/notes, the Private desktop-online caveat and an official
  mdbase.dev link. It never reads old values, performs network calls, approves
  access, moves focus or blocks editing.
- One fixed seen marker records the first visit (including fresh users, so new
  preferences cannot later be mistaken for old usage). This is not a draft.
  Quota failure is best-effort with a same-lifetime RAM latch; inaccessible
  storage silently skips the notice. Persistence across a full reload cannot be
  promised when the browser refuses writes. Original storage bytes remain intact.
- Lean DOM tests cover old-key presence, once-only visits, dismissal with text
  and focus retained, fresh users, quota and privacy-policy failures. No new
  browser/native qualification is implied.

Verification: strict TypeScript, the full Node suite and writing-only build. Tests use
actual SDK record CRUD with MemoryReplica and controlled catalog/status metadata;
these are not native runtime, registration or delivery qualification. The build
checks original SDK Worker/native archive bytes and an exact application graph.
There is no separate lint script. Six writing-only loopback browser checks
passed on the earlier grid-fix tree; later SDK/migration changes have source
checks, not fresh browser or native qualification. SDK error/status helpers
use the exact DEV/LAB SDK41c intake. Public collection availability propagates
through that qualified SDK. Settings retain each unavailable name, disable its
selection affordance and show the SDK's exact title, message and action label;
only SDK-safe update links are clickable. Metadata cannot retire an original
ready lease, erase local writing or Undo, or authorize a capture. Missing
availability is not guessed. This is presentation over public SDK types, not a
consumer cache, routing engine, parse workaround or native qualification.
