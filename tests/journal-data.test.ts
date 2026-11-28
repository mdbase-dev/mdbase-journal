import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {JournalDrafts} from "../src/drafts.js";
import {JournalCatalogError, JournalData, journalEntryTypes} from "../src/journal-data.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";

test("catalog uses exact contract semantics and collection-owned field names", () => {
  const value = catalog("written", "my-entry");
  assert.deepEqual(journalEntryTypes(value), [{name: "my-entry", createdField: "written"}]);
  value.contracts[0]!.digest = "sha256:" + "0".repeat(64);
  assert.throws(() => journalEntryTypes(value), /required Journal contract/);
  assert.throws(() => journalEntryTypes(catalog("meta.created")), (error: unknown) => error instanceof JournalCatalogError && /top-level field/.test(error.message));
});
test("missing or ambiguous contract implementations never pick the starter name", () => {
  const value = catalog(); value.types[0]!.implements.push(value.types[0]!.implements[0]!);
  assert.throws(() => journalEntryTypes(value), /ambiguous/);
  value.types = []; assert.throws(() => journalEntryTypes(value), /no Journal entry type/);
});
test("saved entries span bounded SDK pages and sort newest first across them", async () => {
  const h = await applicationFixture(), data = new JournalData(h.connection, new JournalDrafts(memoryStorage()));
  const types = journalEntryTypes(catalog()), query = mock.method(h.records, "query");
  try {
    const ids = Array.from({length: 1001}, (_, index) => h.replica.seed({
      path: `journal/${String(index).padStart(4, "0")}.md`, types: [types[0]!.name],
      frontmatter: {created: new Date(Date.UTC(2026, 0, 1) + index).toISOString()},
    }).id);
    const entries = await data.entries(types);
    assert.deepEqual(entries.map(entry => entry.id), ids.reverse());
    assert.ok(query.mock.calls.some(call => call.arguments[0].cursor), "must follow an SDK continuation");
  } finally {query.mock.restore(); data.release(); await h.fixture.close();}
});
test("real SDK create pins original IDs, then edits through the same record lease", async () => {
  const h = await applicationFixture();
  const drafts = new JournalDrafts(memoryStorage()), draft = drafts.create(h.connection.id);
  drafts.patch(draft.id, {body: "First page", path: "journal/entry.md"});
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(draft.id, journalEntryTypes(catalog("written"))[0]!);
    const saved = drafts.get(draft.id)!;
    assert.equal(saved.recordId, saved.createAttempt?.recordId); assert.equal(saved.savedBody, "First page");
    assert.equal(saved.createAttempt?.path, "journal/entry.md");
    const record = await h.records.get(saved.recordId!, {include: {body: true}});
    assert.equal(record.frontmatter["written"], draft.created); assert.equal(record.body, "First page");
    assert.equal(await data.open(draft.id, journalEntryTypes(catalog())[0]!), lease);
    data.setBody(draft.id, "Revised page"); await data.flush(draft.id);
    assert.equal((await h.records.get(saved.recordId!, {include: {body: true}})).body, "Revised page");
    assert.equal(drafts.get(draft.id)?.savedBody, "Revised page");
  } finally {data.release(); assert.equal(h.records.link, "open"); h.close();}
});
test("pending original create is not reported saved and newer typing survives completion", async () => {
  const h = await applicationFixture({confirmed: false}), drafts = new JournalDrafts(memoryStorage()), draft = drafts.create(h.connection.id);
  drafts.patch(draft.id, {path: "pending.md", body: "Original"});
  const data = new JournalData(h.connection, drafts), captured = deferred<void>(), original = h.records.create.bind(h.records);
  const spy = mock.method(h.records, "create", async (...args: Parameters<typeof original>) => {const value = await original(...args); captured.resolve(); return value;});
  try {
    const opening = data.open(draft.id, journalEntryTypes(catalog())[0]!);
    await captured.promise;
    assert.equal(drafts.get(draft.id)?.savedBody, null);
    drafts.patch(draft.id, {body: "Newer writing"}); h.replica.confirmAll();
    const lease = await opening; assert.equal(lease.session.getSnapshot().body, "Newer writing");
    assert.equal(drafts.get(draft.id)?.createAttempt?.body, "Original"); assert.equal(spy.mock.callCount(), 1);
  } finally {spy.mock.restore(); data.release(); h.close();}
});
test("uncertain create recovery never resubmits or makes a sibling path", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), draft = drafts.create(h.connection.id);
  drafts.patch(draft.id, {path: "original.md", body: "Retained"});
  const data = new JournalData(h.connection, drafts);
  const spy = mock.method(h.records, "create", async () => {assert(drafts.get(draft.id)?.createAttempt); throw new Error("unknown original outcome");});
  try {
    await assert.rejects(data.open(draft.id, journalEntryTypes(catalog())[0]!), /unknown original outcome/);
    const original = drafts.get(draft.id)!.createAttempt;
    await assert.rejects(data.open(draft.id, journalEntryTypes(catalog())[0]!));
    assert.equal(spy.mock.callCount(), 1); assert.deepEqual(drafts.get(draft.id)?.createAttempt, original); assert.equal(drafts.get(draft.id)?.path, "original.md");
    assert.equal(drafts.get(draft.id)?.savedBody, null);
  } finally {spy.mock.restore(); data.release(); h.close();}
});
test("failed local persistence submits no create", async () => {
  const h = await applicationFixture(), storage = memoryStorage(), drafts = new JournalDrafts(storage), draft = drafts.create(h.connection.id);
  drafts.patch(draft.id, {path: "local.md", body: "Local text"});
  storage.setItem = () => {throw new Error("quota");};
  const data = new JournalData(h.connection, drafts), spy = mock.method(h.records, "create");
  try {await assert.rejects(data.open(draft.id, journalEntryTypes(catalog())[0]!), /preserve its text/); assert.equal(spy.mock.callCount(), 0);}
  finally {spy.mock.restore(); data.release(); h.close();}
});
test("retired connection and cross-collection drafts never write", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), draft = drafts.create("elsewhere");
  drafts.patch(draft.id, {path: "private.md", body: "Private"});
  const data = new JournalData(h.connection, drafts), spy = mock.method(h.records, "create");
  try {await assert.rejects(data.open(draft.id, journalEntryTypes(catalog())[0]!), /another collection/); h.retire(); await assert.rejects(data.open(draft.id, journalEntryTypes(catalog())[0]!), /collection has changed/); assert.equal(spy.mock.callCount(), 0);}
  finally {spy.mock.restore(); data.release(); h.close();}
});
test("quota failure inside a real session notification is contained and blocks further edits", async () => {
  const h = await applicationFixture(), storage = memoryStorage(), drafts = new JournalDrafts(storage), draft = drafts.create(h.connection.id);
  drafts.patch(draft.id, {path: "notification.md", body: "Original"});
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(draft.id, journalEntryTypes(catalog())[0]!);
    data.setBody(draft.id, "Revised"); storage.setItem = () => {throw new Error("quota");};
    await lease.session.flush();
    assert.match(data.problem(draft.id)!, /original save outcome/);
    assert.equal(drafts.get(draft.id)?.savedBody, "Original"); assert.equal(drafts.get(draft.id)?.body, "Revised");
    await assert.rejects(data.flush(draft.id), /original save outcome/);
    assert.equal((await h.records.get(drafts.get(draft.id)!.recordId!, {include: {body: true}})).body, "Revised");
  } finally {data.release(); h.close();}
});
test("protected original readback refuses Saved and recovery retains the original mutation and path", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), draft = drafts.create(h.connection.id);
  drafts.patch(draft.id, {path: "protected.md", body: "Original"});
  const data = new JournalData(h.connection, drafts), create = mock.method(h.records, "create"), original = h.records.get.bind(h.records);
  const get = mock.method(h.records, "get", async (...args: Parameters<typeof original>) => {
    const record = await original(...args); return {...record, state: {...record.state, hold: crypto.randomUUID()}};
  });
  try {
    await assert.rejects(data.open(draft.id, journalEntryTypes(catalog())[0]!), /read safely/);
    const attempt = drafts.get(draft.id)!.createAttempt; assert(attempt); assert.equal(drafts.get(draft.id)?.savedBody, null);
    get.mock.restore(); await data.open(draft.id, journalEntryTypes(catalog())[0]!);
    assert.equal(create.mock.callCount(), 1); assert.deepEqual(drafts.get(draft.id)?.createAttempt, attempt);
    assert.equal(drafts.get(draft.id)?.recordId, attempt.recordId); assert.equal(drafts.get(draft.id)?.path, "protected.md");
  } finally {get.mock.restore(); create.mock.restore(); data.release(); h.close();}
});
test("same collection under another account or installation cannot acquire an original draft", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), draft = drafts.create(h.connection.id);
  drafts.patch(draft.id, {path: "scoped.md", body: "Private"});
  const original = new JournalData(h.connection, drafts);
  try {
    await original.open(draft.id, journalEntryTypes(catalog())[0]!); original.release();
    const other = new JournalData({...h.connection, scope: {...h.connection.scope, account: "another-account"}}, drafts);
    const get = mock.method(h.records, "get"), create = mock.method(h.records, "create");
    try {
      await assert.rejects(other.open(draft.id, journalEntryTypes(catalog())[0]!), /original signed-in device/);
      assert.equal(get.mock.callCount(), 0); assert.equal(create.mock.callCount(), 0);
    } finally {get.mock.restore(); create.mock.restore(); other.release();}
  } finally {original.release(); h.close();}
});
test("stale displayed native text cannot use a fresh SDK revision, including after reload", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "native-concurrency.md"});
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(draft.id, journalEntryTypes(catalog())[0]!);
    const shown = lease.session.getSnapshot();
    lease.session.setBody("Seed\nOther tab"); await lease.session.flush();
    const update = mock.method(h.records, "update");
    try {
      await assert.rejects(data.setBody(draft.id, "Seed\nStale typing", {body: shown.body, revision: shown.record.revision}), /changed elsewhere/);
      assert.equal(drafts.get(draft.id)?.body, "Seed\nStale typing");
      assert.equal(drafts.get(draft.id)?.reviewRequired, true);
      await assert.rejects(data.flush(draft.id), /changed elsewhere/);
      const reloaded = new JournalData(h.connection, drafts);
      try {await assert.rejects(reloaded.open(draft.id), /changed elsewhere/);} finally {reloaded.release();}
      assert.equal(update.mock.callCount(), 0);
      assert.equal((await h.records.get(drafts.get(draft.id)!.recordId!, {include: {body: true}})).body, "Seed\nOther tab");
      const selected = await data.useSavedVersion(draft.id);
      assert.equal(selected.body, "Seed\nOther tab"); assert.equal(selected.reviewRequired, false);
      assert.equal(update.mock.callCount(), 0, "using the saved version is read-only");
    } finally {update.mock.restore();}
  } finally {data.release(); h.close();}
});
test("a remote edit delivered during reconnect cannot become the base of a stored offline draft", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const id = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "offline-draft.md"}).id;
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(id, journalEntryTypes(catalog())[0]!);
    const recordId = lease.session.getSnapshot().record.id;
    h.replica.setOnline(false);
    // The origin store holds the edit before it can reach a borrowed SDK lease.
    drafts.patch(id, {body: "Offline writing"});
    h.replica.setOnline(true);
    h.replica.editElsewhere(recordId, {body: "Other device"});
    for (let i = 0; i < 100 && lease.session.getSnapshot().body !== "Other device"; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(lease.session.getSnapshot().body, "Other device");
    assert.equal(drafts.get(id)?.body, "Offline writing");
    assert.equal(drafts.get(id)?.savedBody, "Seed");
    assert.equal(drafts.get(id)?.reviewRequired, true);
    data.release();
    const reopened = new JournalData(h.connection, drafts);
    try {
      await assert.rejects(reopened.open(id), /changed elsewhere/);
      assert.equal((await h.records.get(recordId, {include: {body: true}})).body, "Other device");
      assert.equal((await reopened.useSavedVersion(id)).body, "Other device");
    } finally {reopened.release();}
  } finally {data.release(); h.close();}
});
for (const newerTyping of [false, true]) test(`an offline capture replaced on reconnect retains ${newerTyping ? "newer typing" : "the captured text"}`, async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const id = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "offline-capture.md"}).id;
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(id, journalEntryTypes(catalog())[0]!);
    const recordId = lease.session.getSnapshot().record.id;
    h.replica.setOnline(false);
    await data.setBody(id, "Offline writing");
    const reconnect = deferred<void>(), submit = h.records.update.bind(h.records);
    const update = mock.method(h.records, "update", async (...args: Parameters<typeof submit>) => {
      const write = await submit(...args);
      reconnect.resolve();
      return write;
    });
    const saving = lease.session.flush({timeoutMs: 2000});
    await reconnect.promise;
    if (newerTyping) await data.setBody(id, "Offline writing plus more");
    h.replica.editElsewhere(recordId, {body: "Other device"});
    h.replica.setOnline(true); h.replica.confirmAll();
    await saving;
    assert.equal(update.mock.callCount(), 1);
    assert.equal(drafts.get(id)?.body, newerTyping ? "Offline writing plus more" : "Offline writing");
    assert.equal(drafts.get(id)?.savedBody, "Seed");
    assert.equal(drafts.get(id)?.reviewRequired, true);
    assert.equal((await h.records.get(recordId, {include: {body: true}})).body, "Other device");
    const saved = await data.useSavedVersion(id);
    assert.equal(saved.body, "Other device");
    assert.equal(saved.reviewRequired, false);
    assert.equal((await data.open(id)).session.getSnapshot().dirty, false);
    assert.equal(update.mock.callCount(), 1);
    update.mock.restore();
  } finally {data.release(); h.close();}
});
test("reopening a pending offline edit in a fresh client keeps its witnessed base until review", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), data = new JournalData(h.connection, drafts);
  const id = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "offline-reopen.md"}).id;
  const records = await h.replica.client();
  const reopened = new JournalData({...h.connection, records, files: records.files}, drafts);
  try {
    const lease = await data.open(id, journalEntryTypes(catalog())[0]!);
    const recordId = lease.session.getSnapshot().record.id;
    h.replica.setOnline(false);
    await data.setBody(id, "Offline writing");
    assert.equal((await lease.session.flush({timeoutMs: 150})).ok, true);
    assert.equal(lease.session.getSnapshot().state, "saved_on_device");
    assert.equal(drafts.get(id)?.pendingRecordRevision, lease.session.getSnapshot().record.revision);
    await data.setBody(id, "Offline writing plus more");
    data.release();
    h.replica.editElsewhere(recordId, {body: "Other device"});
    h.replica.setOnline(true); h.replica.confirmAll();
    await assert.rejects(reopened.open(id), /changed elsewhere/);
    assert.equal(drafts.get(id)?.body, "Offline writing plus more");
    assert.equal(drafts.get(id)?.reviewRequired, true);
    assert.equal((await h.records.get(recordId, {include: {body: true}})).body, "Other device");
  } finally {reopened.release(); records.close(); data.release(); h.close();}
});
test("an SDK capture retained across lease release cannot replay newer typing against another editor's text", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage()), data = new JournalData(h.connection, drafts);
  const id = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "offline-retained.md"}).id;
  const reopened = new JournalData(h.connection, drafts);
  const captured = deferred<void>(), submit = h.records.update.bind(h.records);
  const update = mock.method(h.records, "update", async (...args: Parameters<typeof submit>) => {
    const write = await submit(...args);
    captured.resolve();
    return write;
  });
  try {
    const lease = await data.open(id, journalEntryTypes(catalog())[0]!);
    const recordId = lease.session.getSnapshot().record.id;
    h.replica.setOnline(false);
    await data.setBody(id, "Offline writing");
    const saving = lease.session.flush({timeoutMs: 2000});
    await captured.promise;
    await data.setBody(id, "Offline writing plus more");
    data.release();
    await saving;
    await reopened.open(id);
    h.replica.editElsewhere(recordId, {body: "Other device"});
    h.replica.setOnline(true); h.replica.confirmAll();
    for (let i = 0; i < 100 && !drafts.get(id)?.reviewRequired; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(drafts.get(id)?.reviewRequired, true);
    assert.equal(drafts.get(id)?.body, "Offline writing plus more");
    await assert.rejects(reopened.flush(id), /changed elsewhere/);
    assert.equal(update.mock.callCount(), 1);
    assert.equal((await h.records.get(recordId, {include: {body: true}})).body, "Other device");
  } finally {update.mock.restore(); reopened.release(); data.release(); h.close();}
});
test("clean native SDK source updates reconcile text as well as its saved baseline", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "native-clean-update.md"});
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(draft.id, journalEntryTypes(catalog())[0]!);
    lease.session.setBody("Seed\nCurrent source"); await lease.session.flush();
    assert.equal(drafts.get(draft.id)?.body, "Seed\nCurrent source");
    assert.equal(drafts.get(draft.id)?.savedBody, "Seed\nCurrent source");
  } finally {data.release(); h.close();}
});
for (const confirmed of [true, false]) test(`an own ${confirmed ? "confirmed" : "on-device"} save does not invalidate typing captured before its echo`, async () => {
  const h = await applicationFixture({confirmed}), drafts = new JournalDrafts(memoryStorage());
  const draft = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "self-echo.md"});
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(draft.id, journalEntryTypes(catalog())[0]!);
    const seed = lease.session.getSnapshot();
    await data.setBody(draft.id, "Seed\nMy first edit", {body: seed.body, revision: seed.record.revision});
    // The next input already read this source, but the origin storage lock has
    // not run it yet when the previous autosave's genuine SDK receipt arrives.
    const shown = lease.session.getSnapshot();
    await data.flush(draft.id);
    assert.notEqual(lease.session.getSnapshot().record.revision, shown.record.revision);
    await data.setBody(draft.id, "Seed\nMy first edit\nMore typing", {body: shown.body, revision: shown.record.revision});
    assert.equal(drafts.get(draft.id)?.reviewRequired, undefined);
    assert.equal(lease.session.getSnapshot().body, "Seed\nMy first edit\nMore typing");
  } finally {data.release(); h.close();}
});
test("an own save witness cannot excuse a later same-body outside metadata edit", async () => {
  const h = await applicationFixture(), drafts = new JournalDrafts(memoryStorage());
  const draft = drafts.put({...drafts.blank(h.connection.id), body: "Seed", path: "outside-metadata.md"});
  const data = new JournalData(h.connection, drafts);
  try {
    const lease = await data.open(draft.id, journalEntryTypes(catalog())[0]!);
    await data.setBody(draft.id, "My edit"); const shown = lease.session.getSnapshot();
    await data.flush(draft.id); const own = lease.session.getSnapshot();
    const write = await h.records.settle(h.records.update(own.record, {patch: {outside: "Other editor"}}));
    assert.equal(write.outcome, "confirmed");
    for (let i = 0; i < 100 && lease.session.getSnapshot().record.revision === own.record.revision; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.notEqual(lease.session.getSnapshot().record.revision, own.record.revision);
    assert.equal(lease.session.getSnapshot().body, shown.body);
    await assert.rejects(data.setBody(draft.id, "My edit with stale typing", {body: shown.body, revision: shown.record.revision}), /changed elsewhere/);
    assert.equal(drafts.get(draft.id)?.reviewRequired, true);
    assert.equal((await h.records.get(own.record.id, {include: {body: true}})).body, "My edit");
  } finally {data.release(); h.close();}
});
test("files use the same public FilesApi and real SDK protocol", async () => {
  const h = await applicationFixture(), data = new JournalData(h.connection, new JournalDrafts(memoryStorage()));
  try {
    const bytes = new TextEncoder().encode("journal attachment");
    const upload = await h.connection.files.upload("journal/attachment.txt", bytes); await upload.confirmed;
    assert.equal(data.connection.files, h.records.files); assert.deepEqual(await data.readFile(upload.fileId), bytes);
  } finally {data.release(); h.close();}
});
