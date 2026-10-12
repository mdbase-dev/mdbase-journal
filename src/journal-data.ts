import {revisionOf, uuidv7, type MdbaseApplicationConnection, type RecordLease, type RecordSessionSnapshot, type wire, type FileRef} from "@mdbase-dev/sdk";
import {JournalDrafts, type JournalDraft} from "./drafts.js";
export const JOURNAL_CONTRACT = Object.freeze({id: "journal.entry", version: "0.1.0", digest: "sha256:7e95bdf03621919fb0e722e5a29b48a68d7a4eaa3a94aea033d96ea2f7ec34cc"});
export interface JournalEntryType {readonly name: string; readonly createdField: string}
/** Only current canonical catalog bindings, never the starter type name. */
export function journalEntryTypes(catalog: wire.DescribeResult): JournalEntryType[] {
  const contract = catalog.contracts.filter(c => c.id === JOURNAL_CONTRACT.id && c.version === JOURNAL_CONTRACT.version && c.digest === JOURNAL_CONTRACT.digest);
  if (contract.length !== 1) throw new Error("This collection does not provide the required Journal contract.");
  const types: JournalEntryType[] = [];
  for (const type of catalog.types) {
    const implementations = type.implements.filter(i => i.contract === JOURNAL_CONTRACT.id && i.version === JOURNAL_CONTRACT.version);
    if (implementations.length > 1) throw new Error("This collection has an ambiguous Journal type binding.");
    const field = implementations[0]?.fields.get("created");
    if (field === undefined) continue;
    // The native public create API accepts top-level fields. Do not implement a
    // second field-reference parser or silently write a dotted literal key.
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) throw new Error("This Journal type needs field-reference support in the shared SDK.");
    if (types.some(existing => existing.name === type.name)) throw new Error("This collection has an ambiguous Journal type name.");
    types.push(Object.freeze({name: type.name, createdField: field}));
  }
  if (!types.length) throw new Error("This collection has no Journal entry type.");
  return types;
}
/** A readable original record: confirmed, or kept on this device while the SDK
 * write ledger settles it. Never a protected or inconsistent readback. */
function currentRecord(record: wire.RecordView, id: string): void {
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
  private disposed = false;
  constructor(readonly connection: MdbaseApplicationConnection, private readonly drafts: JournalDrafts) {
    if (connection.files !== connection.records.files || connection.id !== connection.records.collection) throw new Error("Journal must use the original collection client.");
  }
  subscribe(listener: () => void): () => void {this.listeners.add(listener); return () => this.listeners.delete(listener);}
  private notify(): void {for (const listener of this.listeners) listener();}
  private ensure(draft?: JournalDraft): void {
    this.caller.signal.throwIfAborted();
    if (draft?.legacyKey) throw new Error("This earlier note needs its original save reviewed. Your text is still on this device.");
    if (this.disposed || !this.connection.isCurrent()) throw new Error("This collection has changed. Your text is still on this device.");
    if (draft?.targetCollectionId && draft.targetCollectionId !== this.connection.id) throw new Error("This note belongs to another collection.");
    const attempt = draft?.createAttempt;
    if (attempt && (attempt.account !== this.connection.scope.account || attempt.installation !== this.connection.scope.installation)) throw new Error("This note belongs to its original signed-in device.");
  }
  async types(): Promise<JournalEntryType[]> {
    this.ensure();
    const catalog = await this.connection.records.describe(this.caller.signal);
    this.ensure();
    return journalEntryTypes(catalog);
  }
  async open(id: string, type: JournalEntryType): Promise<RecordLease> {
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
  private async acquire(id: string, type: JournalEntryType): Promise<RecordLease> {
    let draft = this.drafts.get(id);
    if (!draft || !draft.path || !draft.body.trim()) throw new Error("Write something before saving this page.");
    this.ensure(draft);
    if (!draft.targetCollectionId) draft = this.drafts.patch(id, {targetCollectionId: this.connection.id});
    if (!draft.recordId) {
      if (!draft.createAttempt) {
        const path = draft.path;
        if (!path) throw new Error("The original note path is missing.");
        // Persist both original identities and exact intent BEFORE any capture.
        draft = this.drafts.patch(id, {createAttempt: {mutationId: uuidv7(), recordId: uuidv7(), body: draft.body,
          typeName: type.name, createdField: type.createdField, path, created: draft.created,
          account: this.connection.scope.account, installation: this.connection.scope.installation}});
        const attempt = draft.createAttempt!;
        const result = await this.connection.records.save(this.connection.records.create({id: attempt.recordId, path: attempt.path, type: attempt.typeName,
          frontmatter: {[attempt.createdField]: attempt.created}, body: attempt.body}, {mutationId: attempt.mutationId, signal: this.caller.signal}), {signal: this.caller.signal});
        this.ensure(draft);
        // A refusal is definite: nothing was created, so the next save starts a new intent.
        if (result.outcome === "rejected") {
          this.drafts.patch(id, {createAttempt: null});
          throw new Error(result.problem?.message ?? "mdbase refused this note. Your text is still on this device.");
        }
      }
      // Confirmed or kept on this device: the SDK write ledger settles it. Read the
      // ORIGINAL record by its pinned ID; creation is never resubmitted.
      const attempt = draft.createAttempt!;
      const record = await this.connection.records.get(attempt.recordId, {body: true, document: true, effective: true}, this.caller.signal)
        .catch(() => {throw new Error("Keep this page open while its original save is unresolved.");});
      this.ensure(draft); currentRecord(record, attempt.recordId);
      if (record.body !== attempt.body) throw new Error("The original saved note has changed. Your local text has been preserved.");
      draft = this.drafts.patch(id, {recordId: attempt.recordId, savedBody: record.state.state === "confirmed" ? attempt.body : null});
    }
    // An unconfirmed write from an earlier visit is in the SDK write ledger; the record stays editable.
    const lease = await this.connection.records.records.open(draft.recordId!, {signal: this.caller.signal, autosave: {idleMs: 1200}});
    try {
      this.ensure(draft);
      const snapshot = lease.session.getSnapshot();
      if (snapshot.state === "saved" && snapshot.body !== draft.savedBody && draft.body !== snapshot.body) throw new Error("This note changed elsewhere. Your local text has been preserved.");
      const unsubscribe = lease.session.subscribe(() => {
        if (this.disposed || !this.connection.isCurrent() || this.problems.has(id)) return;
        try {
          const value = lease.session.getSnapshot();
          if (value.state === "saved" && !value.dirty) this.drafts.patch(id, {savedBody: value.body});
        } catch {this.problems.set(id, "Keep this page open: Journal cannot preserve the original save outcome on this device.");}
        this.notify();
      });
      this.unsubscriptions.set(id, unsubscribe);
      this.leases.set(id, lease);
      const latest = this.drafts.get(id);
      if (!latest) throw new Error("The original local draft is missing. Keep this page open.");
      this.ensure(latest);
      if (snapshot.state === "saved" || snapshot.state === "saved_on_device" || snapshot.state === "unsaved") lease.session.setBody(latest.body);
      if (this.problems.has(id)) throw new Error(this.problems.get(id));
      return lease;
    } catch (error) {
      this.unsubscriptions.get(id)?.(); this.unsubscriptions.delete(id); this.leases.delete(id);
      lease.release(); throw error;
    }
  }
  setBody(id: string, body: string): void {
    const draft = this.drafts.patch(id, {body, touchedMs: Date.now()});
    this.ensure(draft);
    if (this.problems.has(id)) throw new Error(this.problems.get(id));
    this.leases.get(id)?.session.setBody(body);
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
  release(): void {
    if (this.disposed) return;
    this.disposed = true; this.caller.abort();
    for (const unsubscribe of this.unsubscriptions.values()) unsubscribe();
    this.unsubscriptions.clear();
    for (const lease of this.leases.values()) lease.release();
    this.leases.clear(); this.listeners.clear(); this.problems.clear();
    for (const unpin of this.unpins.values()) unpin(); this.unpins.clear();
    // Borrowed clients and SDK singleton are never closed by a writing view.
  }
}
