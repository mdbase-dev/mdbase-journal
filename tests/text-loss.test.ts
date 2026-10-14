import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {JournalDrafts, type DraftLock} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {JournalData, journalEntryTypes} from "../src/journal-data.js";
import {applicationFixture, catalog, memoryStorage} from "./support.js";
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
    assert.equal((await f.records.get(drafts.get(draft.id)!.recordId!, {body: true})).body, "Seed\n[test] has all its text");
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
  const describe = mock.method(f.records, "describe", async () => catalog());
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
    assert.equal((await f.records.get(drafts.get(view.currentDraft().id)!.recordId!, {body: true})).body, expected);
  } finally {view.dispose(); describe.mock.restore(); window.close(); f.close();}
});
