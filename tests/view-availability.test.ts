import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock, test} from "node:test";
import {JSDOM} from "jsdom";
import {describeError, type MdbaseApplicationSnapshot} from "@mdbase-dev/sdk";
import {JournalDrafts} from "../src/drafts.js";
import {journalConnection} from "../src/application.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
type Availability = NonNullable<MdbaseApplicationSnapshot["collections"][number]["availability"]>;
const reasons: Extract<Availability, {state: "unavailable"}>["reason"][] = ["device_offline", "desktop_update_required", "old_connector_running", "approval_required", "sync_required", "no_device_registered", "access_removed", "collection_migrating", "collection_deleted"];
for (const reason of reasons) test(`public unavailable ${reason} retains its name and exact SDK guidance without offering selection`, async () => {
  const f = await applicationFixture(), h = new JSDOM(html, {runScripts: "outside-only"});
  const unavailable = {collectionId: "unavailable", displayName: "Earlier collection", role: "owner" as const, availability: {state: "unavailable" as const, reason}};
  const usable = {collectionId: "other", displayName: "Other collection", role: "owner" as const};
  f.fixture.controls.publishSnapshot({...f.ready, collections: [...f.ready.collections, unavailable, usable]});
  const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), f.fixture.entry);
  try {
    const choice = h.window.document.getElementById("collection-choice") as HTMLSelectElement, copy = describeError(unavailable)!;
    assert(copy); assert.equal(choice.options.length, 4);
    const option = [...choice.options].find(item => item.value === unavailable.collectionId)!;
    assert.equal(option.textContent, `${unavailable.displayName} — ${copy.title}`); assert.equal(option.disabled, true);
    const row = h.window.document.querySelector<HTMLElement>('.collection-guidance[data-collection-id="unavailable"]')!;
    assert.equal(row.querySelector("strong")!.textContent, option.textContent); assert.equal(row.querySelector("p")!.textContent, copy.message);
    if (copy.actionLabel) assert(row.textContent!.includes(copy.actionLabel));
    assert(!row.textContent!.includes(reason)); if (copy.developerMessage) assert(!row.textContent!.includes(copy.developerMessage));
    const link = row.querySelector("a");
    if (copy.updateUrl) {assert(link); assert.equal(link.href, copy.updateUrl); assert.equal(link.textContent, copy.actionLabel); assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener noreferrer");}
    else assert.equal(link, null);
    choice.value = "unavailable"; choice.dispatchEvent(new h.window.Event("change"));
    assert.equal(f.fixture.controls.observedActions().filter(item => item.action === "select").length, 0);
    assert.equal(choice.value, f.connection.id);
    choice.value = "other"; choice.dispatchEvent(new h.window.Event("change"));
    assert(f.fixture.controls.observedActions().some(item => item.action === "select" && item.collectionId === "other"));
  } finally {view.dispose(); h.window.close(); f.close();}
});
test("advisory list unavailability cannot retire the original ready lease, clear writing or change its identity", async () => {
  const f = await applicationFixture(), job = deferred<ReturnType<typeof catalog>>(), describe = mock.method(f.records, "describe", () => job.promise);
  const h = new JSDOM(html, {runScripts: "outside-only"}), drafts = new JournalDrafts(memoryStorage());
  const originalLease = journalConnection(f.fixture.entry), view = mountJournal(h.window.document, drafts, f.fixture.entry);
  try {
    const page = h.window.document.getElementById("page") as HTMLTextAreaElement;
    page.value = "uipolish: keep original writing"; page.dispatchEvent(new h.window.Event("input")); const original = view.currentDraft();
    const entry = {...f.ready.collections[0]!, availability: {state: "unavailable" as const, reason: "device_offline" as const}};
    f.fixture.controls.publishSnapshot({...f.ready, collections: [entry]});
    assert.equal(journalConnection(f.fixture.entry), originalLease); assert.equal(view.currentDraft().id, original.id); assert.equal(page.value, original.body);
    assert.equal(drafts.get(original.id)?.targetCollectionId, original.targetCollectionId);
    const choice = h.window.document.getElementById("collection-choice") as HTMLSelectElement;
    assert.equal(choice.value, f.connection.id); assert.equal(choice.selectedOptions[0]!.disabled, true);
    view.newPage(); view.undoNewPage(); assert.equal(page.value, original.body); assert.equal(view.currentDraft().id, original.id);
    f.fixture.controls.publishSnapshot(f.ready);
    assert.equal(h.window.document.getElementById("collection-availability")!.hidden, true);
    assert.equal(h.window.document.querySelector(".collection-guidance"), null); assert.equal(choice.selectedOptions[0]!.disabled, false);
  } finally {view.dispose(); describe.mock.restore(); job.resolve(catalog()); h.window.close(); f.close();}
});
test("an unavailable remembered collection stays named but cannot bypass the disabled explicit-open hint", async () => {
  const f = await applicationFixture(), h = new JSDOM(html, {runScripts: "outside-only"}), drafts = new JournalDrafts(memoryStorage());
  drafts.savePreferences({theme: "system", folder: "journal", collectionId: "old"});
  const entry = {collectionId: "old", displayName: "Original name <img>", role: "owner" as const, availability: {state: "unavailable" as const, reason: "approval_required" as const}};
  f.fixture.controls.publishSnapshot({...f.ready, status: "signed_out", selectedCollectionId: null, collections: [entry], selection: {...f.ready.selection, state: "none", usable: null, requested: {collectionId: null, source: "none", approved: false, displayName: null}}});
  const view = mountJournal(h.window.document, drafts, f.fixture.entry);
  try {
    const button = h.window.document.getElementById("last-collection") as HTMLButtonElement;
    assert.equal(button.hidden, false); assert.equal(button.disabled, true); assert.equal(button.textContent, `Open ${entry.displayName}`);
    button.dispatchEvent(new h.window.Event("click"));
    assert.equal(f.fixture.controls.observedActions().filter(item => item.action === "select").length, 0);
    assert.equal(h.window.document.querySelector("#collection-availability img"), null);
    assert(h.window.document.getElementById("collection-availability")!.textContent!.includes(entry.displayName));
  } finally {view.dispose(); h.window.close(); f.close();}
});
