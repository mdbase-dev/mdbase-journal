import assert from "node:assert/strict";
import {mock, test} from "node:test";
import {JournalDrafts} from "../src/drafts.js";
import {JournalData, journalEntryTypes} from "../src/journal-data.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";

test("catalog uses exact contract semantics and collection-owned field names", () => {
  const value = catalog("written", "my-entry");
  assert.deepEqual(journalEntryTypes(value), [{name: "my-entry", createdField: "written"}]);
  value.contracts[0]!.digest = "sha256:" + "0".repeat(64);
  assert.throws(() => journalEntryTypes(value), /required Journal contract/);
  assert.throws(() => journalEntryTypes(catalog("meta.created")), /shared SDK/);
});
test("missing or ambiguous contract implementations never pick the starter name", () => {
  const value = catalog(); value.types[0]!.implements.push(value.types[0]!.implements[0]!);
  assert.throws(() => journalEntryTypes(value), /ambiguous/);
  value.types = []; assert.throws(() => journalEntryTypes(value), /no Journal entry type/);
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
    const record = await h.records.get(saved.recordId!, {body: true});
    assert.equal(record.frontmatter.get("written"), draft.created); assert.equal(record.body, "First page");
    assert.equal(await data.open(draft.id, journalEntryTypes(catalog())[0]!), lease);
    data.setBody(draft.id, "Revised page"); await data.flush(draft.id);
    assert.equal((await h.records.get(saved.recordId!, {body: true})).body, "Revised page");
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
    assert.equal((await h.records.get(drafts.get(draft.id)!.recordId!, {body: true})).body, "Revised");
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
      assert.equal((await h.records.get(drafts.get(draft.id)!.recordId!, {body: true})).body, "Seed\nOther tab");
      const selected = await data.useSavedVersion(draft.id);
      assert.equal(selected.body, "Seed\nOther tab"); assert.equal(selected.reviewRequired, false);
      assert.equal(update.mock.callCount(), 0, "using the saved version is read-only");
    } finally {update.mock.restore();}
  } finally {data.release(); h.close();}
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
    const write = await h.records.save(h.records.update(own.record, {patch: {outside: "Other editor"}}));
    assert.equal(write.outcome, "confirmed");
    for (let i = 0; i < 100 && lease.session.getSnapshot().record.revision === own.record.revision; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.notEqual(lease.session.getSnapshot().record.revision, own.record.revision);
    assert.equal(lease.session.getSnapshot().body, shown.body);
    await assert.rejects(data.setBody(draft.id, "My edit with stale typing", {body: shown.body, revision: shown.record.revision}), /changed elsewhere/);
    assert.equal(drafts.get(draft.id)?.reviewRequired, true);
    assert.equal((await h.records.get(own.record.id, {body: true})).body, "My edit");
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
