import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock, test} from "node:test";
import {JSDOM} from "jsdom";
import {mdbaseError} from "@mdbase-dev/sdk";
import {JournalDrafts} from "../src/drafts.js";
import {JournalData, journalEntryTypes} from "../src/journal-data.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert(ready());
}
function windowForJournal() {
  const window = new JSDOM(html, {url: "https://journal.fixture/"}).window;
  const dialog = window.document.querySelector<HTMLDialogElement>("#entries")!;
  dialog.showModal = () => dialog.setAttribute("open", ""); dialog.close = () => dialog.removeAttribute("open");
  return window;
}
async function savedDraft(h: Awaited<ReturnType<typeof applicationFixture>>, drafts: JournalDrafts, body = "Saved entry") {
  const data = new JournalData(h.connection, drafts), type = journalEntryTypes(catalog())[0]!;
  try {
    await h.records.settle(h.records.create({type: type.name, path: `journal/${crypto.randomUUID()}.md`, frontmatter: {created: new Date().toISOString()}, body}));
    const entries = await data.entries([type]);
    const entry = entries.find(entry => !drafts.list().some(draft => draft.recordId === entry.id))!;
    return await data.resume(entry);
  } finally {data.release();}
}

test("a collection deletion removes a clean device copy from the open entry list and after reload", async () => {
  const h = await applicationFixture(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  const draft = await savedDraft(h, drafts);
  let window = windowForJournal(), view = mountJournal(window.document, drafts, h.mdbase);
  try {
    window.document.getElementById("browse-button")!.click();
    await until(() => window.document.querySelectorAll("#entry-list button").length === 1 && window.document.getElementById("entries-status")!.textContent === "");
    await h.records.settle(h.records.delete(draft.recordId!));
    await until(() => window.document.querySelectorAll("#entry-list button").length === 0);
    view.dispose(); window.close();
    window = windowForJournal(); view = mountJournal(window.document, new JournalDrafts(storage), h.mdbase);
    window.document.getElementById("browse-button")!.click();
    await until(() => window.document.getElementById("entries-status")!.textContent!.includes("No entries"));
    assert.equal(window.document.querySelectorAll("#entry-list button").length, 0);
    assert.equal(view.currentDraft().body, "");
  } finally {view.dispose(); window.close(); await h.fixture.close();}
});

test("reload reconciles a clean copy deleted while Journal was closed without opening the entry list", async () => {
  const h = await applicationFixture(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  const draft = await savedDraft(h, drafts);
  await h.records.settle(h.records.delete(draft.recordId!));
  const window = windowForJournal(), view = mountJournal(window.document, new JournalDrafts(storage), h.mdbase);
  try {
    await until(() => view.currentDraft().body === "");
    window.document.getElementById("browse-button")!.click();
    await until(() => window.document.getElementById("entries-status")!.textContent!.includes("No entries"));
    assert.equal(window.document.querySelectorAll("#entry-list button").length, 0);
  } finally {view.dispose(); window.close(); await h.fixture.close();}
});

for (const body of ["Unsaved local text", ""]) test(`a deleted record retains and labels its ${body ? "unsaved text" : "unsaved empty edit"} after reload`, async () => {
  const h = await applicationFixture(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  const draft = await savedDraft(h, drafts);
  drafts.patch(draft.id, {body});
  await h.records.settle(h.records.delete(draft.recordId!));
  const create = mock.method(h.records, "create"), update = mock.method(h.records, "update");
  let window = windowForJournal(), view = mountJournal(window.document, drafts, h.mdbase);
  try {
    window.document.getElementById("browse-button")!.click();
    await until(() => !!window.document.querySelector("#entry-list button")?.textContent?.includes("Deleted elsewhere"));
    window.document.querySelector<HTMLButtonElement>("#entry-list button")!.click();
    assert.equal(view.currentDraft().id, draft.id);
    assert.equal(window.document.querySelector<HTMLTextAreaElement>("#page")!.value, body);
    assert.match(window.document.getElementById("status")!.textContent!, /deleted elsewhere.*text.*device/i);
    assert.equal(window.document.getElementById("draft-conflict")!.hidden, false);
    assert.equal(window.document.getElementById("use-saved-version")!.hidden, true);
    window.document.getElementById("copy-conflicting-text")!.click();
    assert.match(window.document.getElementById("status")!.textContent!, /Copy it before starting a new page/);
    assert.equal(drafts.get(draft.id)?.savedBody, "Saved entry");
    view.dispose(); window.close();
    window = windowForJournal(); view = mountJournal(window.document, new JournalDrafts(storage), h.mdbase);
    window.document.getElementById("browse-button")!.click();
    await until(() => !!window.document.querySelector("#entry-list button")?.textContent?.includes("Deleted elsewhere"));
    assert.equal(drafts.get(draft.id)?.body, body);
    const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
    window.document.querySelector<HTMLButtonElement>("#entry-list button")!.click();
    page.value = `${body} More local writing`; page.dispatchEvent(new window.Event("input"));
    await until(() => drafts.get(draft.id)?.body === page.value);
    assert.match(window.document.getElementById("status")!.textContent!, /deleted elsewhere/i);
    assert.equal(create.mock.callCount(), 0); assert.equal(update.mock.callCount(), 0);
  } finally {create.mock.restore(); update.mock.restore(); view.dispose(); window.close(); await h.fixture.close();}
});

test("failed collection reads never classify a cached entry as deleted", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = await savedDraft(h, drafts), data = new JournalData(h.connection, drafts);
  const query = mock.method(h.records, "query", async () => {throw new Error("offline");});
  try {
    await assert.rejects(data.entries(journalEntryTypes(catalog())), /offline/);
    assert.deepEqual(drafts.get(draft.id), draft);
  } finally {query.mock.restore(); data.release(); await h.fixture.close();}
});

test("typing during a deletion read is retained by reconciliation", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = await savedDraft(h, drafts), data = new JournalData(h.connection, drafts);
  await h.records.settle(h.records.delete(draft.recordId!));
  const read = deferred<null>(), requested = deferred<void>();
  const find = mock.method(h.records, "find", () => {requested.resolve(); return read.promise;});
  try {
    const loading = data.entries(journalEntryTypes(catalog()));
    // Also makes the old implementation fail promptly instead of waiting on a read it never makes.
    await Promise.race([requested.promise, loading]);
    drafts.patch(draft.id, {body: "Typed while checking deletion"});
    read.resolve(null); await loading;
    assert.equal(drafts.get(draft.id)?.body, "Typed while checking deletion");
    await assert.rejects(data.open(draft.id), /deleted elsewhere/i);
  } finally {read.resolve(null); find.mock.restore(); data.release(); await h.fixture.close();}
});

test("a read refusal, an incomplete query and a changed Journal type do not imply deletion", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = await savedDraft(h, drafts), data = new JournalData(h.connection, drafts);
  const original = h.records.query.bind(h.records);
  const query = mock.method(h.records, "query", async (...args: Parameters<typeof original>) => ({...await original(...args), records: []}));
  const find = mock.method(h.records, "find", async () => {throw mdbaseError("unavailable", "No current read");});
  try {
    await assert.rejects(data.entries(journalEntryTypes(catalog())), /No current read/);
    assert.deepEqual(drafts.get(draft.id), draft);
    find.mock.restore();
    await data.entries(journalEntryTypes(catalog()));
    assert.deepEqual(drafts.get(draft.id), draft, "an existing record omitted by the Journal query is retained");
    query.mock.restore();
    const incomplete = mock.method(h.records, "query", async (...args: Parameters<typeof original>) => ({...await original(...args), complete: false}));
    try {
      await assert.rejects(data.entries(journalEntryTypes(catalog())), /still loading/);
      assert.deepEqual(drafts.get(draft.id), draft);
    } finally {incomplete.mock.restore();}
  } finally {find.mock.restore(); query.mock.restore(); data.release(); await h.fixture.close();}
});

test("pending and other-collection drafts are not mistaken for deleted saved entries", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), data = new JournalData(h.connection, drafts);
  const pending = drafts.create(h.connection.id);
  drafts.patch(pending.id, {recordId: crypto.randomUUID(), body: "Pending original", path: "pending.md"});
  const foreign = drafts.create("other-collection");
  drafts.patch(foreign.id, {recordId: crypto.randomUUID(), body: "Foreign text", savedBody: "Foreign text", path: "foreign.md"});
  const before = drafts.list(), find = mock.method(h.records, "find");
  try {
    await data.entries(journalEntryTypes(catalog()));
    assert.deepEqual(drafts.list(), before); assert.equal(find.mock.callCount(), 0);
  } finally {find.mock.restore(); data.release(); await h.fixture.close();}
});

test("a live record lease preserves unsent text when its original is deleted", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = await savedDraft(h, drafts), data = new JournalData(h.connection, drafts);
  try {
    await data.open(draft.id);
    await data.setBody(draft.id, "Unsent local text");
    await h.records.settle(h.records.delete(draft.recordId!));
    await until(() => !!drafts.get(draft.id)?.deletedElsewhere);
    assert.equal(drafts.get(draft.id)?.body, "Unsent local text");
    assert.equal(drafts.get(draft.id)?.savedBody, "Saved entry");
    await assert.rejects(data.flush(draft.id), /deleted elsewhere/i);
    await assert.rejects(data.useSavedVersion(draft.id), /deleted elsewhere/i);
  } finally {data.release(); await h.fixture.close();}
});

test("a restored original record can be opened again without replacing retained local text", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = await savedDraft(h, drafts), data = new JournalData(h.connection, drafts);
  const original = await h.records.get(draft.recordId!, {include: {body: true}});
  try {
    await h.records.settle(h.records.delete(draft.recordId!));
    await data.entries(journalEntryTypes(catalog()));
    await assert.rejects(data.open(draft.id), /deleted elsewhere/i);
    drafts.patch(draft.id, {body: "Retained local writing"});
    await h.records.settle(h.records.create({id: original.id, type: "collection-owned-entry", path: original.path, frontmatter: original.frontmatter, body: original.body!}));
    const entries = await data.entries(journalEntryTypes(catalog()));
    assert.equal(entries.length, 1);
    assert.equal(drafts.get(draft.id)?.deletedElsewhere, false);
    assert.equal((await data.resume(entries[0]!)).body, "Retained local writing");
  } finally {data.release(); await h.fixture.close();}
});
