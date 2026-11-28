import {
  describeError,
  isMdbaseError,
  revisionOf,
  type Mdbase,
  type MdbaseApplicationConnection,
  type MdbaseSetupConflict,
  type MdbaseSetupPlan,
} from "@mdbase-dev/sdk";
import manifest from "../public/.well-known/mdbase-app.json";

export interface BundledSetupDefinition {
  readonly target: string;
  readonly kind: string;
  readonly mode: "managed" | "seed";
  readonly document: string;
}

interface ReviewedSetupDefinition extends BundledSetupDefinition {
  readonly reviewedRevision?: string;
}

export interface SetupConflictGuidance {
  readonly collectionId: string;
  readonly conflicts: readonly MdbaseSetupConflict[];
  readonly restorable: readonly ReviewedSetupDefinition[];
  readonly manualOnly: readonly MdbaseSetupConflict[];
  readonly canRestoreWithBackup: boolean;
  readonly backupFolder: string | null;
  readonly unavailableReason: "no_permission" | "no_backup" | "manual_only" | null;
}

export interface RestoredSetupDefinition {
  readonly target: string;
  readonly backupPath: string | null;
  readonly unchanged: boolean;
}

export interface RestoreSetupResult {
  readonly restored: readonly RestoredSetupDefinition[];
}

export interface RestoreSetupOptions {
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly suffix?: () => string;
}

const DEFAULT_BACKUP_FOLDER = "journal-setup-backups";

let cachedDefinitions: ReadonlyMap<string, BundledSetupDefinition> | null = null;

/** Journal's bundled setup definitions from its compiled app manifest, keyed by collection target path. */
export function bundledSetupDefinitions(): ReadonlyMap<string, BundledSetupDefinition> {
  if (cachedDefinitions) return cachedDefinitions;
  const map = new Map<string, BundledSetupDefinition>();
  for (const pack of manifest.provisions?.type_packs ?? []) {
    const documents = new Map(pack.resources.map(resource => [resource.source, resource.document]));
    for (const resource of pack.manifest.resources) {
      const document = documents.get(resource.source);
      if (typeof document !== "string") continue;
      map.set(resource.target, Object.freeze({
        target: resource.target,
        kind: resource.kind,
        mode: resource.mode === "seed" ? "seed" : "managed",
        document,
      }));
    }
  }
  cachedDefinitions = map;
  return map;
}

/** Collection folder where a non-record backup copy can safely live, or null when the grant forbids adding files. */
export function backupFolderFor(connection: MdbaseApplicationConnection | null): string | null {
  if (!connection || !connection.isCurrent()) return null;
  const grant = connection.files.grant;
  if (grant === null) return DEFAULT_BACKUP_FOLDER;
  if (!grant.actions.includes("add")) return null;
  if (grant.scope.kind === "collection") return DEFAULT_BACKUP_FOLDER;
  const allowed = grant.scope.folders.map(folder => folder.trim().replace(/^\/+|\/+$/g, "")).find(Boolean);
  return allowed ? `${allowed}/${DEFAULT_BACKUP_FOLDER}` : null;
}

/** Match a remapped target only when Core's review stages Journal's exact bytes there. */
export function inspectSetupConflicts(
  plan: MdbaseSetupPlan,
  collectionId: string,
  connection: MdbaseApplicationConnection | null,
  staged: MdbaseSetupPlan["staged"] = plan.staged,
): SetupConflictGuidance | null {
  if (plan.canApply || plan.conflicts.length === 0) return null;
  if (plan.refusal?.code === "installed_newer" || plan.refusal?.code === "setup_downgrade") return null;
  const conflicts = plan.conflicts;
  const bundled = bundledSetupDefinitions();
  const restorable: ReviewedSetupDefinition[] = [];
  const manualOnly: MdbaseSetupConflict[] = [];
  for (const conflict of conflicts) {
    const stagedDocument = staged.find(item => item.path === conflict.target)?.document;
    const definition = bundled.get(conflict.target) ?? [...bundled.values()].find(item => item.document === stagedDocument);
    const reviewedRevision = conflict.adoptable?.digest ?? (Object.hasOwn(plan.adoptable, conflict.target) ? plan.adoptable[conflict.target] : undefined);
    if (definition) restorable.push({...definition, target: conflict.target, ...(reviewedRevision ? {reviewedRevision} : {})});
    else manualOnly.push(conflict);
  }
  const live = connection !== null && connection.id === collectionId && connection.isCurrent();
  const canManage = live && plan.refusal?.code !== "setup_forbidden" && connection.records.hello.grant.capabilities.includes("definitions.manage");
  const backupFolder = live ? backupFolderFor(connection) : null;
  const canRestoreWithBackup = restorable.length > 0 && canManage && backupFolder !== null;
  const unavailableReason: SetupConflictGuidance["unavailableReason"] =
    restorable.length === 0 ? "manual_only"
      : !canManage ? "no_permission"
        : backupFolder === null ? "no_backup"
          : null;
  return Object.freeze({
    collectionId,
    conflicts: Object.freeze(conflicts),
    restorable: Object.freeze(restorable),
    manualOnly: Object.freeze(manualOnly),
    canRestoreWithBackup,
    backupFolder,
    unavailableReason,
  });
}

function formatUtcStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

/** Safe non-record, non-resource backup path (`.bak.txt` outside `_contracts/` / `_types/`). */
export function backupPathFor(
  target: string,
  now: Date = new Date(),
  backupFolder: string = DEFAULT_BACKUP_FOLDER,
  suffix?: string,
): string {
  const safeName = target
    .replace(/^[_/]+/, "")
    .replace(/\.md$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "") || "definition";
  const token = (suffix ?? (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID().slice(0, 6) : ""))
    .replace(/[^A-Za-z0-9_-]+/g, "");
  const folder = backupFolder.replace(/^\/+|\/+$/g, "") || DEFAULT_BACKUP_FOLDER;
  return `${folder}/${safeName}-${formatUtcStamp(now)}${token ? `-${token}` : ""}.bak.txt`;
}

function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Plain guidance explaining both automatic backup/restore (when supported) and resolving by hand. */
export function setupConflictGuidanceText(guidance: SetupConflictGuidance): string {
  const restorableNames = formatList(guidance.restorable.map(item => item.target));
  const manualNames = formatList(guidance.manualOnly.map(item => item.target));
  const byHand = restorableNames
    ? `To resolve by hand, open ${restorableNames} in your collection, copy any changes you want to keep elsewhere, restore Journal's original definition (or remove the file so setup can recreate it), then choose Try again.`
    : `To resolve by hand, update ${manualNames} in your collection so it matches what Journal needs, then choose Try again.`;
  if (guidance.canRestoreWithBackup) {
    const extra = manualNames
      ? ` You will still need to resolve ${manualNames} by hand.`
      : "";
    return `Journal can restore its version of ${restorableNames} and keep a backup copy of your edited file in ${guidance.backupFolder}/.${extra} ${byHand}`;
  }
  if (guidance.unavailableReason === "no_permission") {
    return `Journal doesn't have permission to restore ${restorableNames} automatically here. ${byHand}`;
  }
  if (guidance.unavailableReason === "no_backup") {
    return `Journal can't save a backup copy of ${restorableNames} in this collection with its current file access, so it won't overwrite your edits automatically. ${byHand}`;
  }
  return `${byHand}`;
}

export function restoreConfirmationText(result: RestoreSetupResult): string {
  const backedUp = result.restored.filter(item => !item.unchanged && item.backupPath !== null);
  const restoredOnly = result.restored.filter(item => !item.unchanged && item.backupPath === null);
  if (backedUp.length > 0) {
    const files = formatList(backedUp.map(item => item.target));
    const backups = formatList(backedUp.map(item => item.backupPath!));
    return `Restored ${files}. Your edited ${backedUp.length === 1 ? "copy was" : "copies were"} saved to ${backups}.`;
  }
  if (restoredOnly.length > 0) {
    return `Restored ${formatList(restoredOnly.map(item => item.target))}.`;
  }
  return "Journal's definitions already matched this version. Rechecking your collection.";
}

function errorDetail(error: unknown, fallback: string): string {
  const described = describeError(error);
  if (described && described.key !== "unknown" && described.key !== "internal") return described.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

/**
 * Back up each hand-edited definition into the collection's non-record file space,
 * then restore Journal's canonical definition using CAS (`baseRevision`).
 * Never overwrites a hand-edited file if saving its backup fails.
 */
export async function restoreSetupDefinitions(
  mdbase: Pick<Mdbase, "connection">,
  collectionId: string,
  definitions: readonly ReviewedSetupDefinition[],
  options: RestoreSetupOptions = {},
): Promise<RestoreSetupResult> {
  const connection = mdbase.connection(collectionId);
  if (!connection || connection.id !== collectionId || !connection.isCurrent()) {
    throw new Error("This collection is no longer open. Choose it again before restoring.");
  }
  if (!connection.records.hello.grant.capabilities.includes("definitions.manage")) {
    throw new Error("Journal doesn't have permission to restore definitions in this collection.");
  }
  const backupFolder = backupFolderFor(connection);
  if (!backupFolder) {
    throw new Error("Journal can't save a backup copy in this collection, so nothing was overwritten.");
  }
  const encoder = new TextEncoder();
  const now = options.now ?? (() => new Date());
  const readOptions = options.signal ? { signal: options.signal } : undefined;
  const restored: RestoredSetupDefinition[] = [];

  for (const canonical of definitions) {
    const {target, reviewedRevision} = canonical;
    options.signal?.throwIfAborted();
    let existing: { text: string; revision: string };
    try {
      const view = await connection.records.resources.get(target, readOptions);
      if (view.path !== target || typeof view.text !== "string" || revisionOf(view.text) !== view.revision) {
        throw new Error(`Could not read the current contents of ${target}, so Journal left your file unchanged.`);
      }
      existing = { text: view.text, revision: view.revision };
    } catch (error) {
      throw new Error(`Could not read ${target} before restoring: ${errorDetail(error, "nothing was changed.")}`);
    }
    if (!connection.isCurrent()) {
      throw new Error("This collection changed while restoring. Nothing further was changed.");
    }
    if (existing.text === canonical.document) {
      restored.push(Object.freeze({ target, backupPath: null, unchanged: true }));
      continue;
    }

    if (reviewedRevision && existing.revision !== reviewedRevision) {
      throw new Error(`${target} changed since setup was reviewed. Choose Try again to review the current file.`);
    }
    const backupPath = backupPathFor(target, now(), backupFolder, options.suffix?.());
    try {
      const upload = await connection.files.upload(backupPath, encoder.encode(existing.text), readOptions);
      await upload.confirmed;
    } catch (error) {
      throw new Error(
        `Could not save a backup copy of ${target} (${errorDetail(error, "backup failed")}), so Journal left your file unchanged.`,
      );
    }
    if (!connection.isCurrent()) {
      throw new Error(`This collection changed after saving your backup at ${backupPath}. Your original file was left unchanged.`);
    }

    try {
      const write = await connection.records.resources.put(
        target,
        canonical.document,
        { baseRevision: existing.revision, ...(options.signal ? { signal: options.signal } : {}) },
      );
      await write.confirmed;
    } catch (error) {
      const backupNote = ` Your backup copy was saved to ${backupPath}.`;
      if (isMdbaseError(error, "conflict")) {
        throw new Error(`${target} changed while restoring, so Journal didn't overwrite it.${backupNote} Try again.`);
      }
      throw new Error(`Could not restore ${target}: ${errorDetail(error, "restore failed")}.${backupNote}`);
    }

    restored.push(Object.freeze({ target, backupPath, unchanged: false }));
  }

  return Object.freeze({ restored: Object.freeze(restored) });
}
