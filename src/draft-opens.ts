import {JournalDrafts} from "./drafts.js";
import type {JournalData, JournalEntryType} from "./journal-data.js";
export interface DraftOpenState {readonly state: "opening" | "retrying"; readonly retryAfterMs?: number}
/** Independent acquisition of original SDK record leases. This is not autosave:
 * SDK sessions own edits/captures. After a create intent exists JournalData.open
 * only reads its original receipt; timers never replay an uncertain mutation. */
export class DraftOpens {
  private readonly jobs = new Set<string>();
  private readonly states = new Map<string, DraftOpenState>();
  private readonly attempts = new Map<string, number>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly types = new Map<string, JournalEntryType>();
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
    this.types.set(id, type);
    const draft = this.drafts.get(id);
    if (!draft || draft.legacyKey || !draft.body.trim() || draft.body === draft.savedBody ||
        draft.targetCollectionId && draft.targetCollectionId !== this.data.connection.id || this.data.snapshot(id) || this.jobs.has(id) || this.timers.has(id)) return;
    this.jobs.add(id); this.states.set(id, {state: "opening"}); this.changed();
    void this.open(id, type);
  }
  private async open(id: string, type: JournalEntryType): Promise<void> {
    try {
      await this.data.open(id, type);
      if (this.disposed || !this.isCurrent()) return;
      this.states.delete(id); this.attempts.delete(id);
    } catch {
      if (this.disposed || !this.isCurrent()) return;
      const attempt = (this.attempts.get(id) ?? 0) + 1;
      this.attempts.set(id, attempt);
      const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempt - 1, 6));
      this.states.set(id, {state: "retrying", retryAfterMs: delay});
      this.timers.set(id, setTimeout(() => {
        this.timers.delete(id);
        const selected = this.types.get(id);
        if (selected) this.request(id, selected);
      }, delay));
    } finally {
      this.jobs.delete(id);
      if (!this.disposed && this.isCurrent()) this.changed();
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.states.clear(); this.types.clear();
    // JournalData releases only its own borrowed leases; no client shutdown.
  }
}
