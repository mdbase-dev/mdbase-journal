export interface CreateAttempt {
  readonly mutationId: string;
  readonly recordId: string;
  readonly body: string;
  readonly typeName: string;
  readonly createdField: string;
  readonly path: string;
  readonly created: string;
  readonly account: string;
  readonly installation: string;
}
export interface JournalDraft {
  readonly id: string;
  readonly created: string;
  readonly createdMs: number;
  body: string;
  path: string | null;
  targetCollectionId: string | null;
  recordId: string | null;
  savedBody: string | null;
  createAttempt: CreateAttempt | null;
  recovery: {mutationId: string; recordId: string; baseRevision: string | null} | null;
  finished: boolean;
  touchedMs: number;
  /** Prototype text has no original native capture identity. Import is local only. */
  legacyKey?: string;
}
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const prefix = "journal.native.note.";
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function validDraft(value: unknown): value is JournalDraft {
  if (!object(value) || !uuid(value.id) || typeof value.created !== "string" || !Number.isFinite(Date.parse(value.created)) || !Number.isFinite(value.createdMs) ||
      typeof value.body !== "string" || value.body.length > 4 * 1024 * 1024 || !textOrNull(value.path) || !textOrNull(value.targetCollectionId) ||
      !textOrNull(value.recordId) || !textOrNull(value.savedBody) || typeof value.finished !== "boolean" || !Number.isFinite(value.touchedMs)) return false;
  if (value.legacyKey !== undefined && (typeof value.legacyKey !== "string" || !value.legacyKey.startsWith("journal.note.") || value.legacyKey.length > 1024 || value.createAttempt !== null || value.recordId !== null || value.recovery !== null)) return false;
  const attempt = value.createAttempt;
  if (attempt !== null && (!object(attempt) || ["body", "typeName", "createdField", "path", "created", "account", "installation"].some(key => typeof attempt[key] !== "string") ||
      !uuid(attempt.mutationId) || !uuid(attempt.recordId) || attempt.created !== value.created || attempt.path !== value.path || !value.targetCollectionId)) return false;
  if (value.recordId !== null && (!object(attempt) || value.recordId !== attempt.recordId)) return false;
  if (value.savedBody !== null && value.recordId === null) return false;
  const recovery = value.recovery;
  return recovery === null || (object(recovery) && uuid(recovery.mutationId) && recovery.recordId === value.recordId && value.recordId !== null && textOrNull(recovery.baseRevision));
}
export class DraftPersistenceError extends Error {
  constructor() {super("Keep this page open: Journal cannot preserve its text on this device.");}
}
/** Local writing is independent of registration and native readiness. Failed
 * persistence is never permission to capture a remote write or clear text. */
export interface JournalPreferences {
  folder: string;
  theme: "system" | "light" | "dark";
  entryTypes?: Record<string, string>;
}
export class JournalDrafts {
  private readonly pins = new Map<string, number>();
  constructor(private readonly storage: DraftStorage, private readonly limits = {maxBytes: 3 * 1024 * 1024, maxDrafts: 256}) {}
  pin(id: string): () => void {
    this.pins.set(id, (this.pins.get(id) ?? 0) + 1);
    let released = false;
    return () => {if (released) return; released = true; const count = (this.pins.get(id) ?? 1) - 1; if (count) this.pins.set(id, count); else this.pins.delete(id);};
  }
  preferences(): JournalPreferences {
    try {
      const parse = (bytes: string | null): unknown => {try {return JSON.parse(bytes ?? "null");} catch {return null;}};
      const modern = parse(this.storage.getItem("journal.prefs.v2"));
      const oldBytes = object(modern) ? null : this.storage.getItem("journal.prefs.v1");
      const value = object(modern) ? modern : parse(oldBytes);
      const preferences: JournalPreferences = {folder: object(value) && typeof value.folder === "string" ? value.folder : "journal",
        theme: object(value) && (value.theme === "light" || value.theme === "dark") ? value.theme : "system"};
      if (object(value) && object(value.entryTypes)) preferences.entryTypes = Object.fromEntries(Object.entries(value.entryTypes)
        .filter(([id, type]) => id.length <= 200 && typeof type === "string" && type.length <= 200).slice(-64)) as Record<string, string>;
      if (!object(modern) && oldBytes !== null) {
        try {this.savePreferences(preferences);} catch {/* Keep legacy choices in RAM; retry migration after storage recovers. */}
      }
      return preferences;
    } catch { /* Defaults are writing preferences, never native authority. */ }
    return {folder: "journal", theme: "system"};
  }
  savePreferences(preferences: JournalPreferences): void {
    try {const bytes = JSON.stringify(preferences); this.bound("journal.prefs.v2", bytes); this.storage.setItem("journal.prefs.v2", bytes);
      if (this.storage.getItem("journal.prefs.v2") !== bytes) throw new DraftPersistenceError();} catch {throw new DraftPersistenceError();}
  }
  get(id: string): JournalDraft | null {
    try {
      const bytes = this.storage.getItem(prefix + id);
      if (!bytes) return null;
      const data: unknown = JSON.parse(bytes);
      if (!validDraft(data) || data.id !== id) return null;
      return data;
    } catch {return null;}
  }
  put(draft: JournalDraft): JournalDraft {
    if (!validDraft(draft)) throw new DraftPersistenceError();
    const bytes = JSON.stringify(draft);
    try {
      this.bound(prefix + draft.id, bytes);
      this.storage.setItem(prefix + draft.id, bytes);
      if (this.storage.getItem(prefix + draft.id) !== bytes) throw new DraftPersistenceError();
    } catch {throw new DraftPersistenceError();}
    return draft;
  }
  private canPrune(draft: JournalDraft, now: number): boolean {
    return !this.pins.has(draft.id) && draft.finished && !!draft.recordId && !draft.recovery && !draft.legacyKey &&
      draft.body === draft.savedBody && draft.touchedMs <= now - 6 * 60 * 60 * 1000;
  }
  /** Reclaim old confirmed copies on a new visit, before hitting a quota.
   * Unresolved writing and borrowed leases stay protected by the same rule. */
  pruneConfirmed(now = Date.now()): number {
    let removed = 0;
    for (const draft of this.list()) {
      const key = prefix + draft.id, bytes = this.storage.getItem(key), current = this.get(draft.id);
      if (!current || !this.canPrune(current, now) || this.storage.getItem(key) !== bytes) continue;
      this.storage.removeItem(key);
      if (this.storage.getItem(key) !== null) throw new DraftPersistenceError();
      removed++;
    }
    return removed;
  }
  /** Evict only old, finished, confirmed native copies, never writing/recovery
   * text, imported text, pinned SDK leases, or another application's storage. */
  private bound(key: string, bytes: string): void {
    const entries = new Map<string, string>();
    for (let i = 0; i < this.storage.length; i++) {
      const name = this.storage.key(i);
      if (name?.startsWith("journal.")) entries.set(name, this.storage.getItem(name) ?? "");
    }
    entries.set(key, bytes);
    const size = () => [...entries].reduce((total, [name, value]) => total + 2 * (name.length + value.length), 0);
    const count = () => [...entries.keys()].filter(name => name.startsWith(prefix)).length;
    if (size() <= this.limits.maxBytes && count() <= this.limits.maxDrafts) return;
    for (const draft of this.list().sort((a, b) => a.touchedMs - b.touchedMs)) {
      if (draft.id === key.slice(prefix.length) || !this.canPrune(draft, Date.now())) continue;
      const name = prefix + draft.id;
      if (this.storage.getItem(name) !== entries.get(name)) continue;
      this.storage.removeItem(name);
      if (this.storage.getItem(name) !== null) throw new DraftPersistenceError();
      entries.delete(name);
      if (size() <= this.limits.maxBytes && count() <= this.limits.maxDrafts) return;
    }
    throw new DraftPersistenceError();
  }
  patch(id: string, patch: Partial<JournalDraft>): JournalDraft {
    const draft = this.get(id);
    if (!draft) throw new DraftPersistenceError();
    return this.put({...draft, ...patch, id: draft.id});
  }
  list(): JournalDraft[] {
    const result: JournalDraft[] = [];
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const draft = this.get(key.slice(prefix.length));
        if (draft) result.push(draft);
      }
    } catch {throw new DraftPersistenceError();}
    return result.sort((a, b) => a.createdMs - b.createdMs);
  }
  blank(collectionId: string | null, now = new Date()): JournalDraft {
    return {id: crypto.randomUUID(), created: localIso(now), createdMs: now.getTime(), body: "", path: null,
      targetCollectionId: collectionId, recordId: null, savedBody: null, createAttempt: null, recovery: null,
      finished: false, touchedMs: now.getTime()};
  }
  create(collectionId: string | null, now = new Date()): JournalDraft {
    return this.put(this.blank(collectionId, now));
  }
  /** Import pending prototype writing once per source key. Original bytes and
   * destination survive; missing native identities never become new writes. */
  importLegacy(): void {
    const imported = new Set(this.list().flatMap(draft => draft.legacyKey ? [draft.legacyKey] : []));
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {const key = this.storage.key(i); if (key?.startsWith("journal.note.")) keys.push(key);}
    let failed = false;
    for (const key of keys) {
      if (imported.has(key)) continue;
      let value: unknown;
      try {value = JSON.parse(this.storage.getItem(key) ?? "null");} catch {continue;}
      if (!object(value) || typeof value.body !== "string" || !value.body.trim() || value.body === value.savedBody) continue;
      const legacyMs = typeof value.createdMs === "number" && Number.isFinite(value.createdMs) && Number.isFinite(new Date(value.createdMs).getTime()) ? value.createdMs : null;
      const date = typeof value.created === "string" && Number.isFinite(Date.parse(value.created)) ? new Date(value.created) :
        legacyMs !== null ? new Date(legacyMs) : new Date();
      const draft = this.blank(typeof value.targetCollectionId === "string" ? value.targetCollectionId : typeof value.createdIn === "string" ? value.createdIn : null, date);
      if (uuid(value.id) && this.storage.getItem(prefix + value.id) === null) Object.assign(draft, {id: value.id});
      try {
        this.put({...draft, body: value.body, path: typeof value.path === "string" ? value.path : null,
          created: typeof value.created === "string" && Number.isFinite(Date.parse(value.created)) ? value.created : draft.created,
          createdMs: legacyMs ?? draft.createdMs,
          touchedMs: typeof value.touchedMs === "number" && Number.isFinite(value.touchedMs) ? value.touchedMs : draft.touchedMs,
          finished: true, legacyKey: key});
        imported.add(key);
      } catch {failed = true;}
    }
    if (failed) throw new DraftPersistenceError();
  }
  legacyPendingCount(): number {
    let count = 0;
    try {
      const imported = new Set(this.list().flatMap(draft => draft.legacyKey ? [draft.legacyKey] : []));
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (!key?.startsWith("journal.note.") || imported.has(key)) continue;
        let data: unknown;
        try {data = JSON.parse(this.storage.getItem(key) ?? "null");} catch {continue;}
        if (object(data) && typeof data.body === "string" && data.body.trim() && data.savedBody !== data.body) count++;
      }
    } catch { /* Preserve original legacy storage, including malformed entries. */ }
    return count;
  }
}
const pad = (n: number) => String(n).padStart(2, "0");
export function localIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
/** A recognisable local date-time name (`2026-10-12 18.57 efe038.md`). The
 * short suffix comes from the draft's random identity, so pages started in the
 * same minute get distinct paths up front and creation never retries a sibling. */
export function notePath(date: Date, folder: string, draftId?: string): string {
  if (draftId !== undefined && !uuid(draftId)) throw new Error("The original local note identity is missing.");
  const root = folder.trim().replace(/^\/+|\/+$/g, "");
  if (root.split("/").some(part => part === "." || part === "..") || /[\u0000-\u001f\u007f\\]/.test(root)) throw new Error("Choose a folder within this collection.");
  return `${root ? root + "/" : ""}${date.getFullYear()}/${pad(date.getMonth() + 1)}/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}${draftId ? ` ${draftId.slice(0, 6).toLowerCase()}` : ""}.md`;
}
