# Local native SDK migration

This repository is a local-only copy of the Journal prototype. It has no remote
and no deployment authorisation. The canonical prototype remains untouched.
The old beta123 CDN/default runtime is preserved until actual native composition
is delivered and proven. Asset intake below is **not a complete native port**.

## Qualified browser consumption path

The release-qualified `9ab0f31d43ae801241acb5fbc11f3be4ceefa76b` SDK archive is
vendored and file-pinned in `package.json`/`package-lock.json`. Its SHA256/SHA512
and browser member SHA256 are recorded in `vendor/mdbase-next-sdk.json`.
`npm run build` verifies those bytes, then copies the existing classic-script
`dist/browser/mdbase-sdk.min.js` into `public/sdk/` and derives a local SRI pin.
There is no bundler, SDK rebuild/repack, CDN publication or release packaging
request: the qualified archive already contains the required browser artifact.
Generated files are ignored; `npm run dev` builds them before serving locally.

After building, a future native entry module can consume it with:

```js
import { loadNativeSdk } from "./load-native-sdk.mjs";
const sdk = await loadNativeSdk({ signal: originalOwnerSignal });
// Public sdk.Client.MdbaseClient / sdk.AppHost.AppWebSignInSession, etc.
// Compose ONLY with the implemented, qualified shared factory/setup APIs.
```

The loader opens no connection, copies no host/session/setup engine, accepts no
unknown pre-existing SDK global, has no CDN/old-Connect fallback, and propagates
original cancellation. Its returned value is the actual classic bundle's public
`MdbaseSDK` namespace. Source/package qualification does not qualify sign-in,
People/native producer compatibility, runtime, app origins or custody.
`public/index.html` does not select this path yet; no fake native mode or factory
callback substitute is offered.

## Existing boundaries and native save/recovery

- Blank page per visit; local drafts/Undo preserve text independently of
  connectivity. Draft destinations stay pinned across collection switches.
- Inline `JournalSelection`, popup callback glue, old Connect construction and
  setup are not native implementations to copy. Shared helpers must own selection,
  sign-in, forget, bootstrap, host adapter, lease/lifetime and reviewed setup.
- Contract `journal.entry@0.1.0`, pack0.1.1 and collection-owned starter v2 are
  distinct identities. Require admitted semantic digest/type/field bindings;
  never infer them from starter names/resource SHA or fallback `created`.
- Native field-reference access/update must use shared public accessors rather
  than the prototype's ad hoc nested `setField` parser.
- Durably pin draft collection/native record UUID and original write UUID MID,
  target/body/base/recovery evidence before capture. Ambiguous replies never
  create another MID, sibling path or record to retry.
- Use shared native write/session/lease helpers, not app autosave/session engines.
  Native grants/state and full-source CAS/current readback remain authoritative.
- Saved body/revision/draft cleanup require original confirmed receipt plus
  same-record genuine current unprotected readback, not transport or receipt alone.
- Keep pending/unknown/held original identities across reload/collection switches;
  recovery is original receipt/readback only, not unconditional resubmission.
  Conflicting/deleted remote state must not silently restart create at a new path.
- Shared host owns client/adapter/session teardown. Original caller cancellation
  must fence late ready/saved callbacks across collection changes.

## Undelivered inputs

Signin1815: CP707 source ACK/queued; SDK SQL extraction is local WIP with tests,
types/build, **not a concrete scoped collection factory**. Exact public
factory/client/journal/config ABI and qualified source/artifact packet remain
unimplemented/unpublished. Callback types are not an implementation.

Tnapp must deliver shared manifest-driven assess/apply/setup/original journal ABI
and qualified `journal.entry@0.1.0` semantic tuple provenance. Final app identity,
approved origins, runtime/trust/custody inputs and hosted/relay-only launch policy
also remain undelivered. No Journal setup fork, private protocol or copied
TaskNotes Worker/SQL/session engine can substitute. SDK807/5ba remains held.

## Evidence

21 unchanged legacy Node tests pass. Six new tests copy/hash the actual qualified
classic bundle, load its real public exports in a VM and test SRI, cancellation,
asset failure and unknown-global refusal. Total **27 passing Node tests**.
A separate isolated Chromium smoke also loads the real local asset via SRI and
returns its public namespaces; it opens no client/session and contacts no CP.
The owned browser/server were closed immediately after the run.
These are asset-consumption checks, not native session/runtime/parser, manifest
installation, CRUD, sign-in or LAB acceptance. No browser is kept idle. Future browser runs are isolated, sequential and closed immediately.
