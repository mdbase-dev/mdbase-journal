# Public SDK application intake

Journal consumes the immutable SDK563 dev packet through ordinary local file dependencies. This is development intake, not release/runtime qualification.

- SDK source: `563dc868fd5847abe272bd8cead1b044cd46fbe0`.
- Original SDK bytes/SHA/SRI and independent original protocol pin: `vendor/mdbase-sdk-dev-563dc868.json`.
- `MdbaseConnect`, `MdbaseApplicationDeclaration` and `MdbaseApplicationEntry` come from `@mdbase-dev/sdk`.
- Test-only `createApplicationFixture` and `MemoryReplica` come from `@mdbase-dev/sdk/testing`; the production entry never imports testing.
- Application lifecycle and collection selection use `application()` and `connection(id)`. No app-side selection URL parser, popup callback, raw installation bootstrap or missing-runtime workaround remains.
- Records use the same public `connection.records`, original create mutation/UUID, receipt/readback and shared record sessions. Files use that client's identical public FilesApi.

The build verifies the immutable archives and every installed SDK dist member against its original archive. It consumer-bundles only the built public ESM entry, retains the original same-artifact Worker beside it and preserves the packaged native module directory. SDK563 contains the refusal trust module and no runtime/SQLite WASM; a native build explicitly refuses this incomplete dev packet rather than substituting assets. It does not rebuild, repack, rewrite installed declarations, renew trust or inject callbacks. Native/SQLite assets are integrity-pinned, not separately signed.

`npm run build` requires explicit registered application ID, environment and approved origin; see [README](../README.md). `npm run build:local` is an explicit writing-only build with no application constructor. Registration/native admission and deployment remain separate. The earlier SDK archive and provenance remain unchanged.

`npm run verify` checks strict declarations with `exactOptionalPropertyTypes=true`, `noUncheckedIndexedAccess=true`, `skipLibCheck=false`, public fixture/actual SDK records and files, browser-asset byte pins, and the writing-only build. Fixtures prove controlled app behavior, not physical popup/native lifecycle or real catalog readiness. The baseline prototype tests were replaced with typed tests of the new surface, not kept as a second app auth/data engine.

Earlier prototype drafts remain in their original storage namespace and are counted in settings. They are not automatically replayed without their original native identities. Failed local persistence never authorizes capture or clearing RAM text; uncertain native creation only checks the original receipt and record.
