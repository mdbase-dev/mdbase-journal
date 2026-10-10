# Local native SDK migration

This repository is a local-only copy of the Journal prototype. It has no remote
and no deployment authorisation. The canonical prototype remains untouched.
The old beta123 CDN/default runtime is preserved until actual native composition
is delivered and proven. Asset intake below is **not a complete native port**.

## Qualified browser consumption path

The release-qualified `729b5391f9e8e8c192d93a7112324ce65078d106` SDK archive is
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

The qualified SDK729b5391 archive includes actual SDK819 merge19bdeee1's shared
native factory/client/journal/config ABI and SDK827 provider-receipt helpers.
Release qualified all 275 members, 1650 SDK tests and five browser-bundle checks
(with three existing WASM-gated skips). This is delegated source/archive intake,
not native factory/producer-ABI, browser or custody acceptance. Runtime/trust
repinning and serving are not authorized; qualified per-app composition inputs
remain required.

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

## Public SDK sign-in UI (local only)

`public/native-signin-ui.mjs` provides the same plain-language sign-in controls as
the other launch apps. Call the existing one-shot `loadNativeSdk()` first, pass its
actual result plus explicit SDK release/app identity/origins/runtime/locks/original
signal to `createNativeSignIn(sdk, options)`, then use
`mountNativeSignIn(container, binding, { onSignedOut })` in qualified composition.
The default index/drafts/legacy runtime remain untouched; no guessed native
configuration or runnable native URL is supplied.

Sign in reserves a named 620×760 Connect popup synchronously before SDK
start/expiry renewal, using the other apps' production pattern. The trusted popup
keeps its opener so the UI can close it across origins; the tab fallback detaches
its opener before navigation (noopener semantics). No secrets, postMessage
approval or storage callback use the opener. The UI keeps its original handle
after SDK handoff and closes on completed/terminal public statuses, never while
authorizing additional consent even when already paired. Disposal closes only
the owned popup. A detached fallback tab is not claimed parent-closeable across
origins. The SDK owns polling, approval, custody and native lifecycle. The UI subscribes to actual
status/email, delegates reopen and selected-ID forget, and waits for confirmed SDK
close before local sign-out. Close is not grant revocation or protected-store
erasure. The caller owns teardown and SDK replacement after confirmed close;
disposing a borrowed view fences callbacks but does not close another owner's SDK.

The native collection callback rejects with **Opening collections isn't available
in this build yet.** It never manufactures a client or setup result. No unsupported
decline, offline-sync, setup or reminder state is fabricated. Thirteen UI/portal/action
stand-in tests cover original cancellation, reservation ordering, automatic status
publication, confirmed close, forget and retired views; they are not native auth
or LAB qualification. The updated real Chromium check uses two owned loopback
origins and the original popup handle: additional consent stays open, then the UI
actually closes after a completion snapshot. The fixture never closes the popup;
390px long-email layout and keyboard/blocked-path checks also pass. All 40 Node
tests pass. Journal stays on its local branch with no remote or PR.
