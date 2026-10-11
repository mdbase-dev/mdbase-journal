import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock, test} from "node:test";
import {JSDOM} from "jsdom";
import {describeError, summarizeStatus} from "@mdbase-dev/sdk";
import {JournalDrafts} from "../src/drafts.js";
import {journalConnection} from "../src/application.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
for (const reason of ["refused", "expired"]) void test(`SDK ${reason} sign-in uses exact copy and an enabled approval gesture`, async () => {
  const f = await applicationFixture();
  const state = {...f.ready, status: "blocked" as const, problem: reason, selectedCollectionId: null,
    selection: {...f.ready.selection, state: "none" as const, usable: null, requested: {...f.ready.selection.requested, collectionId: null}}};
  f.fixture.controls.publishSnapshot(state);
  const copy = describeError(state); assert(copy?.actionLabel);
  const window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.fixture.entry);
  try {
    const explanation = window.document.getElementById("menu-connection")!.textContent!;
    assert(explanation.includes(copy.title)); assert(explanation.includes(copy.message));
    const signIn = window.document.querySelector<HTMLButtonElement>("#connect-from-menu")!;
    assert.equal(signIn.textContent, copy.actionLabel); assert.equal(signIn.disabled, false);
    signIn.click();
    assert.equal(f.fixture.controls.observedActions().filter(call => call.action === "approve").length, 1);
    assert.equal(f.fixture.controls.observedActions().some(call => call.action === "authorize"), false);
  } finally {view.dispose(); window.close(); f.close();}
});
void test("authorizing still offers an enabled explicit SDK approval gesture", async () => {
  const f = await applicationFixture();
  f.fixture.controls.publishSnapshot({...f.ready, status: "authorizing", selectedCollectionId: null,
    selection: {...f.ready.selection, state: "none", usable: null, requested: {...f.ready.selection.requested, collectionId: null}}});
  const window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.fixture.entry);
  try {
    const signIn = window.document.querySelector<HTMLButtonElement>("#connect-from-menu")!;
    assert.equal(signIn.textContent, "Sign in"); assert.equal(signIn.disabled, false);
    signIn.click();
    assert.equal(f.fixture.controls.observedActions().filter(call => call.action === "approve").length, 1);
  } finally {view.dispose(); window.close(); f.close();}
});
void test("only SDK-validated HTTPS update links are offered, and stale links are removed", async () => {
  const f = await applicationFixture(), window = new JSDOM(html, {runScripts: "outside-only"}).window;
  f.fixture.controls.publishSnapshot({...f.ready, status: "blocked"});
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.fixture.entry);
  try {
    const link = window.document.getElementById("update-app") as HTMLAnchorElement;
    for (const url of ["https://mdbase.dev/downloads", "https://fixture.example/update", "http://fixture.example/update", "javascript:alert(1)"]) {
      const state = {...f.ready, status: "blocked" as const, problem: "update_required", problemDetail: {
        name: "AppCpAuthorityError", code: "collection_unavailable", server: {status: 409, code: "collection_unavailable", reason: "moved_to_next_runtime", retryAfterMs: null, updateUrl: url}}};
      f.fixture.controls.publishSnapshot(state);
      const copy = describeError(state)!;
      assert.equal(link.hidden, false); assert.equal(link.href, copy.updateUrl);
      assert.equal(new URL(link.href).protocol, "https:");
      assert.equal(new URL(link.href).hostname, "mdbase.dev");
      if (url.startsWith("https://mdbase.dev/")) assert.equal(link.href, url);
      else assert.notEqual(link.href, url, "untrusted URLs never bypass the SDK's safe downloads fallback");
      assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener noreferrer");
    }
    f.fixture.controls.publishSnapshot(f.ready);
    assert.equal(link.hidden, true); assert.equal(link.hasAttribute("href"), false);
  } finally {view.dispose(); window.close(); f.close();}
});
void test("registration diagnostics stay developer-only instead of appearing on the writing surface", async () => {
  const f = await applicationFixture(), window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const state = {...f.ready, status: "blocked" as const, problem: "application_registration_refused", problemDetail: {
    name: "MdbaseError", code: "application_registration_refused", registration: {code: "invalid_manifest", paths: ["/homepage", "/icon"]}}};
  f.fixture.controls.publishSnapshot(state);
  const copy = describeError(state)!; assert(copy.developerMessage); assert(copy.developerMessage.includes("/homepage"));
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.fixture.entry);
  try {
    const visible = window.document.getElementById("menu-connection")!.textContent!;
    assert(visible.includes(copy.title)); assert(visible.includes(copy.message));
    assert(!visible.includes(copy.developerMessage)); assert(!visible.includes("/homepage")); assert(!visible.includes("invalid_manifest"));
    assert.equal(window.document.getElementById("status")!.textContent, copy.title);
  } finally {view.dispose(); window.close(); f.close();}
});
for (const problem of ["collection_migrating", "update_required", "account_suspended"]) void test(`live ${problem} uses SDK copy without fencing local writing`, async () => {
  const f = await applicationFixture(), job = deferred<ReturnType<typeof catalog>>();
  const describe = mock.method(f.records, "describe", () => job.promise);
  const window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const drafts = new JournalDrafts(memoryStorage());
  const originalLease = journalConnection(f.fixture.entry)!;
  assert.equal(originalLease.records, f.records); assert.equal(originalLease.files, f.records.files);
  const view = mountJournal(window.document, drafts, f.fixture.entry);
  try {
    const state = {...f.ready, problem}; f.fixture.controls.publishSnapshot(state);
    assert.equal(journalConnection(f.fixture.entry), originalLease, "server refusal preserves the exact original public lease");
    const copy = describeError(state)!;
    assert.equal(window.document.getElementById("status")!.textContent, summarizeStatus(f.records.status, problem).text);
    const explanation = window.document.getElementById("menu-connection")!.textContent!;
    assert(explanation.includes(copy.title)); assert(explanation.includes(copy.message));
    if (copy.actionLabel) assert(explanation.includes(copy.actionLabel));
    assert(!explanation.includes(problem));
    const page = window.document.getElementById("page") as HTMLTextAreaElement;
    page.value = "uipolish: retained during upgrade"; page.dispatchEvent(new window.Event("input"));
    const original = view.currentDraft(); view.newPage(); view.undoNewPage();
    assert.equal(view.currentDraft().id, original.id); assert.equal(page.value, original.body);
    assert.equal(drafts.get(original.id)?.body, original.body);
    f.fixture.controls.publishSnapshot(f.ready);
    assert(!window.document.getElementById("menu-connection")!.textContent!.includes(copy.title), "accepted reply clears live problem copy");
  } finally {view.dispose(); describe.mock.restore(); job.resolve(catalog()); window.close(); f.close();}
});
for (const problem of ["application_native_profile_unavailable", "update_required"]) void test(`requested collection stays visible with ${problem} and an action`, async () => {
  const f = await applicationFixture(), window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const other = {collectionId: "other", displayName: "Other collection", role: "owner" as const};
  f.fixture.controls.publishSnapshot({...f.ready, status: "blocked", problem, collections: [...f.ready.collections, other],
    selection: {...f.ready.selection, state: "blocked", usable: null, problem: null}});
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.fixture.entry);
  try {
    const choice = window.document.getElementById("collection-choice") as HTMLSelectElement;
    const copy = describeError(problem)!;
    assert.equal(choice.options.length, 3); assert.equal(choice.value, f.connection.id);
    assert([...choice.options].find(item => item.value === f.connection.id)!.textContent!.includes(copy.title));
    assert.equal([...choice.options].find(item => item.value === "other")!.textContent, other.displayName);
    assert(window.document.getElementById("menu-connection")!.textContent!.includes(copy.actionLabel!));
    assert(!window.document.getElementById("menu-connection")!.textContent!.includes(problem));
    assert.equal(journalConnection(f.fixture.entry), null);
    choice.value = "other"; choice.dispatchEvent(new window.Event("change"));
    assert(f.fixture.controls.observedActions().some(item => item.action === "select" && item.collectionId === "other"));
  } finally {view.dispose(); window.close(); f.close();}
});
