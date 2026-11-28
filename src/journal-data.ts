import {revisionOf, uuidv7, type DescribeResult, type MdbaseApplicationConnection, type RecordLease, type RecordSessionSnapshot, type RecordView, type FileRef} from "@mdbase-dev/sdk";
import {hasDraftContent, JournalDrafts, type JournalDraft} from "./drafts.js";
export const JOURNAL_CONTRACT = Object.freeze({id: "journal.entry", version: "0.1.0", digest: "sha256:7e95bdf03621919fb0e722e5a29b48a68d7a4eaa3a94aea033d96ea2f7ec34cc"});
export interface JournalEntryType {readonly name: string; readonly createdField: string}
export interface JournalEntry {readonly id: string; readonly created: string; readonly createdMs: number; readonly path: string}
export const DELETED_ENTRY_NOTICE = "This entry was deleted elsewhere. Your text stays on this device.";
const EDITED_ENTRY_NOTICE = "This note changed elsewhere. Your local text has been preserved.";
function witnessedSave(snapshot: RecordSessionSnapshot, capture?: {mutationId: string; body: string}): boolean {
  const receipt = snapshot.lastReceipt;
  return !!capture && snapshot.record.body === capture.body && receipt?.mutation === capture.mutationId &&
    (receipt.state === "confirmed" || receipt.state === "pending") && receipt.status !== "conflicted" &&
    !!receipt.records?.some(record => record.id === snapshot.record.id && record.revision === snapshot.record.revision);
}
function matchesDraftBase(draft: JournalDraft, record: RecordView): boolean {
  return record.revision === draft.pendingRecordRevision || record.body === draft.savedBody &&
    (!draft.savedRecordRevision || record.revision === draft.savedRecordRevision);
}
/** The collection's catalog cannot give Journal an entry type. SDK readiness
 * checks only that the contract exists and some type claims it; these are the
 * further bindings Journal needs. The message is shown to the writer. */
export class JournalCatalogError extends Error {
  override readonly name = "JournalCatalogError";
}
/** Only current canonical catalog bindings, never the starter type name. */
export function journalEntryTypes(catalog: DescribeResult): JournalEntryType[] {
  const contract = catalog.contracts.filter(c => c.id === JOURNAL_CONTRACT.id && c.version === JOURNAL_CONTRACT.version && c.digest === JOURNAL_CONTRACT.digest);
  if (contract.length !== 1) throw new JournalCatalogError("This collection does not provide the required Journal contract (journal.entry 0.1.0). Set up Journal in it again.");
  const types: JournalEntryType[] = [];
  for (const type of catalog.types) {
    const implementations = type.implements.filter(i => i.contract === JOURNAL_CONTRACT.id && i.version === JOURNAL_CONTRACT.version);
    if (implementations.length > 1) throw new JournalCatalogError(`The type ${type.name} has an ambiguous Journal type binding: it implements journal.entry 0.1.0 more than once.`);
    const field = implementations[0]?.fields["created"];
    if (field === undefined) continue;
    // The native public create API accepts top-level fields. Do not implement a
    // second field-reference parser or silently write a dotted literal key.
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) throw new JournalCatalogError(`The type ${type.name} maps the journal.entry created field to ${field}. Journal can only write a top-level field.`);
    if (types.some(existing => existing.name === type.name)) throw new JournalCatalogError(`This collection has an ambiguous Journal type name: ${type.name}.`);
    types.push(Object.freeze({name: type.name, createdField: field}));
  }
  if (!types.length) throw new JournalCatalogError("This collection has no Journal entry type: no type maps the journal.entry created field.");
  return types;
}
/** A readable original record: confirmed, or kept on this device while the SDK
 * write ledger settles it. Never a protected or inconsistent readback. */
function currentRecord(record: RecordView, id: string): void {
  if (record.id !== id || (record.state.state !== "confirmed" && record.state.state !== "pending") || record.state.hold !== undefined || (record.state.unresolved ?? 0) !== 0 ||
      typeof record.body !== "string" || typeof record.document !== "string" || revisionOf(record.document) !== record.revision) {
    throw new Error("Keep this note on this device until its original record can be read safely.");
  }
}
/** Borrows the original SDK client/session. It never retries an uncertain
 * create, makes a sibling path, owns authentication, or copies autosave. */
export class JournalData {
  private readonly caller = new AbortController();
  private readonly leases = new Map<string, RecordLease>();
  private readonly opening = new Map<string, Promise<RecordLease>>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscriptions = new Map<string, () => void>();
  private readonly unpins = new Map<string, () => void>();
  private readonly problems = new Map<string, string>();
  /** Last SDK capture per borrowed lease, retained only to recognise its own
   * receipt advancing a displayed revision while input waits for local storage. */
  private readonly capturedEdits = new Map<string, {mutationId: string; baseRevision: string; body: string}>();
  private disposed = false;
  constructor(readonly connection: MdbaseApplicationConnection, private readonly drafts: JournalDrafts) {
    if (connection.files !== connection.records.files || connection.id !== connection.records.collection) throw new Error("Journal must use the original collection client.");
  }
  subscribe(listener: () => void): () => void {this.listeners.add(listener); return () => this.listeners.delete(listener);}
  private notify(): void {for (const listener of this.listeners) listener();}
  private ensure(draft?: JournalDraft, reviewing = false): void {
    this.caller.signal.throwIfAborted();
    if (draft?.deletedElsewhere) throw new Error(DELETED_ENTRY_NOTICE);
    if (draft?.reviewRequired && !reviewing) throw new Error("This note changed elsewhere. Copy your text or use the saved version before continuing.");
    if (draft?.legacyKey) throw new Error("This earlier note needs its original save reviewed. Your text is still on this device.");
    if (this.disposed || !this.connection.isCurrent()) throw new Error("This collection has changed. Your text is still on this device.");
    if (draft?.targetCollectionId && draft.targetCollectionId !== this.connection.id) throw new Error("This note belongs to another collection.");
    const attempt = draft?.createAttempt;
    if (attempt && (attempt.account !== this.connection.scope.account || attempt.installation !== this.connection.scope.installation)) throw new Error("This note belongs to its original signed-in device.");
  }
  async types(): Promise<JournalEntryType[]> {
    this.ensure();
    const catalog = await this.connection.records.describe({signal: this.caller.signal});
    this.ensure();
    return journalEntryTypes(catalog);
  }
  async entries(types: JournalEntryType[]): Promise<JournalEntry[]> {
    this.ensure();
    const entries: JournalEntry[] = [];
    for await (const page of this.connection.records.pages({types: types.map(type => type.name), limit: 500}, {signal: this.caller.signal})) {
      this.ensure();
      if (!page.complete) throw new Error("Saved entries are still loading. Notes on this device are still available.");
      for (const record of page.records) {
        const type = types.find(type => record.types.includes(type.name));
        const created = type ? record.frontmatter[type.createdField] : null;
        if (typeof created !== "string") continue;
        const createdMs = Date.parse(created);
        if (!Number.isFinite(createdMs)) continue;
        entries.push({id: record.id, created, createdMs, path: record.path});
      }
    }
    // A query can omit a record because its type/date changed. Only an ordinary
    // ID read returning not_found proves deletion; failed reads preserve copies.
    const listed = new Set(entries.map(entry => entry.id));
    for (const draft of this.drafts.list()) {
      if (draft.targetCollectionId !== this.connection.id || !draft.recordId || draft.savedBody === null) continue;
      if (listed.has(draft.recordId)) {
        if (draft.deletedElsewhere) await this.markDeleted(draft.id, draft.recordId, false);
        continue;
      }
      const record = await this.connection.records.find(draft.recordId, {signal: this.caller.signal});
      this.ensure();
      if (!record || draft.deletedElsewhere) await this.markDeleted(draft.id, draft.recordId, !record);
    }
    return entries.sort((a, b) => b.createdMs - a.createdMs);
  }
  private async markDeleted(id: string, recordId: string, deletedElsewhere = true): Promise<void> {
    await this.drafts.mutate(() => {
      this.ensure();
      const latest = this.drafts.get(id);
      if (latest?.recordId === recordId && latest.targetCollectionId === this.connection.id && !!latest.deletedElsewhere !== deletedElsewhere) {
        // Patch metadata under the origin lock: typing during the read survives.
        this.drafts.patch(id, {deletedElsewhere});
      }
    });
    this.notify();
  }
  /** Read an existing entry, never re-create it or mint a capture identity. */
  async resume(entry: JournalEntry): Promise<JournalDraft> {
    this.ensure();
    const local = this.drafts.list().find(draft => draft.targetCollectionId === this.connection.id && draft.recordId === entry.id);
    if (local) return local;
    const record = await this.connection.records.get(entry.id, {include: {body: true, document: true}, signal: this.caller.signal});
    this.ensure(); currentRecord(record, entry.id);
    const confirmed = record.state.state === "confirmed";
    const draft = await this.drafts.mutate(() => this.drafts.put({...this.drafts.blank(this.connection.id, new Date(entry.createdMs)), id: entry.id,
      created: entry.created, body: record.body!, savedBody: confirmed ? record.body! : null,
      savedRecordRevision: confirmed ? record.revision : undefined, pendingRecordRevision: confirmed ? undefined : record.revision,
      path: record.path, recordId: record.id}));
    this.ensure();
    return this.drafts.get(draft.id)!;
  }
  async open(id: string, type?: JournalEntryType): Promise<RecordLease> {
    const draft = this.drafts.get(id);
    if (!draft) throw new Error("The original local draft is missing. Keep this page open.");
    this.ensure(draft);
    if (this.problems.has(id)) throw new Error(this.problems.get(id));
    const existing = this.leases.get(id);
    if (existing) return existing;
    const job = this.opening.get(id);
    if (job) return job;
    const unpin = this.drafts.pin(id); this.unpins.set(id, unpin);
    const pending = this.acquire(id, type);
    this.opening.set(id, pending);
    try {return await pending;} finally {
      if (this.opening.get(id) === pending) this.opening.delete(id);
      if (!this.leases.has(id)) {unpin(); if (this.unpins.get(id) === unpin) this.unpins.delete(id);}
    }
  }
  private async acquire(id: string, type?: JournalEntryType): Promise<RecordLease> {
    let draft = this.drafts.get(id);
    if (!draft || !draft.path || !hasDraftContent(draft)) throw new Error("Write something before saving this page.");
    this.ensure(draft);
    if (!draft.targetCollectionId) draft = await this.drafts.mutate(() => this.drafts.patch(id, {targetCollectionId: this.connection.id}));
    if (!draft.recordId) {
      if (!draft.createAttempt) {
        if (!type) throw new Error("Choose an entry type before creating a page.");
        const path = draft.path;
        if (!path) throw new Error("The original note path is missing.");
        // Persist both original identities and exact intent BEFORE any capture.
        const original = draft;
        draft = await this.drafts.mutate(() => this.drafts.patch(id, {createAttempt: {mutationId: uuidv7(), recordId: uuidv7(), body: original.body,
          typeName: type.name, createdField: type.createdField, path, created: original.created,
          account: this.connection.scope.account, installation: this.connection.scope.installation}}));
        const attempt = draft.createAttempt!;
        const result = await this.connection.records.settle(this.connection.records.create({id: attempt.recordId, path: attempt.path, type: attempt.typeName,
          frontmatter: {[attempt.createdField]: attempt.created}, body: attempt.body}, {mutationId: attempt.mutationId, signal: this.caller.signal}), {signal: this.caller.signal});
        this.ensure(draft);
        // A refusal is definite: nothing was created, so the next save starts a new intent.
        if (result.outcome === "rejected") {
          await this.drafts.mutate(() => this.drafts.patch(id, {createAttempt: null}));
          throw new Error(result.problem.message);
        }
      }
      // Confirmed or kept on this device: the SDK write ledger settles it. Read the
      // ORIGINAL record by its pinned ID; creation is never resubmitted.
      const attempt = draft.createAttempt!;
      const record = await this.connection.records.get(attempt.recordId, {include: {body: true, document: true, effective: true}, signal: this.caller.signal})
        .catch(() => {throw new Error("Keep this page open while its original save is unresolved.");});
      this.ensure(draft); currentRecord(record, attempt.recordId);
      if (record.body !== attempt.body) throw new Error("The original saved note has changed. Your local text has been preserved.");
      const confirmed = record.state.state === "confirmed";
      draft = await this.drafts.mutate(() => this.drafts.patch(id, {recordId: attempt.recordId, savedBody: confirmed ? attempt.body : null,
        savedRecordRevision: confirmed ? record.revision : undefined, pendingRecordRevision: confirmed ? undefined : record.revision}));
    }
    // An unconfirmed write from an earlier visit is in the SDK write ledger; the record stays editable.
    const lease = await this.connection.records.records.open(draft.recordId!, {signal: this.caller.signal, autosave: {idleMs: 1200}, requireLive: true});
    try {
      let settling = !!lease.session.getSnapshot().recovery;
      const unsubscribe = lease.session.subscribe(() => {
        if (this.disposed || !this.connection.isCurrent() || this.problems.has(id)) return;
        const value = lease.session.getSnapshot(), capture = value.recovery;
        const completed = settling && !capture;
        settling = !!capture;
        if (value.state === "deleted") {
          void this.markDeleted(id, value.record.id)
            .catch(() => {this.problems.set(id, "Keep this page open: Journal cannot preserve the deletion notice on this device."); this.notify();});
        }
        if (value.state === "saving" && capture?.baseRevision && capture.recordId === value.record.id && this.capturedEdits.get(id)?.mutationId !== capture.mutationId) {
          this.capturedEdits.set(id, {mutationId: capture.mutationId, baseRevision: capture.baseRevision, body: value.body});
        }
        const own = witnessedSave(value, this.capturedEdits.get(id));
        let replaced = false;
        if (completed && !own && (value.state === "saved" || value.state === "saved_on_device" || value.state === "unsaved")) {
          const local = this.drafts.get(id);
          // A retained session can finish a capture that predates this lease.
          // With no capture witness, only an already-known base is safe.
          replaced = this.capturedEdits.has(id) || !local || value.record.body !== local.body && !matchesDraftBase(local, value.record);
        }
        if (replaced) {
          // Stop the SDK drive before it can save newer typing onto the unrelated
          // readback. The complete text already lives in the origin store.
          this.problems.set(id, EDITED_ENTRY_NOTICE);
          this.close(id);
        }
        if (replaced || value.state === "conflict" || value.state === "saved" || value.state === "saved_on_device" || completed && own) {
          void this.drafts.mutate(() => {
            if (replaced || !this.disposed && this.connection.isCurrent()) this.reconcile(id, value, own, replaced);
            if (replaced) this.problems.delete(id);
          }).catch(() => {this.problems.set(id, "Keep this page open: Journal cannot preserve the original save outcome on this device.");})
            .finally(() => this.notify());
        }
        this.notify();
      });
      this.unsubscriptions.set(id, unsubscribe);
      this.leases.set(id, lease);
      await this.drafts.mutate(() => {
        this.ensure();
        const snapshot = lease.session.getSnapshot();
        if (snapshot.state === "deleted") return;
        const latest = this.reconcile(id, snapshot);
        if (latest.reviewRequired) throw new Error(EDITED_ENTRY_NOTICE);
        this.ensure(latest);
        if (snapshot.state === "saved" || snapshot.state === "saved_on_device" || snapshot.state === "unsaved") lease.session.setBody(latest.body);
      });
      const snapshot = lease.session.getSnapshot();
      if (snapshot.state === "deleted") {await this.markDeleted(id, snapshot.record.id); throw new Error(DELETED_ENTRY_NOTICE);}
      if (this.problems.has(id)) throw new Error(this.problems.get(id));
      return lease;
    } catch (error) {
      this.unsubscriptions.get(id)?.(); this.unsubscriptions.delete(id); this.leases.delete(id); this.capturedEdits.delete(id);
      lease.release(); throw error;
    }
  }
  /** Check and advance the durable save base under the same lock as typing. */
  private reconcile(id: string, snapshot: RecordSessionSnapshot, own = false, replaced = false): JournalDraft {
    const local = this.drafts.get(id);
    if (!local) throw new Error("The original local draft is missing. Keep this page open.");
    if (local.reviewRequired || local.deletedElsewhere) return local;
    const {body, revision, state} = snapshot.record;
    const pending = state.state === "pending";
    const knownBase = matchesDraftBase(local, snapshot.record);
    const clean = local.body === local.savedBody && !local.pendingRecordRevision && !snapshot.dirty;
    if (replaced || snapshot.state === "conflict" || body !== local.body && !knownBase && !own && (!clean || pending)) {
      return this.drafts.patch(id, {reviewRequired: true});
    }
    if (pending) {
      return (own || body === local.body || knownBase) && revision !== local.pendingRecordRevision
        ? this.drafts.patch(id, {pendingRecordRevision: revision}) : local;
    }
    if (state.state !== "confirmed" || typeof body !== "string") return local;
    if (body === local.savedBody && revision === local.savedRecordRevision && !local.pendingRecordRevision) return local;
    return this.drafts.patch(id, {body: clean ? body : local.body, savedBody: body, savedRecordRevision: revision, pendingRecordRevision: undefined});
  }
  setBody(id: string, body: string, source?: {body: string; revision: string | null}): Promise<void> {
    const expectedRevision = this.drafts.get(id)?.revision;
    return this.drafts.mutate(() => {
      // A storage notification can wait behind newer input in the origin lock.
      // It owns the text it observed, not a fresh revision of that newer draft.
      if (this.drafts.get(id)?.revision !== expectedRevision) return;
      const draft = this.drafts.patch(id, {body, touchedMs: Date.now()});
      this.ensure(draft);
      if (this.problems.has(id)) throw new Error(this.problems.get(id));
      const session = this.leases.get(id)?.session;
      const actual = session?.getSnapshot();
      const capture = this.capturedEdits.get(id);
      // A completed original SDK capture may advance the source before this
      // input gets the origin lock. Require its exact base/body, mutation and
      // receipt's current-record witness; outside/unknown outcomes still refuse.
      const ownSave = source && actual && capture && capture.baseRevision === source.revision && capture.body === source.body && actual.body === source.body &&
        (actual.state === "saved" || actual.state === "saved_on_device") && witnessedSave(actual, capture);
      // Never attach stale displayed text to a freshly advanced outside revision.
      if (source && actual && actual.body !== body && (actual.body !== source.body || !actual.dirty && source.revision !== null && actual.record.revision !== source.revision && !ownSave)) {
        this.drafts.patch(id, {reviewRequired: true});
        throw new Error(EDITED_ENTRY_NOTICE);
      }
      session?.setBody(body);
    });
  }
  /** Explicit user choice: read the original confirmed source, never write or
   * recreate it. Concurrent further typing refuses the discard. */
  async useSavedVersion(id: string): Promise<JournalDraft> {
    const original = this.drafts.get(id);
    if (!original?.recordId) throw new Error("The original saved note is not available yet. Keep your text here.");
    this.ensure(original, true);
    const record = await this.connection.records.get(original.recordId, {include: {body: true, document: true}, signal: this.caller.signal});
    this.ensure(original, true); currentRecord(record, original.recordId);
    if (record.state.state !== "confirmed") throw new Error("Wait for the saved version to sync. Your text stays on this device.");
    const owned = this.leases.get(id);
    // A released conflict can still be retained by this SDK client. Reopen it
    // only for this explicit discard, without seeding an autosaving draft.
    const lease = owned ?? await this.connection.records.records.open(original.recordId, {signal: this.caller.signal, autosave: {idleMs: 1200}, requireLive: true});
    try {
      this.ensure(original, true);
      return await this.drafts.mutate(() => {
        const latest = this.drafts.get(id);
        if (!latest || latest.revision !== original.revision) throw new Error("Your text changed while the saved version was opening. Copy it before trying again.");
        const snapshot = lease.session.getSnapshot();
        if (snapshot.state === "conflict") lease.session.resolve({keep: "theirs"});
        else if (snapshot.dirty && !snapshot.recovery && snapshot.record.revision === record.revision) lease.session.setBody(record.body!);
        return this.drafts.patch(id, {body: record.body!, savedBody: record.body!, savedRecordRevision: record.revision,
          pendingRecordRevision: undefined, reviewRequired: false});
      });
    } finally {if (!owned) lease.release();}
  }
  problem(id: string): string | null {return this.problems.get(id) ?? null;}
  snapshot(id: string): RecordSessionSnapshot | null {return this.leases.get(id)?.session.getSnapshot() ?? null;}
  async flush(id: string): Promise<void> {
    this.ensure(this.drafts.get(id) ?? undefined);
    if (this.problems.has(id)) throw new Error(this.problems.get(id));
    const lease = this.leases.get(id);
    if (!lease) throw new Error("This note has not opened its original record yet.");
    const result = await lease.session.flush({signal: this.caller.signal});
    this.ensure();
    if (this.problems.has(id)) throw new Error(this.problems.get(id));
    if (!result.ok) throw new Error("The note is still on this device. Resolve its original save before continuing.");
  }
  /** Uses the SAME FilesApi. Grants and bounds remain enforced by the SDK. */
  async readFile(ref: FileRef): Promise<Uint8Array> {
    this.ensure();
    const bytes = await this.connection.files.download(ref, {signal: this.caller.signal});
    this.ensure();
    return bytes;
  }
  close(id: string): void {
    this.unsubscriptions.get(id)?.(); this.unsubscriptions.delete(id);
    this.leases.get(id)?.release(); this.leases.delete(id); this.capturedEdits.delete(id);
    this.unpins.get(id)?.(); this.unpins.delete(id);
  }
  release(): void {
    if (this.disposed) return;
    this.disposed = true; this.caller.abort();
    for (const unsubscribe of this.unsubscriptions.values()) unsubscribe();
    this.unsubscriptions.clear();
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear(); this.listeners.clear(); this.problems.clear(); this.capturedEdits.clear();
    for (const unpin of this.unpins.values()) unpin(); this.unpins.clear();
    // Borrowed clients and SDK singleton are never closed by a writing view.
  }
}
