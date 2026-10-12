import {JournalDrafts} from "./drafts.js";
import type {JournalData, JournalEntryType} from "./journal-data.js";
export interface DraftOpenState {readonly state: "opening" | "unresolved"}
/** Independent acquisition of original SDK record leases. This is not autosave:
 * SDK sessions own edits/captures and the SDK write ledger settles unconfirmed
 * writes. A failed open is requested again by the next edit or status change. */
export class DraftOpens {
  private readonly jobs = new Set<string>();
  private readonly states = new Map<string, DraftOpenState>();
  private disposed = false;
  private notificationPending = false;
  constructor(private readonly data: JournalData, private readonly drafts: JournalDrafts,
    private readonly isCurrent: () => boolean, private readonly notify: () => void) {}
  state(id: string): DraftOpenState | null {return this.states.get(id) ?? null;}
  private changed(): void {
    if (this.notificationPending) return;
    this.notificationPending = true;
    queueMicrotask(() => {this.notificationPending = false; if (!this.disposed && this.isCurrent()) this.notify();});
  }
  request(id: string, type: JournalEntryType): void {
    if (this.disposed || !this.isCurrent()) return;
    const draft = this.drafts.get(id);
    if (!draft || draft.legacyKey || !draft.body.trim() || draft.body === draft.savedBody ||
        draft.targetCollectionId && draft.targetCollectionId !== this.data.connection.id || this.data.snapshot(id) || this.jobs.has(id)) return;
    this.jobs.add(id); this.states.set(id, {state: "opening"}); this.changed();
    void this.open(id, type);
  }
  private async open(id: string, type: JournalEntryType): Promise<void> {
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
    this.disposed = true; this.states.clear();
    // JournalData releases only its own borrowed leases; no client shutdown.
  }
}
