# mdbase Journal

A blank page every time you open it. Notes stay on this device while you write and become Markdown records in the selected mdbase collection when the SDK confirms their original saves. Read previous notes in Editor or another collection app.

The existing quiet writing surface, light/dark themes, folder preference and keyboard controls remain. Ctrl/Cmd+Enter starts a page from the editor, not from settings. Undo new page restores the same draft for eight seconds. Every visit starts a new blank page without deleting previous drafts.

## SDK application port

Journal uses the public `MdbaseApplicationEntry` returned by `MdbaseConnect`. The SDK owns sign-in, popup presentation, URL selection, collection setup, readiness, the Worker and physical close. Journal subscribes to public snapshots and borrows the exact current `connection(id).records` and `connection(id).files`; it does not build another auth or storage engine.

The SDK archive is the production pin declared in `package.json` and `package-lock.json`. Local builds and protected publication resolve that archive's matching `sdk-production-*.json` metadata through the same production-pin check, including its byte count, SHA-256 and SHA-512. Builds compare every installed SDK dist member with the original archive and verify the direct protocol archive against the SDK's bundled original. Consumer bundling uses already-built public SDK modules, keeps the original Worker beside its application module and preserves the packaged module directory layout.

Local writing does not depend on runtime admission. Journal surfaces SDK readiness and refusals without substituting a runtime. Its native registration and browser/runtime acceptance are separate requirements, not established by this source port or fixture tests.

## Develop and verify

```sh
npm ci --ignore-scripts
npm run verify        # strict types, all tests, explicit writing-only build
npm run dev           # writing-only localhost app; no native registration
```

`npm run build:local` intentionally builds only local writing. It does not enable a mock runtime. To build the native application, give the environment and the exact origin Journal will be served from:

```sh
JOURNAL_ENVIRONMENT=production \
JOURNAL_ORIGIN='https://journal.mdbase.dev' \
npm run build
```

The build writes `JOURNAL_ORIGIN` into the manifest as its homepage (and icon and redirect URI), because sign-in only registers Journal from the manifest's own origin. LAB builds may use a local `http://` origin (`localhost`, `127.0.0.1` or `[::1]`); production builds need `https://`. `JOURNAL_REGISTERED_APPLICATION_ID` is optional and defaults to the manifest's `id`, as in the other mdbase apps; sign-in self-registration supplies the registered ID. Missing environment or origin fails the native build. `npm run manifest` writes the committed manifest, using `JOURNAL_ORIGIN` when set and the pages.dev origin otherwise. A native build for another origin rewrites `public/.well-known/mdbase-app.json`; do not commit that copy.

Native builds require the installed SDK's packaged release trust to match the requested environment. The committed production SDK cannot be retargeted to LAB or staging. The protected staging publisher authenticates the matching SDK prerelease archive and installs it ephemerally; `deploy:lab` uses the installed packet and refuses production trust, so a qualified LAB packet must be supplied before LAB deployment. Journal never substitutes assets or trust. Registration and runtime readiness remain separate from build verification.

Tests use the SDK's `createTestMdbase` front door with actual SDK clients over `MemoryReplica` for records and files. Controlled readiness/catalog metadata is test-only, not native/runtime acceptance. Type checking retains `exactOptionalPropertyTypes=true` and `skipLibCheck=false`.

## Saving and recovery

- Local drafts are persisted before any native capture. Failed persistence keeps text visible and refuses a remote write.
- Draft destinations remain pinned across collection changes. Switching starts a blank page; the original note stays with its original collection.
- Creation retains the original record UUID, mutation UUID and exact intent before capture, then settles it with the SDK's `save()`. A write the log has not confirmed yet is kept on this device and the SDK write ledger settles it, also after a reload; Journal opens the record and keeps writing. A later visit reads the original record by its UUID. Only a refusal starts a new intent; Journal never retries creation at a sibling path.
- Edits use the shared SDK record lease, autosave and flush. Only a confirmed record displays Saved.
- Conflicts, holds, deletion or changed remote text preserve local writing instead of recreating or overwriting another record. Closing a writing view releases only its borrowed leases, never the shared client.
- Earlier prototype `journal.note.*` drafts remain byte-for-byte on the device and are counted in settings. They lack original native mutation identities, so the port does not silently migrate or replay them.

The `journal.entry@0.1.0` contract determines creation fields. Collection-owned type names and exact semantic digest/field bindings are read from the current catalog; the starter name is never a fallback. Nested field references require shared SDK support and currently refuse saving rather than using an app-side parser. `npm run manifest` rebuilds the managed contract/starter manifest from `pack/`.

No npm publication or deployment is part of this port.
