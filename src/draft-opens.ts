import {JournalDrafts} from "./drafts.js";
import type {JournalData, JournalEntryType} from "./journal-data.js";
export interface DraftOpenState {readonly state: "opening" | "unresolved"}
/** Independent acquisition of original SDK record leases. This is not autosave:
 * SDK sessions own edits/captures and the SDK write ledger settles unconfirmed
 * writes. A failed open is requested again by the next edit or status change. */
export class DraftOpens {
  private readonly jobs = new Set<string>();
  private readonly states = new Map<string, DraftOpenState>();
  private readonly owners = new Map<string, () => void>();
  private readonly waiting = new Set<string>();
  private readonly types = new Map<string, JournalEntryType | undefined>();
  private viewedId: string | null = null;
  private readonly caller = new AbortController();
  private disposed = false;
  private notificationPending = false;
  constructor(private readonly data: JournalData, private readonly drafts: JournalDrafts,
    private readonly isCurrent: () => boolean, private readonly notify: () => void, private readonly locks?: LockManager) {}
  owns(id: string): boolean {return this.owners.has(id);}
  retain(viewedId: string): void {
    this.viewedId = viewedId;
    for (const [id, release] of this.owners) {
      if (id === viewedId || this.jobs.has(id)) continue;
      const draft = this.drafts.get(id), record = this.data.snapshot(id);
      if (draft?.body === draft?.savedBody && (!record || record.state === "saved" && !record.dirty) ||
          draft?.reviewRequired && record?.state === "conflict") {
        this.data.close(id); this.owners.delete(id); release();
      }
    }
  }
  state(id: string): DraftOpenState | null {return this.states.get(id) ?? null;}
  private changed(): void {
    if (this.notificationPending) return;
    this.notificationPending = true;
    queueMicrotask(() => {this.notificationPending = false; if (!this.disposed && this.isCurrent()) this.notify();});
  }
  // Hold ownership for the lifetime of the SDK lease. Waiting tabs recover the
  // latest stored text when its owner closes, never a prefix captured on status.
  request(id: string, type?: JournalEntryType, viewed = false, edited = false): void {
    if (this.disposed || !this.isCurrent()) return;
    const draft = this.drafts.get(id);
    if (!draft || draft.legacyKey || !draft.body.trim() || draft.body === draft.savedBody && (!viewed || !draft.recordId) ||
        draft.targetCollectionId && draft.targetCollectionId !== this.data.connection.id || this.data.snapshot(id) || this.jobs.has(id)) return;
    this.types.set(id, type);
    if (!this.owns(id)) {
      if (this.locks) {
        if (this.waiting.has(id)) return;
        this.waiting.add(id);
        void this.locks.request(`journal.native.autosave.${id}`, {signal: this.caller.signal}, async () => {
          this.waiting.delete(id);
          if (this.disposed || !this.isCurrent()) return;
          await new Promise<void>(release => {
            this.owners.set(id, release);
            this.request(id, this.types.get(id), this.viewedId === id, edited);
            this.retain(this.viewedId ?? "");
          });
        }).catch(() => {this.waiting.delete(id);});
        return;
      }
      // Writing-only/test hosts have no cross-tab lock service. Passive
      // discovery is never sufficient to start an autosaving session there.
      if (!viewed && !edited) return;
      this.owners.set(id, () => {});
    }
    if (!type && !draft.recordId && !draft.createAttempt) return;
    this.jobs.add(id); this.states.set(id, {state: "opening"}); this.changed();
    void this.open(id, type);
  }
  private async open(id: string, type?: JournalEntryType): Promise<void> {
    try {
      await this.data.open(id, type);
      if (!this.disposed && this.isCurrent()) this.states.delete(id);
    } catch {
      if (!this.disposed && this.isCurrent()) this.states.set(id, {state: "unresolved"});
    } finally {
      this.jobs.delete(id);
      if (!this.disposed && this.isCurrent()) this.changed();
    }
  }
  dispose(): void {
    this.disposed = true; this.caller.abort(); this.states.clear();
    for (const release of this.owners.values()) release();
    this.owners.clear();
    // JournalData releases only its own borrowed leases; no client shutdown.
  }
}
