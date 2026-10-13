import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {DraftConflictError, DraftPersistenceError, JournalDrafts, type DraftLock} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {memoryStorage} from "./support.js";
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
test("rapid queued input retains every character without a false self-conflict", async () => {
  const drafts = new JournalDrafts(memoryStorage(), undefined, serialLock()), h = host();
  const view = await drafts.mutate(() => mountJournal(h.window.document, drafts, null));
  try {
    h.write("a"); h.write("ab"); h.write("abc"); await tick();
    assert.equal(h.page.value, "abc"); assert.equal(drafts.get(view.currentDraft().id)?.body, "abc");
    assert.equal(h.window.document.getElementById("draft-conflict")!.hidden, true);
  } finally {view.dispose(); h.window.close();}
});
