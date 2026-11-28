import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {JournalDrafts, type DraftLock} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {JournalData, journalEntryTypes} from "../src/journal-data.js";
import {applicationFixture, catalog, memoryLocks, memoryStorage} from "./support.js";
for (const offline of [false, true]) test(`a delayed storage echo cannot replace newer persisted text or send its prefix to the SDK (${offline ? "offline" : "online"})`, async () => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage(), undefined, serialLock());
  const draft = await drafts.mutate(() => drafts.put({...drafts.blank(f.connection.id), body: "Seed", path: "echo.md"}));
  const data = new JournalData(f.connection, drafts);
  try {
    const lease = await data.open(draft.id, journalEntryTypes(catalog())[0]!);
    const source = lease.session.getSnapshot();
    if (offline) f.replica.setOnline(false);
    await drafts.mutate(() => drafts.patch(draft.id, {body: "Seed\n[test] ha"}));
    const newer = drafts.mutate(() => drafts.patch(draft.id, {body: "Seed\n[test] has all its text"}));
    const echo = data.setBody(draft.id, "Seed\n[test] ha", {body: source.body, revision: source.record.revision});
    await Promise.all([newer, echo]);
    assert.equal(drafts.get(draft.id)?.body, "Seed\n[test] has all its text");
    assert.equal(lease.session.getSnapshot().body, "Seed", "an obsolete echo must never become a native intent");
    await data.setBody(draft.id, drafts.get(draft.id)!.body, {body: source.body, revision: source.record.revision});
    if (offline) {
      const held = await lease.session.flush({timeoutMs: 1000});
      assert.equal(held.ok, true);
      assert.equal(lease.session.getSnapshot().state, "saved_on_device");
      assert.equal(lease.session.getSnapshot().body, "Seed\n[test] has all its text");
      f.replica.setOnline(true); f.replica.confirmAll();
    }
    await data.flush(draft.id);
    assert.equal((await f.records.get(drafts.get(draft.id)!.recordId!, {include: {body: true}})).body, "Seed\n[test] has all its text");
  } finally {data.release(); f.close();}
});
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
function serialLock(): DraftLock {
  let tail = Promise.resolve();
  return operation => {const next = tail.then(() => new Promise<ReturnType<typeof operation>>((resolve, reject) => setTimeout(() => {try {resolve(operation());} catch (error) {reject(error);}}, 1))); tail = next.then(() => {}, () => {}); return next;};
}
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
  throw new Error("Timed out waiting for Journal");
}
test("fast offline input through the origin lock keeps its complete text after reconnect", {timeout: 20_000}, async () => {
  const f = await applicationFixture(), window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const drafts = new JournalDrafts(memoryStorage(), undefined, serialLock());
  const view = await drafts.mutate(() => mountJournal(window.document, drafts, f.mdbase));
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  const status = window.document.getElementById("status")!;
  function input(value: string) {page.value = value; page.dispatchEvent(new window.Event("input", {bubbles: true}));}
  try {
    input("Seed"); await until(() => status.textContent === "Saved");
    f.replica.setOnline(false);
    const extra = "\n[test] offline rapid writing stays whole";
    for (const char of extra) {input(page.value + char); await new Promise(resolve => setTimeout(resolve, 0));}
    const expected = "Seed" + extra;
    assert.equal(page.value, expected);
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.equal(page.value, expected);
    assert.equal(drafts.get(view.currentDraft().id)?.body, expected);
    assert.equal(window.document.getElementById("draft-conflict")!.hidden, true);
    f.replica.setOnline(true); f.replica.confirmAll();
    await until(() => status.textContent === "Saved");
    assert.equal((await f.records.get(drafts.get(view.currentDraft().id)!.recordId!, {include: {body: true}})).body, expected);
  } finally {view.dispose(); window.close(); f.close();}
});

test("two days edited without a connection reopen and save to their original records, including a cleared entry", async () => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const {window} = new JSDOM(html, {url: "https://journal.fixture/"});
  const {document} = window, page = document.querySelector<HTMLTextAreaElement>("#page")!;
  const dialog = document.querySelector<HTMLDialogElement>("#entries")!;
  dialog.showModal = () => dialog.setAttribute("open", "");
  dialog.close = () => dialog.removeAttribute("open");
  const data = new JournalData(f.connection, drafts);
  async function original(day: number, body: string) {
    const draft = drafts.put({...drafts.blank(f.connection.id, new Date(2026, 0, day, 12)), path: `journal/day-${day}.md`, body});
    await data.open(draft.id, journalEntryTypes(catalog())[0]);
    return drafts.get(draft.id)!;
  }
  async function write(body: string) {
    page.value = body;
    page.dispatchEvent(new window.Event("input", {bubbles: true}));
    await Promise.resolve();
  }
  function select(id: string) {
    document.getElementById("browse-button")!.click();
    const row = document.querySelector<HTMLButtonElement>(`#entry-list button[data-entry-id="${id}"]`);
    assert(row); row.click();
    assert.equal(dialog.open, false);
  }
  let view;
  try {
    const first = await original(1, "First saved body"), second = await original(2, "Second saved body");
    data.release();
    f.replica.setOnline(false);
    view = mountJournal(document, drafts, null);
    select(first.id); await write("Local first body");
    select(second.id); await write("");
    select(first.id); assert.equal(page.value, "Local first body");
    select(second.id); assert.equal(page.value, "");
    assert.equal(document.getElementById("pending-count")!.textContent?.startsWith("2 notes"), true);
    view.dispose();
    view = mountJournal(document, drafts, null);
    assert.equal(view.currentDraft().id, second.id);
    assert.equal(page.value, "");
    assert.equal(document.getElementById("draft-conflict")!.hidden, true);
    view.dispose();
    f.replica.setOnline(true);
    // The browser's Web Locks allow replay for a background draft as well.
    Object.defineProperty(window.navigator, "locks", {value: memoryLocks()});
    view = mountJournal(document, drafts, f.mdbase);
    await until(() => drafts.get(second.id)?.savedBody === "" && drafts.get(first.id)?.savedBody === "Local first body");
    for (const [draft, expected] of [[first, "Local first body"], [second, ""]] as const) {
      assert.equal(drafts.get(draft.id)?.reviewRequired, undefined);
      assert.equal((await f.records.get(draft.recordId!, {include: {body: true}})).body, expected);
    }
    assert.equal(document.getElementById("draft-conflict")!.hidden, true);
  } finally {view?.dispose(); data.release(); window.close(); f.close();}
});
