# mdbase journal

A blank page every time you open it. Each note becomes a Markdown record in an
mdbase collection. Journal supplies only a `created` timestamp; the collection's
type supplies its own fields and lifecycle rules. There is
no list of old notes: open the collection in Editor or another app to read them.

Prototype. The whole app is `public/index.html`, a single page that loads the
mdbase Connect browser SDK from jsdelivr, pinned by version and SRI hash.

- Notes are kept in `localStorage` on every keystroke and saved to the
  collection after a short pause, retrying until the collection accepts them.
- Every load, including a reload or a new tab, starts a new page. Leaving a page
  open never clears it. ⌘/Ctrl+↩ starts a new page. The writing surface keeps its
  original spacing; bottom scroll padding keeps the caret clear of the footer.
- Writing fades the date and collection name. Scrolling, swiping, pointer
  movement, or keyboard focus reveals controls again; on touch devices the
  settings button stays faintly visible and tappable.
- **New page** offers **Undo new page** for eight seconds, restoring the same
  entry even if it has already saved. Typing on the new page, expiry, or changing
  collections dismisses Undo. ⌘/Ctrl+↩ only starts a page from the writing surface,
  never while a settings dialog is open.
- `?collection=<collection-id>` selects a collection for that tab, taking
  precedence over the device's remembered choice. Settings lists authorized
  collections and offers **Connect another collection**; an unauthorized URL
  selection can be connected with **Reconnect this collection**. Switching
  updates the URL and starts a fresh page when the current entry has text.
  Pending entries stay pinned to their original collection and save when you
  switch back. Writing done before choosing any collection adopts the first
  collection you connect. Other tabs keep their own selection.
- Journal asks Connect for `collection.read`, `records.create` and
  `records.edit`. Sign-in is Connect's ordinary web flow, in a popup so the page
  stays put; the manifest's homepage and redirect URI are the
  `mdbase-journal.callum-artifacts.pages.dev` alias, so sign-in works only there.
  `public/_redirects` serves the app at `/auth/mdbase/callback` (rewritten to
  `/`, not `/index.html`, which Pages would redirect and drop the query). The
  popup is recognised by a marker Journal stores before opening it, because
  Connect cuts the popup's `window.opener`. Journal's own `JournalSelection`
  recognises the callback URL (the SDK's in-memory selection never does) and
  remembers the chosen collection on the device while keeping selection in the
  tab's URL.
- `?demo` uses an in-memory collection and shows the Markdown each note produces.

## Journal entries

`pack/` holds the `journal.entry` contract and a starter `journal-entry` type.
On first connection Journal offers to add both to the collection: the contract
stays managed by Journal, and the starter type becomes the collection's own, to
customise in Editor (rename `created`, add fields filled in by lifecycle rules,
such as tags).

Journal looks up the collection's types implementing `journal.entry` with
`describe`, then creates each note in one write: that type, `created` under the
type's own field name, and the body. The type's lifecycle rules fill in the rest.
If several types implement the contract, the menu asks which one to use.

The starter type's schema does not require or pin the type key: Journal creates
notes with an explicit type, so each collection records it under its own
`explicit_type_keys` (for example `mdbase_type`). Its `match` rule only
recognises hand-written `type: journal-entry` notes. Version 1 required `type` and
failed in such collections; pack 0.1.1 offers v2 as a reviewed `upgrade_from`
upgrade of the exact v1 bytes.

`npm run manifest` rebuilds `public/.well-known/mdbase-app.json` from `pack/` with the
digests pinned, and validates it.

## Local native SDK preparation

See [the migration inventory](docs/new-sdk.md) for the separate local-only
workspace, save/recovery requirements and blocked qualified SDK inputs. The
prototype runtime below remains unchanged.

## Develop

```sh
npm install
npm run dev          # http://localhost:8765/?demo
npm test             # selection, pending-write safety, quiet controls, Undo, and spacing
```

## Icons

The icon is one row of the mdbase Frontmatter mark, its field square and
highlighted line, centred on the same 16-unit grid: the field in Journal's green
(`#00785a`, dark `#4cc3a0`) and the line in ink. The heavier apps use the full
mark; Journal's single row matches its one field and a line of writing.
Alone, the pixel grid's square field and one-unit gap look cramped, so the
install icons use the original logo's proportions (field 12 × 10, gap 8, line 56)
at the family's bar height. The 16px favicon stays on whole grid units.
`scripts/icons.mjs` is adapted from mdbase-reader's icon script and regenerates
the PNGs in `public/`; `public/favicon.svg` is written by hand.

## Deploy

Deployed as a throwaway preview on the `callum-artifacts` Pages project:

```sh
npx wrangler@4.125.0 pages deploy public --project-name callum-artifacts --branch mdbase-journal
```

Latest: https://mdbase-journal.callum-artifacts.pages.dev
