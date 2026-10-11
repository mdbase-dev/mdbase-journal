import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {JournalDrafts} from "../src/drafts.js";
import {DraftOpens} from "../src/draft-opens.js";
import {JournalData, journalEntryTypes} from "../src/journal-data.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";
const type = journalEntryTypes(catalog())[0]!;
const settle = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
function draft(drafts: JournalDrafts, collection: string, body: string) {
  const value = drafts.create(collection); return drafts.patch(value.id, {body, path: body + ".md"});
}
test("one indefinitely pending confirmation cannot prevent a later original SDK save", {timeout: 10_000}, async () => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const first = draft(drafts, f.connection.id, "First"), later = draft(drafts, f.connection.id, "Later");
  const hold = deferred<void>(), original = f.records.create.bind(f.records);
  const create = mock.method(f.records, "create", async (...args: Parameters<typeof original>) => {
    const write = await original(...args); return args[0].body === "First" ? {...write, confirmed: hold.promise.then(() => write.confirmed)} : write;
  });
  const data = new JournalData(f.connection, drafts), queue = new DraftOpens(data, drafts, () => f.connection.isCurrent(), () => {});
  try {
    queue.request(first.id, type); queue.request(later.id, type); await data.open(later.id, type); await settle();
    assert.equal(drafts.get(first.id)?.savedBody, null); assert.equal(queue.state(first.id)?.state, "opening");
    assert.equal(drafts.get(later.id)?.savedBody, "Later"); assert.equal(queue.state(later.id), null);
    assert.equal(create.mock.callCount(), 2); assert.equal((await f.records.get(drafts.get(later.id)!.recordId!, {body: true})).body, "Later");
  } finally {queue.dispose(); data.release(); hold.resolve(); await settle(); create.mock.restore(); f.close();}
});
test("unknown first capture retries only its original receipt with exponential backoff and no mutation replay", async context => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), value = draft(drafts, f.connection.id, "Unknown");
  context.mock.timers.enable({apis: ["setTimeout"]});
  const create = mock.method(f.records, "create", async () => {throw new Error("unknown original outcome");});
  const receipt = mock.method(f.records, "receipt", async () => {throw new Error("original receipt still unavailable");});
  const data = new JournalData(f.connection, drafts), queue = new DraftOpens(data, drafts, () => f.connection.isCurrent(), () => {});
  try {
    queue.request(value.id, type); await settle(); const attempt = drafts.get(value.id)!.createAttempt;
    assert(attempt); assert.equal(queue.state(value.id)?.retryAfterMs, 1000);
    queue.request(value.id, type); context.mock.timers.tick(999); await settle(); assert.equal(receipt.mock.callCount(), 0);
    context.mock.timers.tick(1); await settle(); assert.equal(receipt.mock.callCount(), 1); assert.equal(queue.state(value.id)?.retryAfterMs, 2000);
    assert.equal(receipt.mock.calls[0]!.arguments[0], attempt.mutationId);
    context.mock.timers.tick(2000); await settle(); assert.equal(receipt.mock.callCount(), 2); assert.equal(queue.state(value.id)?.retryAfterMs, 4000);
    assert.equal(create.mock.callCount(), 1); assert.deepEqual(drafts.get(value.id)!.createAttempt, attempt); assert.equal(drafts.get(value.id)!.path, "Unknown.md");
    queue.dispose(); context.mock.timers.tick(100_000); await settle(); assert.equal(receipt.mock.callCount(), 2);
  } finally {queue.dispose(); data.release(); create.mock.restore(); receipt.mock.restore(); f.close(); context.mock.timers.reset();}
});
test("failed acquisition state belongs to its draft, not its successful neighbor", {timeout: 10_000}, async () => {
  const f = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const first = draft(drafts, f.connection.id, "First"), later = draft(drafts, f.connection.id, "Later"), original = f.records.create.bind(f.records);
  const create = mock.method(f.records, "create", async (...args: Parameters<typeof original>) => {if (args[0].body === "First") throw new Error("unknown original outcome"); return original(...args);});
  const data = new JournalData(f.connection, drafts), queue = new DraftOpens(data, drafts, () => f.connection.isCurrent(), () => {});
  try {
    queue.request(first.id, type); queue.request(later.id, type); await data.open(later.id, type); await settle();
    assert.equal(queue.state(first.id)?.state, "retrying"); assert.equal(queue.state(later.id), null); assert.equal(drafts.get(later.id)!.savedBody, "Later");
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
