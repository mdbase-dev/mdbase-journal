import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage, snapshot} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function dom() {
  const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  return {window, page, write(body: string) {page.value = body; page.dispatchEvent(new window.Event("input", {bubbles: true}));}};
}
test("repeated empty visits and New page do not save blank local drafts", () => {
  const h = dom(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  for (let i = 0; i < 10; i++) {const view = mountJournal(h.window.document, drafts, null); view.dispose();}
  assert.deepEqual(drafts.list(), []); assert.equal(storage.length, 0);
  const view = mountJournal(h.window.document, drafts, null); h.write("Original"); const id = view.currentDraft().id;
  view.newPage(); assert.equal(drafts.list().length, 1); assert.equal(drafts.get(view.currentDraft().id), null);
  view.undoNewPage(); assert.equal(view.currentDraft().id, id); assert.equal(h.page.value, "Original");
  view.dispose(); h.window.close();
});
test("legacy text is accessible and editable locally once, with no original storage overwrite", () => {
  const h = dom(), storage = memoryStorage(), old = JSON.stringify({id: "prototype", body: "Earlier private text", path: "old.md", targetCollectionId: "original"});
  storage.setItem("journal.note.prototype", old); const drafts = new JournalDrafts(storage), view = mountJournal(h.window.document, drafts, null);
  assert.match(h.window.document.getElementById("pending-details")!.textContent!, /Earlier note: original save needs review/);
  h.window.document.querySelector<HTMLButtonElement>("#pending-details button")!.click();
  assert.equal(h.page.value, "Earlier private text"); assert.equal(view.currentDraft().targetCollectionId, "original");
  h.write("Earlier private text plus local editing"); assert(view.currentDraft().legacyKey);
  assert.match(h.window.document.getElementById("status")!.textContent!, /review its original save/);
  view.dispose(); const second = mountJournal(h.window.document, drafts, null);
  assert.equal(drafts.list().length, 1); assert.equal(drafts.list()[0]!.body, "Earlier private text plus local editing");
  assert.equal(storage.getItem("journal.note.prototype"), old); second.dispose(); h.window.close();
});
test("same-scope readiness notifications cannot clear restored writing pinned to another collection", async () => {
  const f = await applicationFixture(), h = dom(), storage = memoryStorage();
  storage.setItem("journal.note.earlier", JSON.stringify({body: "Original earlier text", targetCollectionId: "another-original-collection", path: "original.md"}));
  const describe = mock.method(f.records, "describe", async () => catalog()), create = mock.method(f.records, "create");
  const view = mountJournal(h.window.document, new JournalDrafts(storage), f.fixture.entry);
  h.window.document.querySelector<HTMLButtonElement>("#pending-details button")!.click();
  const id = view.currentDraft().id;
  f.fixture.controls.publishSnapshot({...f.ready, readiness: {...f.ready.readiness, checking: true}});
  assert.equal(view.currentDraft().id, id); assert.equal(h.page.value, "Original earlier text");
  assert.equal(view.currentDraft().targetCollectionId, "another-original-collection"); assert.equal(create.mock.callCount(), 0);
  view.dispose(); describe.mock.restore(); create.mock.restore(); h.window.close(); f.close();
});
test("the saved collection is a visible SDK action, not an automatic authority or URL override", async () => {
  const f = await applicationFixture(), h = dom(), storage = memoryStorage();
  storage.setItem("journal.collection", JSON.stringify(f.connection.id));
  f.fixture.controls.publishSnapshot(snapshot({status: "unselected", collections: f.ready.collections}));
  const view = mountJournal(h.window.document, new JournalDrafts(storage), f.fixture.entry);
  const previous = h.window.document.getElementById("last-collection") as HTMLButtonElement;
  assert.equal(previous.hidden, false); assert.equal(previous.textContent, "Open Writing");
  assert.deepEqual(f.fixture.controls.observedActions().map(call => call.action), ["setForeground"]); assert.equal(f.fixture.entry.application().getSnapshot().selection.state, "none");
  previous.click(); const selected = f.fixture.controls.observedActions().filter(call => call.action === "select");
  assert.equal(selected.length, 1); assert.equal(selected[0]?.collectionId, f.connection.id); assert.equal(h.window.location.href, "https://journal.fixture/");
  await turn(); view.dispose(); h.window.close(); f.close();
});
test("an explicit unapproved request is not replaced by the remembered collection", async () => {
  const f = await applicationFixture(), h = dom(), storage = memoryStorage();
  storage.setItem("journal.collection", JSON.stringify("remembered"));
  f.fixture.controls.publishSnapshot({...f.ready, selection: {...f.ready.selection, state: "approval_required", usable: null,
    requested: {collectionId: "22222222-2222-4222-8222-222222222222", source: "url", displayName: null, approved: false}}});
  const view = mountJournal(h.window.document, new JournalDrafts(storage), f.fixture.entry);
  assert.equal(h.window.document.getElementById("last-collection")!.hidden, true);
  assert.deepEqual(f.fixture.controls.observedActions().map(call => call.action), ["setForeground"]);
  assert.equal((h.window.document.getElementById("collection-choice") as HTMLSelectElement).value, "22222222-2222-4222-8222-222222222222");
  view.dispose(); h.window.close(); f.close();
});
test("entry type selection is restored only from the current canonical catalog and survives reload", async () => {
  const f = await applicationFixture(), h = dom(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  drafts.savePreferences({folder: "writing", theme: "dark", entryTypes: {[f.connection.id]: "B"}});
  const types = catalog("created", "A"); types.types.push(catalog("written", "B").types[0]!); types.contracts[0]!.implementedBy.push("B");
  const describe = mock.method(f.records, "describe", async () => types);
  let view = mountJournal(h.window.document, drafts, f.fixture.entry); await turn();
  const choice = h.window.document.getElementById("entry-type") as HTMLSelectElement;
  assert.equal(choice.value, "B"); choice.value = "A"; choice.dispatchEvent(new h.window.Event("change"));
  assert.equal(drafts.preferences().entryTypes?.[f.connection.id], "A"); assert.equal(drafts.preferences().folder, "writing");
  assert.equal(drafts.preferences().theme, "dark"); assert.equal(drafts.preferences().collectionId, f.connection.id);
  view.dispose(); view = mountJournal(h.window.document, drafts, f.fixture.entry); await turn(); assert.equal(choice.value, "A");
  view.dispose(); describe.mock.restore(); h.window.close(); f.close();
});
test("a removed saved type remains unselected rather than inventing a mapping", async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  drafts.savePreferences({folder: "journal", theme: "system", entryTypes: {[f.connection.id]: "removed"}});
  const types = catalog("created", "A"); types.types.push(catalog("written", "B").types[0]!);
  const describe = mock.method(f.records, "describe", async () => types), create = mock.method(f.records, "create");
  const view = mountJournal(h.window.document, drafts, f.fixture.entry); await turn(); h.write("Local writing"); await turn();
  assert.equal((h.window.document.getElementById("entry-type") as HTMLSelectElement).value, ""); assert.equal(create.mock.callCount(), 0);
  view.dispose(); describe.mock.restore(); create.mock.restore(); h.window.close(); f.close();
});
test("an older uncertain entry does not replace the new page's truthful Saved state", {timeout: 10_000}, async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  const describe = mock.method(f.records, "describe", async () => catalog()), original = f.records.create.bind(f.records);
  const create = mock.method(f.records, "create", async (...args: Parameters<typeof original>) => {if (args[0].body === "First") throw new Error("unknown original outcome"); return original(...args);});
  const saved = deferred<void>(), status = h.window.document.getElementById("status")!;
  const observer = new h.window.MutationObserver(() => {if (status.textContent === "Saved") saved.resolve();});
  observer.observe(status, {childList: true});
  const view = mountJournal(h.window.document, drafts, f.fixture.entry);
  try {
    await turn(); h.write("First"); await turn(); const first = view.currentDraft();
    assert.match(h.window.document.getElementById("status")!.textContent!, /original save is unresolved/);
    view.newPage(); h.write("Later"); await saved.promise; await turn();
    assert.equal(drafts.get(first.id)!.savedBody, null); assert.equal(drafts.get(view.currentDraft().id)!.savedBody, "Later");
    assert.equal(h.window.document.getElementById("status")!.textContent, "Saved");
    assert.match(h.window.document.getElementById("pending-details")!.textContent!, /Original save unresolved; checking again/);
    assert.equal(create.mock.callCount(), 2); assert.notEqual(first.path, view.currentDraft().path);
  } finally {observer.disconnect(); view.dispose(); describe.mock.restore(); create.mock.restore(); h.window.close(); f.close();}
});
