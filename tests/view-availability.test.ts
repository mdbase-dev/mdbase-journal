import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock, test} from "node:test";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.js";
import {journalConnection} from "../src/application.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
test("advisory list unavailability cannot retire the original ready lease, clear writing or change its identity", async () => {
  const f = await applicationFixture(), job = deferred<ReturnType<typeof catalog>>(), describe = mock.method(f.records, "describe", () => job.promise);
  const h = new JSDOM(html, {runScripts: "outside-only"}), drafts = new JournalDrafts(memoryStorage());
  const originalLease = journalConnection(f.mdbase), view = mountJournal(h.window.document, drafts, f.mdbase);
  try {
    const page = h.window.document.getElementById("page") as HTMLTextAreaElement;
    page.value = "uipolish: keep original writing"; page.dispatchEvent(new h.window.Event("input")); const original = view.currentDraft();
    const entry = {...f.ready.collections[0]!, availability: {state: "unavailable" as const, reason: "device_offline" as const}};
    f.fixture.controls.publishSnapshot({...f.ready, collections: [entry]});
    assert.equal(journalConnection(f.mdbase), originalLease); assert.equal(view.currentDraft().id, original.id); assert.equal(page.value, original.body);
    assert.equal(drafts.get(original.id)?.targetCollectionId, original.targetCollectionId);
    view.newPage(); view.undoNewPage(); assert.equal(page.value, original.body); assert.equal(view.currentDraft().id, original.id);
  } finally {view.dispose(); describe.mock.restore(); job.resolve(catalog()); h.window.close(); f.close();}
});
