import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {describeError} from "@mdbase-dev/sdk";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {createJournalApplication, journalConnection} from "../src/application.js";
import {applicationFixture, catalog, deferred, memoryStorage, snapshot} from "./support.js";
// Parse the actual writing surface; no old inline script or network executes.
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
function dom() {
  const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  return {window, page, write(body: string) {page.value = body; page.dispatchEvent(new window.Event("input", {bubbles: true}));}, click(id: string) {window.document.getElementById(id)!.click();}};
}
test("actual public singleton is lazy not_started in a controlled browser host, not an unavailable shell", async () => {
  // Browser-host stand-ins qualify constructor laziness only, never native
  // initialization, registration, storage readiness or popup lifecycle.
  const h = dom(), descriptors = new Map<string, PropertyDescriptor | undefined>();
  const fetch = mock.method(globalThis, "fetch", () => {throw new Error("Unexpected network");});
  for (const [name, value] of Object.entries({location: h.window.location, Worker: class {constructor() {throw new Error("Unexpected Worker");}}})) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, {configurable: true, value});
  }
  try {
    const entry = createJournalApplication({registeredApplicationId: "build-fixture-only", environment: "lab", origin: "https://journal.fixture"});
    const state = entry.application().getSnapshot();
    assert.equal(state.status, "not_started"); assert.equal(state.problem, null); assert.equal(state.selection.state, "none");
    assert.equal(state.readiness.assessment, null); assert.equal(entry.connection("22222222-2222-4222-8222-222222222222"), null);
    assert.equal(fetch.mock.callCount(), 0); await entry.application().close();
  } finally {
    fetch.mock.restore(); for (const [name, descriptor] of descriptors) {if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);}
    h.window.close();
  }
});
test("unregistered local writing opens a blank page and never needs an SDK", () => {
  const h = dom(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  const a = mountJournal(h.window.document, drafts, null);
  h.write("A private page"); assert.equal(a.currentDraft().body, "A private page");
  assert.match(h.window.document.getElementById("status")!.textContent!, /Sign-in is unavailable in this build/);
  const id = a.currentDraft().id; a.dispose();
  const b = mountJournal(h.window.document, drafts, null);
  assert.notEqual(b.currentDraft().id, id); assert.equal(h.page.value, ""); assert.equal(drafts.get(id)?.body, "A private page");
  b.dispose(); h.window.close();
});
test("first run imports prototype text quietly and reload never duplicates or overwrites resumed writing", () => {
  const h = dom(), storage = memoryStorage(), original = JSON.stringify({body: "Earlier local writing", createdIn: "old"});
  storage.setItem("journal.note.original", original);
  const drafts = new JournalDrafts(storage), view = mountJournal(h.window.document, drafts, null);
  assert.equal(h.page.value, "", "migration does not replace the new writing surface");
  assert.equal(drafts.list().length, 1); assert.equal(drafts.list()[0]!.createAttempt, null);
  const resume = h.window.document.querySelector<HTMLButtonElement>("#pending-details button")!;
  assert.equal(resume.textContent, "Resume writing"); resume.click();
  const id = view.currentDraft().id; h.write("Resumed original text plus more"); view.dispose();
  const again = mountJournal(h.window.document, new JournalDrafts(storage), null);
  assert.equal(drafts.list().length, 1); assert.equal(drafts.get(id)?.body, "Resumed original text plus more");
  assert.equal(storage.getItem("journal.note.original"), original);
  assert.equal(drafts.get(id)?.createAttempt, null); assert.equal(drafts.get(id)?.legacyKey, "journal.note.original");
  again.dispose(); h.window.close();
});
test("first-input writing controls reappear when quiet mode ends and reset on a new page", () => {
  const h = dom(), drafts = new JournalDrafts(memoryStorage()), view = mountJournal(h.window.document, drafts, null);
  assert.equal(h.window.document.body.classList.contains("typing"), false);
  h.write("First note"); const original = view.currentDraft();
  assert.equal(h.window.document.body.classList.contains("typing"), true);
  assert.equal(h.window.document.body.classList.contains("quiet"), true);
  h.window.document.dispatchEvent(new h.window.Event("pointermove"));
  assert.equal(h.window.document.body.classList.contains("quiet"), false);
  assert.equal(h.window.document.getElementById("new-button")!.hidden, false);
  assert.equal(h.window.document.getElementById("word-count")!.textContent, "2 words");
  view.newPage();
  assert.equal(h.window.document.body.classList.contains("typing"), false);
  assert.equal(h.window.document.getElementById("new-button")!.hidden, true);
  assert.equal(h.window.document.getElementById("undo-button")!.hidden, false);
  assert.equal(drafts.get(original.id)?.body, "First note");
  view.dispose(); h.window.close();
});
test("settings dialog has a visible accessible name and its trigger identifies it", () => {
  const h = dom(), menu = h.window.document.getElementById("menu")!;
  const title = h.window.document.getElementById(menu.getAttribute("aria-labelledby")!);
  assert.equal(title?.textContent, "Journal");
  assert.equal(h.window.document.getElementById("menu-button")!.getAttribute("aria-controls"), menu.id);
  assert.equal(menu.getAttribute("aria-describedby"), "menu-connection");
  h.window.close();
});
for (const trigger of ["menu-button", "status-button"]) test(`${trigger} initializes settings without resetting the writing folder`, () => {
  const h = dom(), drafts = new JournalDrafts(memoryStorage());
  drafts.savePreferences({folder: "writing", theme: "system"});
  const menu = h.window.document.getElementById("menu") as HTMLDialogElement;
  // Only native dialog presentation is simulated; no SDK/application exists.
  menu.showModal = () => menu.setAttribute("open", "");
  menu.close = () => {menu.removeAttribute("open"); menu.dispatchEvent(new h.window.Event("close"));};
  const view = mountJournal(h.window.document, drafts, null);
  h.write("Original note"); const original = view.currentDraft();
  h.click(trigger);
  assert.equal(menu.open, true);
  assert.equal((h.window.document.getElementById("folder") as HTMLInputElement).value, "writing");
  h.click("close-menu");
  assert.equal(menu.open, false); assert.equal(h.window.document.activeElement, h.page);
  assert.equal(drafts.preferences().folder, "writing");
  assert.equal(view.currentDraft().id, original.id); assert.equal(view.currentDraft().body, "Original note");
  view.newPage(); h.write("Next note"); assert(view.currentDraft().path?.startsWith("writing/"));
  assert.equal(drafts.get(original.id)?.body, "Original note");
  view.dispose(); h.window.close();
});
test("new page and Undo restore the same original draft identity and path", () => {
  const h = dom(), drafts = new JournalDrafts(memoryStorage()), view = mountJournal(h.window.document, drafts, null);
  h.write("Original"); const before = view.currentDraft(); h.click("new-button");
  assert.equal(h.page.value, ""); assert.notEqual(view.currentDraft().id, before.id);
  h.click("undo-button"); assert.equal(view.currentDraft().id, before.id); assert.equal(view.currentDraft().path, before.path); assert.equal(h.page.value, "Original");
  view.dispose(); h.window.close();
});
test("typing a new page dismisses Undo but retains its prior draft", () => {
  const h = dom(), drafts = new JournalDrafts(memoryStorage()), view = mountJournal(h.window.document, drafts, null);
  h.write("Old"); const id = view.currentDraft().id; view.newPage(); h.write("New"); view.undoNewPage();
  assert.equal(view.currentDraft().body, "New"); assert.equal(drafts.get(id)?.body, "Old");
  view.dispose(); h.window.close();
});
test("Undo expires at the original eight-second boundary", context => {
  context.mock.timers.enable({apis: ["setTimeout"]});
  const h = dom(), drafts = new JournalDrafts(memoryStorage()), view = mountJournal(h.window.document, drafts, null);
  h.write("Old"); view.newPage(); const id = view.currentDraft().id;
  context.mock.timers.tick(8000); view.undoNewPage(); assert.equal(view.currentDraft().id, id);
  view.dispose(); h.window.close(); context.mock.timers.reset();
});
test("keyboard new-page shortcut only acts from the writing surface outside dialogs", () => {
  const h = dom(), view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), null);
  h.write("Text"); const id = view.currentDraft().id;
  h.window.document.getElementById("folder")!.dispatchEvent(new h.window.KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true}));
  assert.equal(view.currentDraft().id, id);
  h.page.dispatchEvent(new h.window.KeyboardEvent("keydown", {key: "Enter", ctrlKey: true, bubbles: true})); assert.notEqual(view.currentDraft().id, id);
  view.dispose(); h.window.close();
});
test("quota failure never overwrites RAM text or clears the page", () => {
  const h = dom(), storage = memoryStorage(), drafts = new JournalDrafts(storage), view = mountJournal(h.window.document, drafts, null);
  h.write("Stored"); storage.setItem = () => {throw new Error("quota");}; h.write("Latest unpersisted text");
  assert.equal(view.currentDraft().body, "Latest unpersisted text"); assert.equal(h.page.value, "Latest unpersisted text");
  view.newPage(); assert.equal(h.page.value, "Latest unpersisted text"); assert.match(h.window.document.getElementById("status")!.textContent!, /Keep this page open/);
  view.dispose(); h.window.close();
});
test("initial quota failure keeps writing usable and recovers the same draft after storage returns", () => {
  const h = dom(), storage = memoryStorage(), original = storage.setItem;
  storage.setItem = () => {throw new Error("quota at startup");};
  const drafts = new JournalDrafts(storage), view = mountJournal(h.window.document, drafts, null);
  const id = view.currentDraft().id; h.write("Unpersisted original text");
  assert.equal(view.currentDraft().body, "Unpersisted original text"); assert.equal(drafts.get(id), null);
  view.newPage(); assert.equal(view.currentDraft().id, id);
  storage.setItem = original; h.write("Unpersisted original text plus more");
  assert.equal(drafts.get(id)?.body, "Unpersisted original text plus more");
  assert.equal(view.currentDraft().id, id);
  view.dispose(); h.window.close();
});
test("SDK selection notification during a storage failure cannot clear or repin the page", async () => {
  const f = await applicationFixture(), h = dom(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  f.fixture.controls.publishSnapshot({...f.ready, status: "opening"});
  const view = mountJournal(h.window.document, drafts, f.fixture.entry); h.write("Original destination"); const before = view.currentDraft();
  storage.setItem = () => {throw new Error("quota");};
  assert.doesNotThrow(() => f.fixture.controls.publishSnapshot(snapshot({selectedCollectionId: "other"})));
  assert.equal(h.page.value, "Original destination"); assert.equal(view.currentDraft().id, before.id);
  assert.equal(drafts.get(before.id)?.targetCollectionId, f.connection.id);
  assert.match(h.window.document.getElementById("status")!.textContent!, /Keep this page open/);
  view.dispose(); h.window.close(); f.close();
});
test("existing preferences and script-like text render as data", () => {
  const h = dom(), drafts = new JournalDrafts(memoryStorage()); drafts.savePreferences({folder: "writing", theme: "dark"});
  const view = mountJournal(h.window.document, drafts, null); h.write("<img src=x onerror=alert(1)> 日本語");
  assert.equal(h.window.document.documentElement.dataset.theme, "dark"); assert.equal(h.window.document.querySelectorAll("#page img").length, 0);
  assert(view.currentDraft().path?.startsWith("writing/")); assert.match(h.window.document.getElementById("word-count")!.textContent!, /words/);
  view.dispose(); h.window.close();
});
test("public fixture selection belongs to the SDK, not a second URL or storage parser", async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  f.fixture.controls.publishSnapshot(snapshot({status: "unselected", collections: f.ready.collections}));
  const view = mountJournal(h.window.document, drafts, f.fixture.entry);
  const choice = h.window.document.getElementById("collection-choice") as HTMLSelectElement;
  choice.value = f.connection.id; choice.dispatchEvent(new h.window.Event("change")); await Promise.resolve();
  assert.equal(f.fixture.controls.observedActions().find(call => call.action === "select")?.collectionId, f.connection.id);
  assert.equal(h.window.location.href, "https://journal.fixture/");
  view.dispose(); h.window.close(); f.close();
});
test("readiness checking, explicit problems and retired clients cannot become usable connections", async () => {
  const f = await applicationFixture();
  try {
    assert.equal(journalConnection(f.fixture.entry)?.records, f.records);
    f.fixture.controls.publishSnapshot({...f.ready, readiness: {...f.ready.readiness, checking: true}}); assert.equal(journalConnection(f.fixture.entry), null);
    f.fixture.controls.publishSnapshot({...f.ready, readiness: {...f.ready.readiness, problem: {code: "test-read-failed"}}}); assert.equal(journalConnection(f.fixture.entry), null);
    f.fixture.controls.publishSnapshot(f.ready); f.retire(); assert.equal(journalConnection(f.fixture.entry), null);
  } finally {f.close();}
});
test("application selection changes keep old text pinned and start a new page", async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  f.fixture.controls.publishSnapshot({...f.ready, status: "opening"});
  const view = mountJournal(h.window.document, drafts, f.fixture.entry); h.write("Original destination"); const original = view.currentDraft();
  f.fixture.controls.publishSnapshot(snapshot({status: "unselected", selectedCollectionId: "another", collections: [{collectionId: "another", displayName: "Work", role: "owner"}]}));
  assert.equal(h.page.value, ""); assert.equal(drafts.get(original.id)?.targetCollectionId, f.connection.id); assert.equal(drafts.get(original.id)?.body, "Original destination");
  assert.equal(view.currentDraft().targetCollectionId, "another"); view.undoNewPage(); assert.notEqual(view.currentDraft().id, original.id);
  view.dispose(); h.window.close(); f.close();
});
test("sign-in dispatch is synchronous in the click gesture and retains the original signal", async () => {
  const f = await applicationFixture(), h = dom(); f.fixture.controls.publishSnapshot(snapshot());
  let invoked = false;
  f.fixture.controls.setHandler("approve", () => {invoked = true;});
  const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), f.fixture.entry); h.click("connect-from-menu");
  assert.equal(invoked, true); assert(f.fixture.controls.observedActions().find(call => call.action === "approve")?.signal);
  await Promise.resolve(); view.dispose(); h.window.close(); f.close();
});
test("unapproved request cannot borrow the old ready client and approval stays a synchronous SDK action", async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  f.fixture.controls.publishSnapshot({...f.ready, selection: {...f.ready.selection, state: "approval_required",
    requested: {collectionId: "22222222-2222-4222-8222-222222222222", source: "url", displayName: null, approved: false}}});
  assert.equal(journalConnection(f.fixture.entry), null);
  let invoked = false; f.fixture.controls.setHandler("approve", () => {invoked = true;});
  const view = mountJournal(h.window.document, drafts, f.fixture.entry); h.write("Original destination");
  const original = view.currentDraft();
  assert.match(h.window.document.getElementById("status")!.textContent!, /Approve the requested collection/);
  assert.match(h.window.document.getElementById("menu-connection")!.textContent!, /stay on this device/);
  h.click("connect-from-menu"); assert.equal(invoked, true);
  assert(f.fixture.controls.observedActions().find(call => call.action === "approve")?.signal);
  assert.equal(view.currentDraft().body, original.body); assert.equal(view.currentDraft().targetCollectionId, f.connection.id);
  view.dispose(); h.window.close(); f.close();
});
test("review access delegates reauthorization without changing the original page", async () => {
  const f = await applicationFixture(), h = dom();
  f.fixture.controls.publishSnapshot({...f.ready, status: "opening"});
  let invoked = false; f.fixture.controls.setHandler("reauthorize", () => {invoked = true;});
  const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), f.fixture.entry); h.write("Retained");
  const id = view.currentDraft().id; h.click("connect-from-menu"); assert.equal(invoked, true);
  assert(f.fixture.controls.observedActions().find(call => call.action === "reauthorize")?.signal);
  assert.equal(view.currentDraft().id, id); assert.equal(view.currentDraft().body, "Retained");
  view.dispose(); h.window.close(); f.close();
});
test("setup delegates canonical configuration and preserves the same writing page", async () => {
  const f = await applicationFixture(), h = dom(); f.fixture.controls.publishSnapshot({...f.ready, status: "setup_required"});
  const drafts = new JournalDrafts(memoryStorage()), view = mountJournal(h.window.document, drafts, f.fixture.entry); h.write("Retained");
  const id = view.currentDraft().id;
  h.click("connect-from-menu"); await Promise.resolve(); await Promise.resolve();
  assert(f.fixture.controls.observedActions().some(call => call.action === "configure"));
  assert.equal(view.currentDraft().id, id); assert.equal(drafts.get(id)?.body, "Retained");
  view.dispose(); h.window.close(); f.close();
});
test("choose another delegates SDK selection while the original draft stays pinned", async () => {
  const f = await applicationFixture(), h = dom(); f.fixture.controls.publishSnapshot({...f.ready, status: "opening"});
  const drafts = new JournalDrafts(memoryStorage()), view = mountJournal(h.window.document, drafts, f.fixture.entry); h.write("Retained");
  const original = view.currentDraft(); h.click("reconnect-from-menu"); await Promise.resolve(); await Promise.resolve();
  assert(f.fixture.controls.observedActions().find(call => call.action === "chooseAnother")?.signal);
  assert.equal(drafts.get(original.id)?.body, "Retained"); assert.equal(drafts.get(original.id)?.targetCollectionId, f.connection.id);
  view.dispose(); h.window.close(); f.close();
});
test("failed sign-out preserves text and never reports a successful physical close", async () => {
  const f = await applicationFixture(), h = dom();
  f.fixture.controls.publishSnapshot({...f.ready, status: "opening", signIn: {requestId: "fixture-request", installationId: "fixture-installation", deviceId: "fixture-device", appId: "journal.fixture", kind: "app-runtime", verificationUri: "https://fixture.example/verify", state: "paired", accountId: "fixture-account", collectionIds: [f.connection.id], createCollections: false, requestedCreateCollections: false}});
  const drafts = new JournalDrafts(memoryStorage()), view = mountJournal(h.window.document, drafts, f.fixture.entry); h.write("Retained");
  const id = view.currentDraft().id;
  f.fixture.controls.setHandler("close", () => {throw new Error("physical stop failed");});
  assert.equal(h.window.document.getElementById("disconnect")!.hidden, false); h.click("disconnect"); await Promise.resolve(); await Promise.resolve();
  assert(f.fixture.controls.observedActions().some(call => call.action === "close"));
  assert.equal(view.currentDraft().id, id); assert.equal(view.currentDraft().body, "Retained");
  assert.equal(h.window.document.getElementById("status")!.textContent, describeError("internal")!.title);
  assert.match(h.window.document.getElementById("menu-connection")!.textContent!, /Reload/);
  assert.doesNotMatch(h.window.document.getElementById("menu-connection")!.textContent!, /physical stop failed/);
  assert.equal(f.records.link, "open");
  view.dispose(); h.window.close(); f.close();
});
test("late catalog completion after disposal cannot start data writes or close a borrowed client", async () => {
  const f = await applicationFixture(), h = dom(), job = deferred<ReturnType<typeof catalog>>();
  const describe = mock.method(f.records, "describe", () => job.promise), close = mock.method(f.records, "close"), create = mock.method(f.records, "create");
  const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), f.fixture.entry);
  h.write("Local"); view.dispose(); job.resolve(catalog()); await Promise.resolve(); await Promise.resolve();
  assert.equal(create.mock.callCount(), 0); assert.equal(close.mock.callCount(), 0); assert.equal(f.records.link, "open");
  describe.mock.restore(); create.mock.restore(); close.mock.restore(); h.window.close(); f.close();
});
