import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {if (check()) return; await new Promise(resolve => setTimeout(resolve, 10));}
  throw new Error("Timed out");
}
function dom() {
  const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  return {window, write(body: string) {page.value = body; page.dispatchEvent(new window.Event("input", {bubbles: true}));}};
}
void test("Retry appears only for an unknown save outcome and settles the original write", {timeout: 15_000}, async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  const describe = mock.method(f.records, "describe", async () => catalog());
  const original = f.records.awaitReceipt.bind(f.records), update = mock.method(f.records, "update");
  const view = mountJournal(h.window.document, drafts, f.mdbase);
  const status = h.window.document.getElementById("status")!, retry = h.window.document.getElementById("retry-button") as HTMLButtonElement;
  try {
    h.write("First"); await until(() => status.textContent === "Saved");
    assert.equal(retry.hidden, true);
    const receipt = mock.method(f.records, "awaitReceipt", async () => {throw new Error("connection lost before the outcome");});
    h.write("First, revised"); await until(() => !retry.hidden);
    assert.equal(retry.textContent, "Retry saving"); assert.equal(update.mock.callCount(), 1);
    receipt.mock.mockImplementation(original); retry.click();
    assert.equal(retry.disabled, true);
    await until(() => status.textContent === "Saved" && retry.hidden);
    assert.equal(update.mock.callCount(), 1, "Retry settles the original write without resubmitting it");
    assert.equal((await f.records.get(drafts.get(view.currentDraft().id)!.recordId!, {body: true})).body, "First, revised");
    receipt.mock.restore();
  } finally {view.dispose(); describe.mock.restore(); update.mock.restore(); h.window.close(); f.close();}
});
void test("a write kept on this device while offline does not offer Retry", {timeout: 15_000}, async () => {
  const f = await applicationFixture({confirmed: false}), h = dom(), drafts = new JournalDrafts(memoryStorage());
  const describe = mock.method(f.records, "describe", async () => catalog());
  const view = mountJournal(h.window.document, drafts, f.mdbase);
  const status = h.window.document.getElementById("status")!, retry = h.window.document.getElementById("retry-button") as HTMLButtonElement;
  try {
    h.write("Written offline"); await until(() => !!drafts.get(view.currentDraft().id)?.recordId);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(drafts.get(view.currentDraft().id)?.savedBody, null, "still waiting for sync");
    assert.equal(retry.hidden, true); assert.equal(h.window.document.body.classList.contains("retry"), false);
    assert.equal(status.textContent, "Saved on this device; waiting for sync");
    f.replica.setOnline(true); f.replica.confirmAll();
    await until(() => status.textContent === "Saved"); assert.equal(retry.hidden, true);
  } finally {view.dispose(); describe.mock.restore(); h.window.close(); f.close();}
});
