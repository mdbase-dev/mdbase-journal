import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.js";
import {JournalData, journalEntryTypes} from "../src/journal-data.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, memoryStorage} from "./support.js";
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
  const date = document.querySelector<HTMLInputElement>("#entry-date")!; assert.equal(date.value, "2026-01-01");
  assert.equal(document.querySelectorAll("#entry-list button").length, 0);
  document.getElementById("write-date")!.click();
  assert.equal(reloaded.currentDraft().created.slice(0, 10), "2026-01-01");
  assert.equal(drafts.get(first.id)?.body, "First January page");
  reloaded.dispose(); window.close();
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
      data.setBody(draft.id, "Earlier saved entry edited"); await data.flush(draft.id);
      assert.equal((await h.records.get(draft.recordId!, {body: true})).body, "Earlier saved entry edited");
      assert.equal(spy.mock.callCount(), 0);
      assert.equal((await data.resume(entries[0]!)).id, draft.id);
    } finally {spy.mock.restore();}
  } finally {data.release(); h.close();}
});
