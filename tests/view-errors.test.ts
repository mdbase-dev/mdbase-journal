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
void test("storage eviction warning uses SDK copy only while pending risk is reported", async () => {
  const f = await applicationFixture(), window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const job = deferred<ReturnType<typeof catalog>>();
  const describe = mock.method(f.records, "describe", () => job.promise);
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.mdbase);
  try {
    const copy = describeError("storage_may_be_evicted")!;
    assert(!window.document.getElementById("status")!.textContent!.includes(copy.message));
    f.fixture.controls.publishSnapshot({...f.ready, saveWarning: "storage_may_be_evicted"});
    assert(window.document.getElementById("status")!.textContent!.includes(copy.message));
    assert.equal((window.document.getElementById("page") as HTMLTextAreaElement).disabled, false);
    f.fixture.controls.publishSnapshot({...f.ready, saveWarning: null});
    assert(!window.document.getElementById("status")!.textContent!.includes(copy.message));
  } finally {view.dispose(); describe.mock.restore(); job.resolve(catalog()); window.close(); f.close();}
});
for (const code of ["browser_unsupported", "application_storage_unavailable"]) void test(`unavailable ${code} displays SDK copy while keeping local writing`, async () => {
  const f = await applicationFixture(), window = new JSDOM(html, {runScripts: "outside-only"}).window;
  f.fixture.controls.publishSnapshot({...f.ready, status: "blocked", problem: code, selectedCollectionId: null});
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.mdbase);
  try {
    const copy = describeError(code)!;
    const visible = window.document.getElementById("status")!.textContent!;
    assert(visible.includes(copy.title)); assert(visible.includes(copy.message));
    assert.equal((window.document.getElementById("page") as HTMLTextAreaElement).disabled, false);
  } finally {view.dispose(); window.close(); f.close();}
});
void test("registration diagnostics stay developer-only instead of appearing on the writing surface", async () => {
  const f = await applicationFixture(), window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const state = {...f.ready, status: "blocked" as const, problem: "application_registration_refused", problemDetail: {
    name: "MdbaseError", code: "application_registration_refused", registration: {code: "invalid_manifest", paths: ["/homepage", "/icon"]}}};
  f.fixture.controls.publishSnapshot(state);
  const copy = describeError(state)!; assert(copy.developerMessage); assert(copy.developerMessage.includes("/homepage"));
  const view = mountJournal(window.document, new JournalDrafts(memoryStorage()), f.mdbase);
  try {
    const visible = window.document.getElementById("status")!.textContent!;
    assert(visible.startsWith(copy.title)); assert(!visible.includes(copy.developerMessage));
    assert(!visible.includes("/homepage")); assert(!visible.includes("invalid_manifest"));
  } finally {view.dispose(); window.close(); f.close();}
});
for (const problem of ["collection_migrating", "update_required", "account_suspended"]) void test(`live ${problem} uses SDK copy without fencing local writing`, async () => {
  const f = await applicationFixture(), job = deferred<ReturnType<typeof catalog>>();
  const describe = mock.method(f.records, "describe", () => job.promise);
  const window = new JSDOM(html, {runScripts: "outside-only"}).window;
  const drafts = new JournalDrafts(memoryStorage());
  const originalLease = journalConnection(f.mdbase)!;
  assert.equal(originalLease.records, f.records); assert.equal(originalLease.files, f.records.files);
  const view = mountJournal(window.document, drafts, f.mdbase);
  try {
    f.fixture.controls.publishSnapshot({...f.ready, problem});
    assert.equal(journalConnection(f.mdbase), originalLease, "server refusal preserves the exact original public lease");
    const status = window.document.getElementById("status")!.textContent!;
    assert.equal(status, summarizeStatus(f.records.status, problem).text); assert(!status.includes(problem));
    const page = window.document.getElementById("page") as HTMLTextAreaElement;
    page.value = "uipolish: retained during upgrade"; page.dispatchEvent(new window.Event("input"));
    const original = view.currentDraft(); view.newPage(); view.undoNewPage();
    assert.equal(view.currentDraft().id, original.id); assert.equal(page.value, original.body);
    assert.equal(drafts.get(original.id)?.body, original.body);
    f.fixture.controls.publishSnapshot(f.ready);
    assert.notEqual(window.document.getElementById("status")!.textContent, status, "an accepted reply clears the live problem");
  } finally {view.dispose(); describe.mock.restore(); job.resolve(catalog()); window.close(); f.close();}
});
