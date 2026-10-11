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
test("legacy ID collision cannot overwrite even malformed original native bytes", () => {
  const storage = memoryStorage(), id = crypto.randomUUID(), native = "{unreadable original native writing";
  storage.setItem("journal.native.note." + id, native);
  const old = JSON.stringify({id, body: "Earlier prototype text", createdIn: "original"});
  storage.setItem("journal.note." + id, old);
  const drafts = new JournalDrafts(storage); drafts.importLegacy(); drafts.importLegacy();
  const imported = drafts.list(); assert.equal(imported.length, 1); assert.notEqual(imported[0]!.id, id);
  assert.equal(imported[0]!.body, "Earlier prototype text"); assert.equal(imported[0]!.createAttempt, null);
  assert.equal(storage.getItem("journal.native.note." + id), native); assert.equal(storage.getItem("journal.note." + id), old);
});
test("out-of-range legacy timestamps preserve text with a valid local fallback date", () => {
  const storage = memoryStorage(), old = JSON.stringify({body: "Original text", createdMs: Number.MAX_VALUE});
  storage.setItem("journal.note.old-date", old);
  const drafts = new JournalDrafts(storage); drafts.importLegacy();
  assert.equal(drafts.list()[0]?.body, "Original text"); assert(Number.isFinite(Date.parse(drafts.list()[0]!.created)));
  assert(Number.isFinite(new Date(drafts.list()[0]!.createdMs).getTime()));
  assert.equal(storage.getItem("journal.note.old-date"), old);
});
test("a malformed prototype entry cannot hide later pending writing from the count", () => {
  const storage = memoryStorage(); storage.setItem("journal.note.bad", "not json");
  storage.setItem("journal.note.later", JSON.stringify({body: "Later original writing"}));
  const drafts = new JournalDrafts(storage); assert.equal(drafts.legacyPendingCount(), 1);
  drafts.importLegacy(); assert.equal(drafts.legacyPendingCount(), 0); assert.equal(drafts.list().length, 1);
  assert.equal(storage.getItem("journal.note.bad"), "not json");
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
test("partial-quota legacy import keeps its first copy stable across repeated recovery visits", () => {
  const storage = memoryStorage(), first = JSON.stringify({body: "First original", createdIn: "first-destination"}), second = JSON.stringify({body: "Second original", createdIn: "second-destination"});
  storage.setItem("journal.note.first", first); storage.setItem("journal.note.second", second);
  const set = storage.setItem; let writes = 0;
  storage.setItem = (key, value) => {if (++writes === 2) throw new Error("quota after first copy"); set(key, value);};
  const drafts = new JournalDrafts(storage); assert.throws(() => drafts.importLegacy(), DraftPersistenceError);
  const original = drafts.list()[0]!; assert.equal(original.body, "First original"); assert.equal(drafts.legacyPendingCount(), 1);
  storage.setItem = set;
  for (let i = 0; i < 20; i++) new JournalDrafts(storage).importLegacy();
  assert.equal(drafts.list().length, 2); assert.equal(drafts.get(original.id)?.body, original.body);
  assert.equal(drafts.get(original.id)?.targetCollectionId, "first-destination"); assert.equal(drafts.legacyPendingCount(), 0);
  assert.equal(storage.getItem("journal.note.first"), first); assert.equal(storage.getItem("journal.note.second"), second);
  for (const copy of drafts.list()) {assert.equal(copy.createAttempt, null); assert.equal(copy.recordId, null); assert.equal(copy.recovery, null);}
});
test("retention evicts only an old finished confirmed copy, never unsaved writing", () => {
  const storage = memoryStorage(), drafts = new JournalDrafts(storage, {maxBytes: 100_000, maxDrafts: 2});
  const saved = confirmed(drafts), waiting = drafts.put({...drafts.blank("original"), body: "Unresolved"});
  const next = drafts.put({...drafts.blank("original"), body: "Next page"});
  assert.equal(drafts.get(saved.id), null); assert.equal(drafts.get(waiting.id)?.body, "Unresolved"); assert.equal(drafts.get(next.id)?.body, "Next page");
});
test("new-visit pruning reclaims old confirmed copies below the cap, once only", () => {
  const storage = memoryStorage(), drafts = new JournalDrafts(storage), saved = confirmed(drafts);
  const waiting = drafts.put({...drafts.blank(null), body: "Unresolved local writing"});
  storage.setItem("another-app", "untouched");
  assert.equal(drafts.pruneConfirmed(), 1); assert.equal(drafts.pruneConfirmed(), 0);
  assert.equal(drafts.get(saved.id), null); assert.equal(drafts.get(waiting.id)?.body, waiting.body);
  assert.equal(storage.getItem("another-app"), "untouched");
});
test("proactive pruning protects recent, unfinished, recovery and live-pinned copies", () => {
  for (const kind of ["recent", "unfinished", "recovery", "pinned"] as const) {
    const drafts = new JournalDrafts(memoryStorage()), saved = confirmed(drafts);
    if (kind === "recent") drafts.patch(saved.id, {touchedMs: Date.now()});
    if (kind === "unfinished") drafts.patch(saved.id, {finished: false});
    if (kind === "recovery") drafts.patch(saved.id, {recovery: {mutationId: crypto.randomUUID(), recordId: saved.recordId!, baseRevision: null}});
    if (kind === "pinned") drafts.pin(saved.id);
    assert.equal(drafts.pruneConfirmed(), 0); assert(drafts.get(saved.id));
  }
});
test("actual default 256-draft and 3 MiB bounds refuse growth without losing writing", () => {
  const drafts = new JournalDrafts(memoryStorage());
  for (let i = 0; i < 256; i++) drafts.put({...drafts.blank(null), body: `Unresolved ${i}`});
  const original = drafts.list()[0]!;
  assert.throws(() => drafts.put({...drafts.blank(null), body: "Next"}), DraftPersistenceError);
  assert.equal(drafts.list().length, 256); assert.equal(drafts.get(original.id)?.body, original.body);
  const bytes = new JournalDrafts(memoryStorage()), before = bytes.put({...bytes.blank(null), body: "Original"});
  assert.throws(() => bytes.patch(before.id, {body: "日".repeat(1600 * 1024)}), DraftPersistenceError);
  assert.equal(bytes.get(before.id)?.body, "Original");
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
test("legacy settings migrate once to v2 without changing original bytes or rereading old hints", () => {
  const storage = memoryStorage(), prefs = JSON.stringify({theme: "dark", folder: "old-writing", entryTypes: {old: "original-entry"}});
  storage.setItem("journal.prefs.v1", prefs); storage.setItem("journal.collection", JSON.stringify("old"));
  const expected = new JournalDrafts(storage).preferences();
  assert(storage.getItem("journal.prefs.v2")); assert.equal(storage.getItem("journal.prefs.v1"), prefs);
  const get = storage.getItem;
  storage.getItem = key => {if (key === "journal.prefs.v1" || key === "journal.collection") throw new Error("legacy key read again"); return get(key);};
  assert.deepEqual(new JournalDrafts(storage).preferences(), expected);
});
test("an intentionally cleared modern collection hint cannot resurrect the old collection", () => {
  const storage = memoryStorage(); storage.setItem("journal.collection", JSON.stringify("old"));
  const drafts = new JournalDrafts(storage); assert.equal(drafts.preferences().collectionId, "old");
  drafts.savePreferences({folder: "new", theme: "system"});
  assert.deepEqual(new JournalDrafts(storage).preferences(), {folder: "new", theme: "system"});
});
test("quota during preference migration retains legacy choices and retries safely", () => {
  const storage = memoryStorage(), bytes = JSON.stringify({theme: "light", folder: "original", entryTypes: {old: "custom"}});
  storage.setItem("journal.prefs.v1", bytes); const set = storage.setItem;
  storage.setItem = () => {throw new Error("quota");};
  const first = new JournalDrafts(storage).preferences(); assert.equal(first.folder, "original");
  assert.equal(storage.getItem("journal.prefs.v2"), null); assert.equal(storage.getItem("journal.prefs.v1"), bytes);
  storage.setItem = set; assert.deepEqual(new JournalDrafts(storage).preferences(), first);
  assert.deepEqual(JSON.parse(storage.getItem("journal.prefs.v2")!), first);
});
test("preference reads on a fresh empty visit allocate no storage", () => {
  const storage = memoryStorage(); assert.deepEqual(new JournalDrafts(storage).preferences(), {theme: "system", folder: "journal"});
  assert.equal(storage.length, 0);
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
