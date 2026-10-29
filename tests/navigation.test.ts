import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.js";
import {JournalData, journalEntryTypes, type JournalEntry} from "../src/journal-data.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
test("date navigation lists every local page, resumes its identity and survives reload", () => {
  const window = new JSDOM(html, {url: "https://journal.fixture/"}).window, document = window.document;
  const drafts = new JournalDrafts(memoryStorage());
  const first = drafts.create(null, new Date(2026, 0, 2, 9)); drafts.patch(first.id, {body: "First January page", finished: true});
  const second = drafts.create(null, new Date(2026, 0, 2, 10)); drafts.patch(second.id, {body: "Second January page"});
  const foreign = drafts.create("other", new Date(2026, 0, 2, 11)); drafts.patch(foreign.id, {body: "Other collection", finished: true});
  // The latest unfinished entry is the active page; other destinations stay separate.
  const view = mountJournal(document, drafts, null), dialog = document.querySelector<HTMLDialogElement>("#entries")!;
  dialog.showModal = () => dialog.setAttribute("open", ""); dialog.close = () => dialog.removeAttribute("open");
  assert.equal(view.currentDraft().id, second.id);
  document.getElementById("browse-button")!.click();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("#entry-list button")];
  assert.equal(buttons.length, 2); assert(!dialog.textContent!.includes("Other collection"));
  buttons.find(button => button.textContent!.includes("First January page"))!.click();
  assert.equal(view.currentDraft().id, first.id); assert.equal(view.currentDraft().body, "First January page");
  view.dispose(); const reloaded = mountJournal(document, drafts, null);
  assert.equal(reloaded.currentDraft().id, first.id);
  document.getElementById("previous-day")!.click();
  assert.equal(dialog.open, false, "day arrows do not open the entry picker");
  assert.equal(reloaded.currentDraft().created.slice(0, 10), "2026-01-01");
  assert.equal(reloaded.currentDraft().body, "");
  document.getElementById("browse-button")!.click();
  const date = document.querySelector<HTMLInputElement>("#entry-date")!; date.value = "2026-01-01";
  date.dispatchEvent(new window.Event("input")); assert.equal(date.value, "2026-01-01");
  assert.equal(document.querySelectorAll("#entry-list button").length, 0);
  document.getElementById("write-date")!.click();
  assert.equal(reloaded.currentDraft().created.slice(0, 10), "2026-01-01");
  assert.equal(drafts.get(first.id)?.body, "First January page");
  reloaded.dispose(); window.close();
});
test("day arrows resume the latest same-collection page and step empty dates without creating records", () => {
  const window = new JSDOM(html, {url: "https://journal.fixture/"}).window, document = window.document;
  const drafts = new JournalDrafts(memoryStorage());
  const old = drafts.create(null, new Date(2025, 11, 31, 8)); drafts.patch(old.id, {body: "Older page", finished: true});
  const earlier = drafts.create(null, new Date(2025, 11, 31, 10)); drafts.patch(earlier.id, {body: "Latest earlier page", finished: true});
  const foreign = drafts.create("other", new Date(2025, 11, 31, 11)); drafts.patch(foreign.id, {body: "Foreign page", finished: true});
  const today = drafts.create(null, new Date(2026, 0, 1, 9)); drafts.patch(today.id, {body: "Current page"});
  const view = mountJournal(document, drafts, null), dialog = document.querySelector<HTMLDialogElement>("#entries")!;
  try {
    document.getElementById("previous-day")!.click(); assert.equal(dialog.open, false);
    assert.equal(view.currentDraft().id, earlier.id); assert.equal(view.currentDraft().body, "Latest earlier page");
    document.getElementById("next-day")!.click(); assert.equal(view.currentDraft().id, today.id);
    assert.equal(view.currentDraft().body, "Current page");
    const count = drafts.list().length;
    document.getElementById("next-day")!.click(); assert.equal(dialog.open, false);
    assert.equal(view.currentDraft().created.slice(0, 10), "2026-01-02"); assert.equal(view.currentDraft().body, "");
    assert.equal(drafts.list().length, count, "empty navigation does not persist a new entry");
    document.getElementById("previous-day")!.click(); assert.equal(view.currentDraft().id, today.id);
    assert.equal(drafts.get(earlier.id)?.body, "Latest earlier page"); assert.equal(drafts.get(foreign.id)?.body, "Foreign page");
  } finally {view.dispose(); window.close();}
});

test("day navigation preserves the current page when local storage refuses its archive", () => {
  const window = new JSDOM(html, {url: "https://journal.fixture/"}).window, storage = memoryStorage(), drafts = new JournalDrafts(storage);
  const initial = drafts.create(null, new Date(2026, 0, 2, 9)); drafts.patch(initial.id, {body: "Keep this writing"});
  const view = mountJournal(window.document, drafts, null), fail = mock.method(storage, "setItem", () => {throw new Error("full");});
  try {
    window.document.getElementById("previous-day")!.click();
    assert.equal(view.currentDraft().id, initial.id); assert.equal(view.currentDraft().body, "Keep this writing");
    assert.equal((window.document.getElementById("page") as HTMLTextAreaElement).value, "Keep this writing");
    assert.match(window.document.getElementById("status")!.textContent!, /cannot preserve/);
  } finally {fail.mock.restore(); view.dispose(); window.close();}
});

test("day arrows load saved pages using their original record identity without another create", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const previous = new Date(); previous.setDate(previous.getDate() - 1); previous.setHours(12, 0, 0, 0);
  const id = "018e0000-0000-7000-8000-000000000001";
  await h.records.save(h.records.create({id, type: "collection-owned-entry", path: "journal/yesterday.md", frontmatter: {created: previous.toISOString()}, body: "Earlier saved page"}));
  const describe = mock.method(h.records, "describe", async () => catalog());
  const window = new JSDOM(html, {url: "https://journal.fixture/"}).window;
  const view = mountJournal(window.document, drafts, h.mdbase), create = mock.method(h.records, "create");
  try {
    window.document.getElementById("previous-day")!.click();
    for (let i = 0; i < 100 && view.currentDraft().recordId !== id; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(view.currentDraft().recordId, id); assert.equal(view.currentDraft().body, "Earlier saved page");
    assert.equal(view.currentDraft().createAttempt, null); assert.equal(create.mock.callCount(), 0);
    assert.equal((window.document.getElementById("entries") as HTMLDialogElement).open, false);
  } finally {create.mock.restore(); describe.mock.restore(); view.dispose(); window.close(); h.close();}
});

test("a late day lookup cannot replace a new page made while it was loading", async () => {
  const h = await applicationFixture(), window = new JSDOM(html, {url: "https://journal.fixture/"}).window;
  const drafts = new JournalDrafts(memoryStorage()), job = deferred<JournalEntry[]>();
  const describe = mock.method(h.records, "describe", async () => catalog());
  const lookup = mock.method(JournalData.prototype, "entries", () => job.promise);
  const view = mountJournal(window.document, drafts, h.mdbase);
  try {
    const page = window.document.getElementById("page") as HTMLTextAreaElement;
    page.value = "Keep original text during lookup"; page.dispatchEvent(new window.Event("input"));
    const original = view.currentDraft().id;
    window.document.getElementById("previous-day")!.click();
    assert.equal((window.document.getElementById("next-day") as HTMLButtonElement).disabled, true);
    view.newPage(); const replacement = view.currentDraft().id;
    assert.notEqual(replacement, original); job.resolve([]);
    for (let i = 0; i < 100 && (window.document.getElementById("previous-day") as HTMLButtonElement).disabled; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(view.currentDraft().id, replacement); assert.equal(page.value, "");
    assert.equal(drafts.get(original)?.body, "Keep original text during lookup");
    assert.equal((window.document.getElementById("previous-day") as HTMLButtonElement).disabled, false);
  } finally {job.resolve([]); lookup.mock.restore(); describe.mock.restore(); view.dispose(); window.close(); h.close();}
});

test("a refused day lookup keeps the original page and re-enables navigation", async () => {
  const h = await applicationFixture(), window = new JSDOM(html, {url: "https://journal.fixture/"}).window;
  const describe = mock.method(h.records, "describe", async () => catalog());
  const lookup = mock.method(JournalData.prototype, "entries", async () => {throw new Error("offline");});
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), h.mdbase);
  try {
    const original = view.currentDraft().id;
    window.document.getElementById("previous-day")!.click();
    for (let i = 0; i < 100 && (window.document.getElementById("previous-day") as HTMLButtonElement).disabled; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(view.currentDraft().id, original);
    assert.match(window.document.getElementById("status")!.textContent!, /current page is unchanged/);
    assert.equal((window.document.getElementById("entries") as HTMLDialogElement).open, false);
    assert.equal((window.document.getElementById("next-day") as HTMLButtonElement).disabled, false);
  } finally {lookup.mock.restore(); describe.mock.restore(); view.dispose(); window.close(); h.close();}
});

test("browsing before the catalog is ready loads saved entries as soon as it arrives", async () => {
  const h = await applicationFixture(), job = deferred<ReturnType<typeof catalog>>();
  await h.records.save(h.records.create({type: "collection-owned-entry", path: "journal/earlier.md", frontmatter: {created: "2025-01-02T09:00:00+00:00"}, body: "Earlier saved entry"}));
  const describe = mock.method(h.records, "describe", () => job.promise);
  const window = new JSDOM(html, {url: "https://journal.fixture/"}).window, document = window.document;
  const dialog = document.querySelector<HTMLDialogElement>("#entries")!;
  dialog.showModal = () => dialog.setAttribute("open", ""); dialog.close = () => dialog.removeAttribute("open");
  const view = mountJournal(document, new JournalDrafts(memoryStorage()), h.mdbase);
  try {
    document.getElementById("browse-button")!.click();
    assert.match(document.getElementById("entries-status")!.textContent!, /Loading entries/);
    job.resolve(catalog());
    for (let i = 0; i < 100 && !document.querySelector("#entry-list button"); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(document.querySelectorAll("#entry-list button").length, 1);
    assert.equal(document.getElementById("entries-status")!.textContent, "");
  } finally {job.resolve(catalog()); describe.mock.restore(); view.dispose(); window.close(); h.close();}
});

test("saved entries use the bound type and original record, without another create", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), data = new JournalData(h.connection, drafts);
  const type = journalEntryTypes(catalog("written", "my-entry"))[0]!;
  try {
    const saved = await h.records.save(h.records.create({type: type.name, path: "journal/old.md", frontmatter: {written: "2025-01-02T09:00:00+00:00"}, body: "Earlier saved entry"}));
    assert.equal(saved.outcome, "confirmed");
    const entries = await data.entries([type]); assert.equal(entries.length, 1);
    const spy = mock.method(h.records, "create");
    try {
      const draft = await data.resume(entries[0]!);
      assert.equal(draft.recordId, entries[0]!.id); assert.equal(draft.createAttempt, null);
      assert.equal(draft.body, "Earlier saved entry");
      await data.open(draft.id);
      data.setBody(draft.id, "Earlier saved entry edited"); await data.flush(draft.id);
      assert.equal((await h.records.get(draft.recordId!, {body: true})).body, "Earlier saved entry edited");
      assert.equal(spy.mock.callCount(), 0);
      assert.equal((await data.resume(entries[0]!)).id, draft.id);
    } finally {spy.mock.restore();}
  } finally {data.release(); h.close();}
});
test("existing entries save without choosing a type in a collection with several implementations", async () => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const first = catalog(), other = catalog("written", "another-entry");
  const describe = mock.method(f.records, "describe", async () => ({...first, types: [...first.types, ...other.types],
    contracts: [{...first.contracts[0]!, implementedBy: [first.types[0]!.name, other.types[0]!.name]}]}));
  const date = new Date(); date.setDate(date.getDate() - 1);
  const created = await f.records.save(f.records.create({type: first.types[0]!.name, path: "journal/existing.md", frontmatter: {created: date.toISOString()}, body: "Existing page"}));
  assert.equal(created.outcome, "confirmed");
  const window = new JSDOM(html, {url: "https://journal.fixture/"}).window;
  const {memoryLocks} = await import("./support.js");
  Object.defineProperty(window.navigator, "locks", {value: memoryLocks()});
  const view = mountJournal(window.document, drafts, f.mdbase), create = mock.method(f.records, "create");
  const until = async (ready: () => boolean) => {for (let i = 0; i < 200 && !ready(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert(ready());};
  let lease: Awaited<ReturnType<typeof f.records.records.open>> | null = null;
  try {
    window.document.getElementById("previous-day")!.click();
    await until(() => window.document.getElementById("status")!.textContent === "Saved");
    const page = window.document.getElementById("page") as HTMLTextAreaElement;
    assert.equal(page.value, "Existing page");
    assert.equal((window.document.getElementById("entry-type") as HTMLSelectElement).value, "");
    lease = await f.records.records.open(view.currentDraft().recordId!, {autosave: {idleMs: 1200}});
    page.value = "Existing page edited"; page.dispatchEvent(new window.Event("input"));
    await until(() => lease!.session.getSnapshot().body === page.value);
    assert.equal((await lease.session.flush()).ok, true);
    await until(() => window.document.getElementById("status")!.textContent === "Saved");
    assert.equal(create.mock.callCount(), 0);
    assert.equal((await f.records.get(view.currentDraft().recordId!, {body: true})).body, page.value);
  } finally {lease?.release(); create.mock.restore(); view.dispose(); describe.mock.restore(); window.close(); await f.fixture.close();}
});
