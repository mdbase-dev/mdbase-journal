import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {JournalDrafts} from "../src/drafts.js";
import {DraftOpens} from "../src/draft-opens.js";
import {JournalData, journalEntryTypes} from "../src/journal-data.js";
import {applicationFixture, catalog, memoryStorage} from "./support.js";
const type = journalEntryTypes(catalog())[0]!;
const settle = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
function draft(drafts: JournalDrafts, collection: string, body: string) {
  const value = drafts.create(collection); return drafts.patch(value.id, {body, path: body + ".md"});
}
test("unconfirmed creates open their records kept on this device; neither waits for the log", {timeout: 10_000}, async () => {
  const f = await applicationFixture({confirmed: false}), drafts = new JournalDrafts(memoryStorage());
  const first = draft(drafts, f.connection.id, "First"), later = draft(drafts, f.connection.id, "Later");
  const data = new JournalData(f.connection, drafts), queue = new DraftOpens(data, drafts, () => f.connection.isCurrent(), () => {});
  try {
    queue.request(first.id, type); queue.request(later.id, type);
    await Promise.all([data.open(first.id, type), data.open(later.id, type)]); await settle();
    for (const value of [first, later]) {
      assert.equal(queue.state(value.id), null); assert.equal(data.snapshot(value.id)?.state, "saved_on_device");
      assert.equal(drafts.get(value.id)?.savedBody, null);
    }
    assert.equal(f.records.ledger.getSnapshot().pending.length, 2);
  } finally {queue.dispose(); data.release(); f.close();}
});
test("failed acquisition state belongs to its draft, not its successful neighbor", {timeout: 10_000}, async () => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const first = draft(drafts, f.connection.id, "First"), later = draft(drafts, f.connection.id, "Later"), original = f.records.create.bind(f.records);
  const create = mock.method(f.records, "create", async (...args: Parameters<typeof original>) => {if (args[0].body === "First") throw new Error("unknown original outcome"); return original(...args);});
  const data = new JournalData(f.connection, drafts), queue = new DraftOpens(data, drafts, () => f.connection.isCurrent(), () => {});
  try {
    queue.request(first.id, type); queue.request(later.id, type); await data.open(later.id, type); await settle();
    assert.equal(queue.state(first.id)?.state, "unresolved"); assert.equal(queue.state(later.id), null); assert.equal(drafts.get(later.id)!.savedBody, "Later");
  } finally {queue.dispose(); data.release(); create.mock.restore(); f.close();}
});
test("imported prototype text cannot submit a create or become a captured native intent", async () => {
  const f = await applicationFixture(), storage = memoryStorage(); storage.setItem("journal.note.old", JSON.stringify({body: "Earlier writing", path: "old.md", targetCollectionId: f.connection.id}));
  const drafts = new JournalDrafts(storage); drafts.importLegacy(); const value = drafts.list()[0]!;
  const create = mock.method(f.records, "create"), receipt = mock.method(f.records, "receipt"), data = new JournalData(f.connection, drafts);
  const queue = new DraftOpens(data, drafts, () => true, () => {});
  try {
    queue.request(value.id, type); await settle(); assert.equal(queue.state(value.id), null);
    await assert.rejects(data.open(value.id, type), /earlier note needs its original save reviewed/);
    assert.equal(create.mock.callCount(), 0); assert.equal(receipt.mock.callCount(), 0); assert.equal(drafts.get(value.id)!.createAttempt, null);
  } finally {queue.dispose(); data.release(); create.mock.restore(); receipt.mock.restore(); f.close();}
});
test("retired scope cannot start another queued acquisition", async () => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), value = draft(drafts, f.connection.id, "Retained");
  const create = mock.method(f.records, "create"), data = new JournalData(f.connection, drafts), queue = new DraftOpens(data, drafts, () => f.connection.isCurrent(), () => {});
  try {f.retire(); queue.request(value.id, type); await settle(); assert.equal(create.mock.callCount(), 0); assert.equal(drafts.get(value.id)!.createAttempt, null);}
  finally {queue.dispose(); data.release(); create.mock.restore(); f.close();}
});
