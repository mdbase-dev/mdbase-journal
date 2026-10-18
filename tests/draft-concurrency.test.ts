import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {DraftConflictError, DraftPersistenceError, JournalDrafts, type DraftLock} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function serialLock(): DraftLock {
  let tail = Promise.resolve();
  return operation => {const next = tail.then(operation); tail = next.then(() => {}, () => {}); return next;};
}
function host() {
  const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  return {window, page, write(body: string) {page.value = body; page.dispatchEvent(new window.Event("input", {bubbles: true}));}};
}
test("two simultaneous writers cannot borrow a fresh stored revision or overwrite metadata", async () => {
  const storage = memoryStorage(), lock = serialLock();
  const a = new JournalDrafts(storage, undefined, lock), b = new JournalDrafts(storage, undefined, lock);
  const seed = await a.mutate(() => a.put({...a.blank(null), body: "Seed"}));
  const first = a.get(seed.id)!, stale = b.get(seed.id)!;
  await a.mutate(() => a.patch(seed.id, {finished: true}));
  const outcomes = await Promise.allSettled([
    a.mutate(() => a.updateBody(first, "Seed\nA", "original.md")),
    b.mutate(() => b.updateBody(stale, "Seed\nB", "original.md"))
  ]);
  assert.equal(outcomes[0]!.status, "fulfilled");
  assert.equal(outcomes[1]!.status, "rejected");
  if (outcomes[1]!.status === "rejected") assert(outcomes[1]!.reason instanceof DraftConflictError);
  assert.equal(a.get(seed.id)?.body, "Seed\nA");
  assert.equal(a.get(seed.id)?.finished, true, "text updates retain newer metadata");
  assert.throws(() => b.put({...stale, body: "Unsafe"}), DraftPersistenceError, "browser writes require the shared lock");
});
test("clean tab reconciles storage events before typing and keeps both additions", async () => {
  const storage = memoryStorage(), a = new JournalDrafts(storage), b = new JournalDrafts(storage);
  const seed = a.put({...a.blank(null), body: "Seed"});
  const ha = host(), hb = host();
  const va = mountJournal(ha.window.document, a, null), vb = mountJournal(hb.window.document, b, null);
  try {
    ha.write("Seed\nA"); await tick();
    hb.page.setSelectionRange(hb.page.value.length, hb.page.value.length);
    hb.window.dispatchEvent(new hb.window.StorageEvent("storage", {key: `journal.native.note.${seed.id}`}));
    assert.equal(hb.page.value, "Seed\nA"); assert.equal(hb.page.selectionStart, hb.page.value.length);
    hb.write(hb.page.value + "\nB"); await tick();
    assert.equal(a.get(seed.id)?.body, "Seed\nA\nB");
    assert.equal(hb.window.document.getElementById("draft-conflict")!.hidden, true);
  } finally {va.dispose(); vb.dispose(); ha.window.close(); hb.window.close();}
});
test("both changed: saved text survives, conflicting text stays visible, copy/use-saved are explicit", async () => {
  const storage = memoryStorage(), lock = serialLock();
  const a = new JournalDrafts(storage, undefined, lock), b = new JournalDrafts(storage, undefined, lock);
  const seed = await a.mutate(() => a.put({...a.blank(null), body: "Seed"}));
  const ha = host(), hb = host();
  const va = await a.mutate(() => mountJournal(ha.window.document, a, null));
  const vb = await b.mutate(() => mountJournal(hb.window.document, b, null));
  try {
    ha.write("Seed\nA"); hb.write("Seed\nB"); await tick();
    assert.equal(a.get(seed.id)?.body, "Seed\nA"); assert.equal(hb.page.value, "Seed\nB");
    assert.equal(hb.window.document.getElementById("draft-conflict")!.hidden, false);
    assert.match(hb.window.document.getElementById("status")!.textContent!, /changed in another tab/);
    hb.window.dispatchEvent(new hb.window.StorageEvent("storage", {key: `journal.native.note.${seed.id}`}));
    assert.equal(hb.page.value, "Seed\nB", "an event never clears conflicting local writing");
    const closing = new hb.window.Event("beforeunload", {cancelable: true}); hb.window.dispatchEvent(closing);
    assert.equal(closing.defaultPrevented, true);
    hb.window.document.getElementById("copy-conflicting-text")!.click();
    assert.equal(hb.page.selectionStart, 0); assert.equal(hb.page.selectionEnd, hb.page.value.length);
    hb.window.document.getElementById("use-saved-version")!.click(); await tick();
    assert.equal(hb.page.value, "Seed\nA"); assert.equal(a.get(seed.id)?.body, "Seed\nA");
    assert.equal(hb.window.document.getElementById("draft-conflict")!.hidden, true);
    const resolved = new hb.window.Event("beforeunload", {cancelable: true}); hb.window.dispatchEvent(resolved);
    assert.equal(resolved.defaultPrevented, false);
  } finally {va.dispose(); vb.dispose(); ha.window.close(); hb.window.close();}
});
test("a single-tab save echo arriving ahead of queued input is not an outside edit", async () => {
  const f = await applicationFixture(), h = host(), gate = deferred<void>();
  let tail = Promise.resolve(), pause: Promise<void> | null = null;
  const lock: DraftLock = operation => {const barrier = pause, next = tail.then(async () => {if (barrier) await barrier; return operation();}); tail = next.then(() => {}, () => {}); return next;};
  const drafts = new JournalDrafts(memoryStorage(), undefined, lock);
  const describe = mock.method(f.records, "describe", async () => catalog());
  const view = await drafts.mutate(() => mountJournal(h.window.document, drafts, f.mdbase));
  let lease: Awaited<ReturnType<typeof f.records.records.open>> | null = null;
  const until = async (ready: () => boolean) => {for (let i = 0; i < 100 && !ready(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert(ready());};
  try {
    h.write("Seed"); await until(() => h.window.document.getElementById("status")!.textContent === "Saved");
    const id = view.currentDraft().id, recordId = drafts.get(id)!.recordId!;
    lease = await f.records.records.open(recordId, {autosave: {idleMs: 1200}});
    h.write("Seed and my edit"); await until(() => lease!.session.getSnapshot().body === "Seed and my edit");
    pause = gate.promise; h.write("Seed and my edit plus more");
    assert.equal((await lease.session.flush()).ok, true);
    pause = null; gate.resolve(); await tail; await tick();
    assert.equal(h.window.document.getElementById("draft-conflict")!.hidden, true);
    assert.equal(drafts.get(id)?.reviewRequired, undefined);
    assert.equal(h.page.value, "Seed and my edit plus more");
    assert.equal(lease.session.getSnapshot().body, h.page.value);
    assert.equal((await lease.session.flush()).ok, true);
    h.window.document.getElementById("previous-day")!.click();
    await until(() => view.currentDraft().id !== id);
    h.window.document.getElementById("next-day")!.click();
    await until(() => view.currentDraft().id === id);
    assert.equal(h.page.value, "Seed and my edit plus more");
    assert.equal(h.window.document.getElementById("draft-conflict")!.hidden, true);
    assert.equal((await f.records.get(recordId, {body: true})).body, h.page.value);
  } finally {pause = null; gate.resolve(); await tail; lease?.release(); view.dispose(); describe.mock.restore(); h.window.close(); f.close();}
});
test("rapid queued input retains every character without a false self-conflict", async () => {
  const drafts = new JournalDrafts(memoryStorage(), undefined, serialLock()), h = host();
  const view = await drafts.mutate(() => mountJournal(h.window.document, drafts, null));
  try {
    h.write("a"); h.write("ab"); h.write("abc"); await tick();
    assert.equal(h.page.value, "abc"); assert.equal(drafts.get(view.currentDraft().id)?.body, "abc");
    assert.equal(h.window.document.getElementById("draft-conflict")!.hidden, true);
  } finally {view.dispose(); h.window.close();}
});
