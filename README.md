# mdbase Journal

A blank page every time you open it. Notes stay on this device while you write and become Markdown records in the selected mdbase collection when the SDK confirms their original saves. Read previous notes in Editor or another collection app.

The existing quiet writing surface, light/dark themes, folder preference and keyboard controls remain. Ctrl/Cmd+Enter starts a page from the editor, not from settings. Undo new page restores the same draft for eight seconds. Every visit starts a new blank page without deleting previous drafts.

## SDK application port

Journal uses the public `MdbaseApplicationEntry` returned by `MdbaseConnect`. The SDK owns sign-in, popup presentation, URL selection, collection setup, readiness, the Worker and physical close. Journal subscribes to public snapshots and borrows the exact current `connection(id).records` and `connection(id).files`; it does not build another auth or storage engine.

The dependency is the immutable **dev intake** at `41c26ca7`, not a release-qualified runtime. Its original tar and the active original browser-safe Connect protocol `c280cd194ffd` tar are file-pinned with source/SRI in `vendor/mdbase-sdk-dev-41c26ca7.json`. The old SDK and protocol archives remain unchanged. This packet has no vendor warnings or unused historical protocol member; the older development packet's warning remains only in its original retained metadata. Consumer bundling uses already-built public SDK modules, keeps the original Worker beside its application module and preserves the packaged module directory layout.

Local writing does not depend on runtime admission. Journal surfaces SDK readiness and refusals without substituting a runtime. Its native registration and browser/runtime acceptance are separate requirements, not established by this source port or fixture tests.

## Develop and verify

```sh
npm ci --ignore-scripts
npm run verify        # strict types, all tests, explicit writing-only build
npm run dev           # writing-only localhost app; no native registration
```

`npm run build:local` intentionally builds only local writing. It does not invent a registered ID or enable a mock runtime. To build the native application declaration, all three approved inputs are mandatory:

```sh
JOURNAL_REGISTERED_APPLICATION_ID='<registered ID>' \
JOURNAL_ENVIRONMENT=lab \
JOURNAL_ORIGIN='<approved exact origin>' \
npm run build
```

These are build inputs, not proof of registration. Do not derive the ID or environment from the logical manifest ID or the historical preview URL. Missing inputs fail the native build. The current SDK41c dev packet contains its original runtime/SQLite WASM and canonical LAB trust (`native.available=true` describes packaged asset availability, not registration/readiness). LAB native consumer builds now succeed with explicit build inputs; without them they still refuse. Production trust remains unavailable. Journal never supplies substitute assets or trust. Registration and any LAB refresh/deployment remain separately owned.

Tests use the public SDK application fixture with actual SDK clients over `MemoryReplica` for records and files. Controlled readiness/catalog metadata is test-only, not native/runtime acceptance. Type checking retains `exactOptionalPropertyTypes=true` and `skipLibCheck=false`.

## Saving and recovery

- Local drafts are persisted before any native capture. Failed persistence keeps text visible and refuses a remote write.
- Draft destinations remain pinned across collection changes. Switching starts a blank page; the original note stays with its original collection.
- Creation retains the original record UUID, mutation UUID and exact intent before capture. Unknown outcomes query the same receipt and record; Journal never retries creation at a sibling path.
- Edits use the shared SDK record lease, autosave, flush and recovery. A transport reply or optimistic record is not enough to display Saved.
- Conflicts, holds, deletion or changed remote text preserve local writing instead of recreating or overwriting another record. Closing a writing view releases only its borrowed leases, never the shared client.
- Earlier prototype `journal.note.*` drafts remain byte-for-byte on the device and are counted in settings. They lack original native mutation identities, so the port does not silently migrate or replay them.

The `journal.entry@0.1.0` contract determines creation fields. Collection-owned type names and exact semantic digest/field bindings are read from the current catalog; the starter name is never a fallback. Nested field references require shared SDK support and currently refuse saving rather than using an app-side parser. `npm run manifest` rebuilds the managed contract/starter manifest from `pack/`.

No npm publication or deployment is part of this port.
