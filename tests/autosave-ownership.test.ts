import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {connect, type Mdbase} from "@mdbase-dev/sdk";
import {JournalDrafts, type DraftLock} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {JournalData} from "../src/journal-data.js";
import {applicationFixture, catalog, deferred, memoryLocks, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 5));}
  assert(check(), "fixture barrier did not arrive");
}
async function tabs() {
  const f = await applicationFixture();
  const peer = await connect({connector: f.replica.connector(), app: {name: "peer-journal-tab", version: "test"}, reconnect: false});
  const locks = memoryLocks(), storage = memoryStorage();
  let tail = Promise.resolve();
  const lock: DraftLock = operation => {const next = tail.then(operation); tail = next.then(() => {}, () => {}); return next;};
  const describeA = mock.method(f.records, "describe", async () => catalog());
  const describeB = mock.method(peer, "describe", async () => catalog());
  const peerRequests: string[] = [], peerLeases = new Map<string, Awaited<ReturnType<JournalData["open"]>>>();
  const originalOpen = JournalData.prototype.open;
  const open = mock.method(JournalData.prototype, "open", async function(this: JournalData, ...args: Parameters<typeof originalOpen>) {
    if (this.connection.records === peer) peerRequests.push(args[0]);
    const lease = await originalOpen.apply(this, args);
    if (this.connection.records === peer) peerLeases.set(args[0], lease);
    return lease;
  });
  const peerConnection = {...f.connection, records: peer, files: peer.files};
  const state = f.mdbase.getSnapshot();
  assert.equal(state.phase.kind, "ready");
  const peerSnapshot = state.phase.kind === "ready" ? {...state, phase: {...state.phase, connection: peerConnection}} : state;
  const peerApp: Mdbase = {...f.mdbase, getSnapshot: () => peerSnapshot};
  async function tab(mdbase: Mdbase) {
    const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
    Object.defineProperty(window.navigator, "locks", {value: locks});
    const drafts = new JournalDrafts(storage, undefined, lock), page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
    const view = await drafts.mutate(() => mountJournal(window.document, drafts, mdbase));
    return {window, drafts, page, view, write(body: string) {page.value = body; page.dispatchEvent(new window.Event("input", {bubbles: true}));},
      storage(id: string) {window.dispatchEvent(new window.StorageEvent("storage", {key: `journal.native.note.${id}`}));},
      close() {view.dispose(); window.close();}};
  }
  const a = await tab(f.mdbase);
  const statusListeners: (() => void)[] = [];
  // Control B's Journal status callback. SDK session status
  // subscriptions retain the real client's behavior.
  const originalStatus = peer.onStatus.bind(peer);
  const onStatus = mock.method(peer, "onStatus", (listener: () => void) => {
    if (statusListeners.length) return originalStatus(listener);
    statusListeners.push(listener); return () => {};
  });
  const idle = await tab(peerApp);
  return {f, peer, a, b: idle, tab, peerApp, peerRequests, peerLeases, status() {for (const listener of [...statusListeners]) listener();},
    async close() {a.close(); idle.close(); describeA.mock.restore(); describeB.mock.restore(); onStatus.mock.restore(); open.mock.restore(); peer.close(); await f.fixture.close();}};
}
const seed = "[test]", prefix = "[test] agent-20261", full = "[test] agent-20261029 full text with the remaining words.";
test("idle status sweep never autosaves a peer prefix; owner saves the complete text", async () => {
  const t = await tabs(), {a, b, f, peer} = t;
  const createA = mock.method(f.records, "create"), updateA = mock.method(f.records, "update");
  const createB = mock.method(peer, "create"), updateB = mock.method(peer, "update");
  let lease: Awaited<ReturnType<typeof f.records.records.open>> | null = null;
  try {
    const blank = b.view.currentDraft().id;
    a.write(seed); await until(() => a.window.document.getElementById("status")!.textContent === "Saved");
    const id = a.view.currentDraft().id, recordId = a.drafts.get(id)!.recordId!;
    lease = await f.records.records.open(recordId, {autosave: {idleMs: 1200}});
    a.write(prefix); await until(() => lease!.session.getSnapshot().body === prefix);
    t.status(); await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(t.peerRequests.length, 0, "idle tab cannot acquire an autosaving SDK session");
    a.write(full); await until(() => lease!.session.getSnapshot().body === full);
    // A passive clean peer session flushes first, modeling the RCA's timer
    // ordering. Journal must not have seeded it with the unfinished prefix.
    const passive = await peer.records.open(recordId, {autosave: {idleMs: 1200}});
    try {assert.equal((await passive.session.flush()).ok, true);} finally {passive.release();}
    assert.equal((await lease.session.flush()).ok, true);
    await until(() => a.window.document.getElementById("status")!.textContent === "Saved");
    assert.equal((await f.records.get(recordId, {body: true})).body, full);
    assert.equal(a.page.value, full); assert.equal(a.drafts.get(id)?.body, full);
    assert.equal(a.window.document.getElementById("draft-conflict")!.hidden, true);
    assert.equal(b.view.currentDraft().id, blank); assert.equal(b.page.value, "");
    assert.equal(createA.mock.callCount(), 1); assert.equal(updateA.mock.callCount(), 1);
    assert.equal(createB.mock.callCount(), 0); assert.equal(updateB.mock.callCount(), 0);
  } finally {lease?.release(); await t.close();}
});
test("closing the owner hands its latest unfinished draft to an idle tab", async () => {
  const t = await tabs(), {a, b, f, peer} = t;
  const updateB = mock.method(peer, "update"), createB = mock.method(peer, "create");
  let lease: Awaited<ReturnType<typeof peer.records.open>> | null = null;
  try {
    a.write(seed); await until(() => a.window.document.getElementById("status")!.textContent === "Saved");
    const id = a.view.currentDraft().id, recordId = a.drafts.get(id)!.recordId!;
    a.write(prefix); await until(() => a.drafts.get(id)?.body === prefix);
    t.status(); await new Promise<void>(resolve => setImmediate(resolve));
    a.write(full); await until(() => a.drafts.get(id)?.body === full);
    a.close();
    await until(() => t.peerLeases.has(id));
    lease = t.peerLeases.get(id)!;
    assert.equal(lease.session.getSnapshot().body, full);
    assert.equal((await lease.session.flush()).ok, true);
    await until(() => b.drafts.get(id)?.savedBody === full);
    assert.equal(updateB.mock.callCount(), 1);
    assert.equal((await f.records.get(recordId, {body: true})).body, full);
    assert.equal(b.drafts.get(id)?.body, full); assert.equal(b.drafts.get(id)?.savedBody, full);
    assert.equal(createB.mock.callCount(), 0, "takeover retains the original create identity");
    assert.equal(b.page.value, "", "background recovery leaves the idle page alone");
  } finally {lease?.release(); await t.close();}
});
test("startup restoration follows peer text without creating another writer", async () => {
  const t = await tabs(), {a, f, peer} = t;
  let restored: Awaited<ReturnType<typeof t.tab>> | null = null;
  const updateB = mock.method(peer, "update");
  let lease: Awaited<ReturnType<typeof f.records.records.open>> | null = null;
  try {
    a.write(seed); await until(() => a.window.document.getElementById("status")!.textContent === "Saved");
    const id = a.view.currentDraft().id, recordId = a.drafts.get(id)!.recordId!;
    lease = await f.records.records.open(recordId, {autosave: {idleMs: 1200}});
    a.write(prefix); await until(() => lease!.session.getSnapshot().body === prefix);
    restored = await t.tab(t.peerApp);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(restored.page.value, prefix); assert.equal(t.peerRequests.length, 0);
    a.write(full); await until(() => lease!.session.getSnapshot().body === full);
    restored.storage(id);
    assert.equal(restored.page.value, full); assert.equal(t.peerRequests.length, 0);
    assert.equal(updateB.mock.callCount(), 0);
    assert.equal((await lease.session.flush()).ok, true);
  } finally {lease?.release(); restored?.close(); await t.close();}
});
test("the owner follows peer edits to its previous page without a second session", async () => {
  const t = await tabs(), {a, f, peer} = t;
  let follower: Awaited<ReturnType<typeof t.tab>> | null = null;
  let lease: Awaited<ReturnType<typeof f.records.records.open>> | null = null;
  const updateB = mock.method(peer, "update");
  try {
    a.write(seed); await until(() => a.window.document.getElementById("status")!.textContent === "Saved");
    const id = a.view.currentDraft().id, recordId = a.drafts.get(id)!.recordId!;
    lease = await f.records.records.open(recordId, {autosave: {idleMs: 1200}});
    follower = await t.tab(t.peerApp);
    await new Promise<void>(resolve => setImmediate(resolve));
    a.view.newPage();
    await until(() => a.view.currentDraft().id !== id);
    follower.write(full); await until(() => follower!.drafts.get(id)?.body === full);
    a.storage(id);
    await until(() => lease!.session.getSnapshot().body === full);
    assert.equal((await lease.session.flush()).ok, true);
    assert.equal((await f.records.get(recordId, {body: true})).body, full);
    assert.equal(updateB.mock.callCount(), 0);
    assert.equal(a.page.value, "");
  } finally {lease?.release(); follower?.close(); await t.close();}
});
test("typing before the catalog arrives keeps previous pages eligible to save", async () => {
  const f = await applicationFixture(), storage = memoryStorage(), drafts = new JournalDrafts(storage);
  const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  const ready = deferred<ReturnType<typeof catalog>>();
  const describe = mock.method(f.records, "describe", () => ready.promise);
  const view = mountJournal(window.document, drafts, f.mdbase);
  const write = (body: string) => {page.value = body; page.dispatchEvent(new window.Event("input"));};
  try {
    write("Earlier unfinished page"); await until(() => !!drafts.get(view.currentDraft().id));
    const first = view.currentDraft().id;
    view.newPage(); write("Current page");
    const second = view.currentDraft().id;
    ready.resolve(catalog());
    await until(() => drafts.get(first)?.savedBody === "Earlier unfinished page" && drafts.get(second)?.savedBody === "Current page");
    assert.notEqual(first, second);
  } finally {ready.resolve(catalog()); view.dispose(); describe.mock.restore(); window.close(); await f.fixture.close();}
});
test("an independent editor still conflicts and local text is discarded only by explicit choice", async () => {
  const t = await tabs(), {a, f, peer} = t;
  let active: Awaited<ReturnType<typeof f.records.records.open>> | null = null;
  let editor: Awaited<ReturnType<typeof peer.records.open>> | null = null;
  try {
    a.write(seed); await until(() => a.window.document.getElementById("status")!.textContent === "Saved");
    const id = a.view.currentDraft().id, recordId = a.drafts.get(id)!.recordId!;
    active = await f.records.records.open(recordId, {autosave: {idleMs: 1200}});
    editor = await peer.records.open(recordId, {autosave: false});
    a.write(full); await until(() => active!.session.getSnapshot().body === full);
    editor.session.setBody("Independent edit");
    assert.equal((await editor.session.flush()).ok, true);
    await until(() => active!.session.getSnapshot().state === "conflict");
    assert.equal(a.page.value, full); assert.equal(a.drafts.get(id)?.body, full);
    assert.equal(a.window.document.getElementById("draft-conflict")!.hidden, false);
    assert.equal(a.window.document.getElementById("status")!.textContent, "Your text is on this device. Resolve its original save before continuing.");
    a.window.document.getElementById("copy-conflicting-text")!.click();
    assert.equal(a.page.selectionStart, 0); assert.equal(a.page.selectionEnd, full.length);
    assert.equal(a.drafts.get(id)?.body, full);
    a.window.document.getElementById("use-saved-version")!.click();
    await until(() => a.page.value === "Independent edit");
    assert.equal(a.drafts.get(id)?.body, "Independent edit");
    assert.equal((await f.records.get(recordId, {body: true})).body, "Independent edit");
  } finally {active?.release(); editor?.release(); await t.close();}
});
