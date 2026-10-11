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
export class JournalDrafts {
  constructor(private readonly storage: DraftStorage) {}
  preferences(): {folder: string; theme: "system" | "light" | "dark"} {
    try {
      const value: unknown = JSON.parse(this.storage.getItem("journal.prefs.v1") ?? "null");
      if (object(value)) return {folder: typeof value.folder === "string" ? value.folder : "journal",
        theme: value.theme === "light" || value.theme === "dark" ? value.theme : "system"};
    } catch { /* Defaults are writing preferences, never native authority. */ }
    return {folder: "journal", theme: "system"};
  }
  savePreferences(preferences: {folder: string; theme: "system" | "light" | "dark"}): void {
    try {this.storage.setItem("journal.prefs.v1", JSON.stringify(preferences));} catch {throw new DraftPersistenceError();}
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
      this.storage.setItem(prefix + draft.id, bytes);
      if (this.storage.getItem(prefix + draft.id) !== bytes) throw new DraftPersistenceError();
    } catch {throw new DraftPersistenceError();}
    return draft;
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
  /** Older prototype drafts are left byte-for-byte intact. They lack original
   * native write identities, so this port never silently retries/migrates them. */
  legacyPendingCount(): number {
    let count = 0;
    try {
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (!key?.startsWith("journal.note.")) continue;
        const data: unknown = JSON.parse(this.storage.getItem(key) ?? "null");
        if (data && typeof data === "object" && "body" in data && typeof data.body === "string" && data.body.trim() && (!("savedBody" in data) || data.savedBody !== data.body)) count++;
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
export function notePath(date: Date, folder: string): string {
  const root = folder.trim().replace(/^\/+|\/+$/g, "");
  if (root.split("/").some(part => part === "." || part === "..") || /[\u0000-\u001f\u007f\\]/.test(root)) throw new Error("Choose a folder within this collection.");
  return `${root ? root + "/" : ""}${date.getFullYear()}/${pad(date.getMonth() + 1)}/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}.md`;
}
