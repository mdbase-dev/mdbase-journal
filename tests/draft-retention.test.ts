import assert from "node:assert/strict";
import {test} from "node:test";
import {DraftPersistenceError, JournalDrafts, notePath} from "../src/drafts.js";
import {memoryStorage} from "./support.js";
function confirmed(drafts: JournalDrafts) {
  const draft = drafts.blank("original", new Date(Date.now() - 24 * 60 * 60 * 1000));
  const attempt = {mutationId: crypto.randomUUID(), recordId: crypto.randomUUID(), body: "Confirmed", typeName: "entry", createdField: "created", path: "saved.md", created: draft.created, account: "a", installation: "i"};
  return drafts.put({...draft, body: attempt.body, savedBody: attempt.body, path: attempt.path, createAttempt: attempt, recordId: attempt.recordId, finished: true});
}
test("pending legacy writing imports once with original text/date/path/destination, without native identities", () => {
  const storage = memoryStorage(), id = crypto.randomUUID();
  const old = JSON.stringify({id, body: "Uncertain original writing", savedBody: "Older version", created: "2025-04-08T09:10:11+01:00", createdMs: Date.parse("2025-04-08T09:10:11+01:00"), targetCollectionId: "original", path: "original.md", createdIn: "original", revision: "old-revision"});
  storage.setItem("journal.note." + id, old);
  const drafts = new JournalDrafts(storage); drafts.importLegacy(); new JournalDrafts(storage).importLegacy();
  const imported = drafts.list(); assert.equal(imported.length, 1); assert.equal(imported[0]!.id, id);
  assert.equal(imported[0]!.body, "Uncertain original writing"); assert.equal(imported[0]!.created, "2025-04-08T09:10:11+01:00");
  assert.equal(imported[0]!.path, "original.md"); assert.equal(imported[0]!.targetCollectionId, "original");
  assert.equal(imported[0]!.recordId, null); assert.equal(imported[0]!.createAttempt, null); assert.equal(imported[0]!.savedBody, null);
  assert.equal(imported[0]!.legacyKey, "journal.note." + id); assert.equal(drafts.legacyPendingCount(), 0);
  assert.equal(storage.getItem("journal.note." + id), old);
});
test("saved, empty and malformed prototype entries are not turned into write intents", () => {
  const storage = memoryStorage(); storage.setItem("journal.note.bad", "not json");
  storage.setItem("journal.note.saved", JSON.stringify({body: "Saved", savedBody: "Saved"}));
  storage.setItem("journal.note.blank", JSON.stringify({body: ""}));
  const drafts = new JournalDrafts(storage); drafts.importLegacy(); assert.deepEqual(drafts.list(), []); assert.equal(storage.length, 3);
});
test("failed import preserves original bytes and can retry import without duplication", () => {
  const storage = memoryStorage(), old = JSON.stringify({body: "Private earlier text", createdIn: "old"});
  storage.setItem("journal.note.earlier", old); const set = storage.setItem;
  storage.setItem = () => {throw new Error("quota");}; const drafts = new JournalDrafts(storage);
  assert.throws(() => drafts.importLegacy(), DraftPersistenceError); assert.equal(storage.getItem("journal.note.earlier"), old);
  storage.setItem = set; drafts.importLegacy(); drafts.importLegacy(); assert.equal(drafts.list().length, 1);
});
test("retention evicts only an old finished confirmed copy, never unsaved writing", () => {
  const storage = memoryStorage(), drafts = new JournalDrafts(storage, {maxBytes: 100_000, maxDrafts: 2});
  const saved = confirmed(drafts), waiting = drafts.put({...drafts.blank("original"), body: "Unresolved"});
  const next = drafts.put({...drafts.blank("original"), body: "Next page"});
  assert.equal(drafts.get(saved.id), null); assert.equal(drafts.get(waiting.id)?.body, "Unresolved"); assert.equal(drafts.get(next.id)?.body, "Next page");
});
test("pinned borrowed sessions cannot be evicted; each pin releases once", () => {
  const drafts = new JournalDrafts(memoryStorage(), {maxBytes: 100_000, maxDrafts: 1}), saved = confirmed(drafts);
  const first = drafts.pin(saved.id), second = drafts.pin(saved.id), next = {...drafts.blank(null), body: "New"};
  assert.throws(() => drafts.put(next), DraftPersistenceError); first(); first();
  assert.throws(() => drafts.put(next), DraftPersistenceError); second(); drafts.put(next);
  assert.equal(drafts.get(saved.id), null);
});
test("a recovery identity, unfinished copy or unsaved text is never pruned to make room", () => {
  for (const kind of ["recovery", "unfinished", "unsaved"] as const) {
    const drafts = new JournalDrafts(memoryStorage(), {maxBytes: 100_000, maxDrafts: 1}), saved = confirmed(drafts);
    if (kind === "recovery") drafts.patch(saved.id, {recovery: {mutationId: crypto.randomUUID(), recordId: saved.recordId!, baseRevision: null}});
    if (kind === "unfinished") drafts.patch(saved.id, {finished: false});
    if (kind === "unsaved") drafts.patch(saved.id, {body: "New local writing"});
    assert.throws(() => drafts.put({...drafts.blank(null), body: "Next"}), DraftPersistenceError);
    assert(drafts.get(saved.id));
  }
});
test("UTF-16 storage budget rejects growth before overwriting original text or foreign storage", () => {
  const storage = memoryStorage(), drafts = new JournalDrafts(storage, {maxBytes: 2500, maxDrafts: 10});
  storage.setItem("another-app", "untouched");
  const draft = drafts.put({...drafts.blank(null), body: "Original"}), before = storage.getItem("journal.native.note." + draft.id);
  assert.throws(() => drafts.patch(draft.id, {body: "日".repeat(2000)}), DraftPersistenceError);
  assert.equal(storage.getItem("journal.native.note." + draft.id), before); assert.equal(storage.getItem("another-app"), "untouched");
});
test("legacy entry-type and collection preferences survive theme/folder edits as hints only", () => {
  const storage = memoryStorage(); storage.setItem("journal.collection", JSON.stringify("remembered"));
  storage.setItem("journal.prefs.v1", JSON.stringify({theme: "dark", folder: "writing", entryTypes: {remembered: "custom-entry"}}));
  const drafts = new JournalDrafts(storage), preferences = drafts.preferences();
  assert.deepEqual(preferences.entryTypes, {remembered: "custom-entry"}); assert.equal(preferences.collectionId, "remembered");
  drafts.savePreferences({...preferences, folder: "other", theme: "light"});
  assert.equal(drafts.preferences().entryTypes?.remembered, "custom-entry"); assert.equal(drafts.preferences().collectionId, "remembered");
  assert.equal(storage.getItem("journal.collection"), JSON.stringify("remembered"));
});
test("malformed legacy collection hint does not reset valid preferences", () => {
  const storage = memoryStorage(); storage.setItem("journal.collection", "invalid json");
  storage.setItem("journal.prefs.v1", JSON.stringify({theme: "dark", folder: "writing"}));
  assert.deepEqual(new JournalDrafts(storage).preferences(), {theme: "dark", folder: "writing"});
});
test("an oversized legacy copy does not prevent importing a later small entry", () => {
  const storage = memoryStorage();
  const large = JSON.stringify({body: "日".repeat(2000)}), small = JSON.stringify({body: "Later private text", createdMs: 1744099811234, touchedMs: 1744099823456});
  storage.setItem("journal.note.large", large); storage.setItem("journal.note.small", small);
  const drafts = new JournalDrafts(storage, {maxBytes: 6000, maxDrafts: 10});
  assert.throws(() => drafts.importLegacy(), DraftPersistenceError);
  const imported = drafts.list(); assert.equal(imported.length, 1); assert.equal(imported[0]!.body, "Later private text");
  assert.equal(imported[0]!.createdMs, 1744099811234); assert.equal(imported[0]!.touchedMs, 1744099823456);
  assert.equal(storage.getItem("journal.note.large"), large); assert.equal(storage.getItem("journal.note.small"), small);
});
test("two pages in the same second allocate distinct initial paths, never retry sibling paths", () => {
  const drafts = new JournalDrafts(memoryStorage()), date = new Date(), a = drafts.blank(null, date), b = drafts.blank(null, date);
  assert.notEqual(notePath(date, "journal", a.id), notePath(date, "journal", b.id));
});
