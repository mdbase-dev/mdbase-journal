import assert from "node:assert/strict";
import {test} from "node:test";
import {JournalDrafts, DraftPersistenceError, notePath} from "../src/drafts.js";
import {memoryStorage} from "./support.js";
test("blank pages have independent durable identities and fixed local time", () => {
  const storage = memoryStorage(), drafts = new JournalDrafts(storage), date = new Date(2025, 3, 8, 9, 10, 11);
  const a = drafts.create(null, date), b = drafts.create(null, date);
  assert.notEqual(a.id, b.id); assert.equal(a.body, ""); assert.equal(a.recordId, null); assert.equal(a.createdMs, date.getTime());
  assert.equal(new JournalDrafts(storage).get(a.id)?.created, a.created);
  assert.equal(notePath(date, "/writing/"), "writing/2025/04/2025-04-08 09.10.md");
});
test("draft patches retain original destination and original creation capture", () => {
  const drafts = new JournalDrafts(memoryStorage()), draft = drafts.create("original");
  const capture = {mutationId: crypto.randomUUID(), recordId: crypto.randomUUID(), body: "First", typeName: "owned", createdField: "date", path: "original.md", created: draft.created, account: "a", installation: "i"};
  drafts.patch(draft.id, {body: "Newer", path: capture.path, createAttempt: capture});
  const value = drafts.patch(draft.id, {finished: true});
  assert.equal(value.targetCollectionId, "original"); assert.deepEqual(value.createAttempt, capture); assert.equal(value.body, "Newer");
});
test("failed or silently dropped storage writes refuse native capture", () => {
  const storage = memoryStorage(); storage.setItem = () => {};
  assert.throws(() => new JournalDrafts(storage).create(null), DraftPersistenceError);
});
test("legacy prototype drafts remain byte-identical and visible as retained pending text", () => {
  const storage = memoryStorage(), old = JSON.stringify({id: "legacy", body: "Private writing", savedBody: null, targetCollectionId: "old"});
  storage.setItem("journal.note.legacy", old);
  const drafts = new JournalDrafts(storage); drafts.create(null);
  assert.equal(drafts.legacyPendingCount(), 1); assert.equal(storage.getItem("journal.note.legacy"), old);
});
test("malformed native drafts never become write intents", () => {
  const storage = memoryStorage(); storage.setItem("journal.native.note.bad", JSON.stringify({id: "bad", body: "Text"}));
  const drafts = new JournalDrafts(storage); assert.equal(drafts.get("bad"), null); assert.deepEqual(drafts.list(), []);
});
test("theme and folder preferences are independent of selection/registration", () => {
  const storage = memoryStorage(), drafts = new JournalDrafts(storage);
  drafts.savePreferences({theme: "dark", folder: "writing"});
  assert.deepEqual(new JournalDrafts(storage).preferences(), {theme: "dark", folder: "writing"});
  assert.throws(() => notePath(new Date(), "../other"), /within this collection/);
  assert.equal(storage.getItem("journal.collection"), null);
});
