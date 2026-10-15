import {describeError, type Mdbase, type MdbaseErrorDescription, type MdbaseSnapshot} from "@mdbase-dev/sdk";
import {mountCollectionUi, type MountedCollectionUi} from "@mdbase-dev/ui/collections";
import {journalConnection} from "./application.js";
import {DraftConflictError, DraftPersistenceError, draftRevision, JournalDrafts, notePath, type JournalDraft} from "./drafts.js";
import {JournalData, type JournalEntry, type JournalEntryType} from "./journal-data.js";
import {DraftOpens} from "./draft-opens.js";
import {connectionNotice, connectionNoticeLabels} from "./connection-notice.js";
export interface JournalView {dispose(): void; currentDraft(): JournalDraft; newPage(): void; undoNewPage(): void}
const app = {name: "Journal"};
/** Writing over the page's one mdbase entry. Local text never depends on sign-in.
 * The shared collection UI owns sign-in, the collection list, setup, problems and
 * sign-out (settings panel and header switcher); the view only releases its
 * subscriptions and borrowed record leases. */
export function mountJournal(document: Document, drafts: JournalDrafts, mdbase: Mdbase | null): JournalView {
  const element = <T extends HTMLElement>(id: string): T => {
    const value = document.querySelector<T>(`#${id}`);
    if (!value) throw new Error(`Journal is missing ${id}`);
    return value;
  };
  const page = element<HTMLTextAreaElement>("page");
  const menu = element<HTMLDialogElement>("menu");
  const typeChoice = element<HTMLSelectElement>("entry-type");
  const status = element("status");
  const pending = element("pending-count");
  const switcherHost = element("collection-switcher");
  const caller = new (document.defaultView?.AbortController ?? AbortController)();
  let data: JournalData | null = null;
  let opens: DraftOpens | null = null;
  let unlistenData: (() => void) | null = null;
  let unlistenStatus: (() => void) | null = null;
  let actionProblem: MdbaseErrorDescription | null = null;
  let types: JournalEntryType[] = [];
  let type: JournalEntryType | null = null;
  let problem: string | null = null;
  let disposed = false;
  let undoId: string | null = null;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let memoryOnly = false;
  let unpersistedDraft = true;
  let pendingInputs = 0;
  let inputEpoch = 0;
  let displayedRecordRevision: string | null = null;
  let conflicted = false;
  const retrying = new Set<string>();
  const preferences = drafts.preferences();
  let folder = preferences.folder;
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, {granularity: "word"}) : null;
  let observedCollectionId = mdbase?.getSnapshot().selectedCollectionId ?? null;
  let current = drafts.blank(observedCollectionId);
  try {
    const earlier = drafts.list().filter(draft => !draft.legacyKey && draft.body.trim() && (!observedCollectionId || draft.targetCollectionId === observedCollectionId))
      .sort((a, b) => Number(a.finished) - Number(b.finished) || b.touchedMs - a.touchedMs)[0];
    if (earlier) current = drafts.patch(earlier.id, {finished: false});
    unpersistedDraft = !earlier;
  } catch {problem = "Earlier notes could not be read on this device. Their text is still preserved.";}
  const entriesDialog = element<HTMLDialogElement>("entries"), entryDate = element<HTMLInputElement>("entry-date");
  let entries: JournalEntry[] = [];
  let entriesProblem: string | null = null;
  let entriesLoading = false;
  const dateKey = (ms: number): string => {const date = new Date(ms); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;};
  try {drafts.pruneConfirmed();} catch {/* Best-effort cleanup never interrupts local writing. */}
  try {drafts.importLegacy();} catch {problem = "Earlier notes could not be copied on this device. Their original text is still preserved.";}
  const listen = (target: EventTarget, name: string, handler: EventListener) => target.addEventListener(name, handler, {signal: caller.signal});
  const snapshot = (): MdbaseSnapshot | null => mdbase?.getSnapshot() ?? null;
  // Shared collection UI. Without an SDK (a writing-only build) neither is mounted.
  const mounted: MountedCollectionUi[] = mdbase ? [
    mountCollectionUi(element("collection-panel"), {part: "panel", mdbase, app}),
    mountCollectionUi(switcherHost, {part: "switcher", variant: "compact", mdbase, app}),
  ] : [];
  if (!mdbase) element("collection-row").hidden = true;
  /** Only a genuine recovery (an original write whose outcome is unknown) offers
   * Retry; writes kept on this device settle on their own. */
  const recovering = (id: string): boolean => !memoryOnly && data?.snapshot(id)?.state === "recovery" && !data.problem(id);
  function retry(id: string): void {
    const owned = data;
    if (!owned || disposed || retrying.has(id) || !recovering(id)) return;
    retrying.add(id); render();
    // Settles the original write through its session; nothing is created again.
    void owned.flush(id).catch(() => {/* The session keeps its recovery state and problem. */})
      .finally(() => {retrying.delete(id); render();});
  }
  function retryButton(button: HTMLButtonElement, id: string): void {
    button.textContent = retrying.has(id) ? "Retrying…" : "Retry saving";
    button.disabled = retrying.has(id);
  }
  function transaction(operation: () => void): void {
    void drafts.mutate(operation).catch(() => {problem = "Keep this page open: Journal cannot preserve its text on this device."; render();});
  }
  function clearUndo(): void {undoId = null; if (undoTimer !== null) clearTimeout(undoTimer); undoTimer = null;}
  let renderedDraftId = current.id;
  function renderPage(): void {
    if (renderedDraftId !== current.id) conflicted = false;
    renderedDraftId = current.id;
    displayedRecordRevision = data?.snapshot(current.id)?.record.revision ?? null;
    page.value = current.body;
    page.style.height = "auto";
    page.style.height = `${Math.max(240, page.scrollHeight)}px`;
    document.body.classList.remove("quiet");
    element("when").textContent = new Date(current.createdMs).toLocaleString(undefined, {weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit"});
  }
  function render(): void {
    if (disposed) return;
    if (!memoryOnly && !pendingInputs) {
      const latest = drafts.get(current.id);
      if (latest) {
        const changedBody = latest.body !== current.body;
        current = latest;
        if (changedBody) {
          const start = page.selectionStart, end = page.selectionEnd, atEnd = start === end && end === page.value.length;
          renderPage();
          page.setSelectionRange(atEnd ? page.value.length : Math.min(start, page.value.length), atEnd ? page.value.length : Math.min(end, page.value.length));
        }
      }
    }
    const observed = data?.snapshot(current.id);
    if (observed && observed.body === page.value) displayedRecordRevision = observed.record.revision;
    conflicted = conflicted || current.reviewRequired === true || observed?.state === "conflict";
    element("draft-conflict").hidden = !conflicted;
    element<HTMLButtonElement>("use-saved-version").disabled = current.reviewRequired === true && !data;
    if (entriesDialog.open) renderEntries();
    document.body.classList.toggle("typing", !!current.body.trim());
    const state = snapshot();
    const phase = state?.phase ?? null;
    const name = phase && "collection" in phase ? phase.collection.displayName :
      phase && "displayName" in phase && phase.displayName ? phase.displayName : "your collection";
    const record = data?.snapshot(current.id);
    let unresolved: JournalDraft[] = [];
    try {unresolved = drafts.list().filter(draft => !!draft.body.trim() && draft.body !== draft.savedBody);} catch {problem = "Keep this page open: Journal cannot read its drafts on this device.";}
    let message = problem ?? data?.problem(current.id);
    const opening = opens?.state(current.id);
    if (!message && current.legacyKey) message = "Earlier note: review its original save. Your text stays on this device.";
    if (!message && opening?.state === "unresolved") message = "The original save is unresolved. Your text stays on this device.";
    if (!message && record && ["conflict", "recovery", "deleted", "error"].includes(record.state)) message = "Your text is on this device. Resolve its original save before continuing.";
    if (!message && actionProblem) message = actionProblem.title;
    if (!message && phase?.kind === "ready" && (phase.problem || state?.problem)) message = state?.sync?.text ?? phase.problem?.title ?? describeError(state)?.title;
    // Never "Saving…" or "Saved" while offline, reconnecting or holding changes on this device.
    const notice = connectionNotice(state, document.defaultView?.navigator.onLine ?? true);
    if (!message && notice) message = connectionNoticeLabels[notice];
    if (!message && opening) message = "Saving…";
    if (!message && record) {
      message = record.state === "saved" && current.body === current.savedBody ? "Saved" : record.state === "saving" ? "Saving…" :
        record.state === "saved_on_device" ? "Saved on this device; waiting for sync" : "On this device";
    }
    if (!message) message = !phase ? "On this device. Sign-in is unavailable in this build." :
      phase.kind === "unavailable" ? `On this device. ${phase.problem.title}. ${phase.problem.message}` :
      phase.kind === "authorizing" ? "Waiting for approval in the mdbase window…" :
      phase.kind === "opening" ? `Opening ${name}. Your text stays on this device.` :
      phase.kind === "needs_approval" ? "Approve the collection, or choose another. Your text stays on this device." :
      phase.kind === "needs_setup" ? `Set up Journal in ${name}` :
      phase.kind === "problem" ? `${phase.problem.title}. Your text stays on this device.` :
      phase.kind === "choosing" ? "Choose a collection. Your text stays on this device." :
      data ? "On this device" : "On this device. Sign in to save.";
    const warning = state?.saveWarning ? describeError(state.saveWarning) : null;
    status.textContent = warning ? `${message} · ${warning.message}` : message;
    status.setAttribute("role", problem ? "alert" : "status");
    // The button's own name: what pressing it does, then the current status.
    element("status-button").setAttribute("aria-label", `${problem && data ? "Save again" : "Journal settings"}. ${message}`);
    const other = unresolved.filter(draft => draft.targetCollectionId && draft.targetCollectionId !== state?.selectedCollectionId).length;
    const legacy = drafts.legacyPendingCount();
    pending.textContent = `${unresolved.length} note${unresolved.length === 1 ? "" : "s"} on this device${other ? `; ${other} waiting for another collection` : ""}${legacy ? `; ${legacy} earlier prototype note${legacy === 1 ? "" : "s"} preserved separately` : ""}`;
    element("pending-row").hidden = !unresolved.length && !legacy && !memoryOnly;
    const openId = phase?.kind === "ready" ? phase.collectionId : null;
    const details = element("pending-details");
    details.replaceChildren(...unresolved.map(draft => {
      const row = document.createElement("div"); row.className = "pending-entry";
      const text = document.createElement("small"), saving = opens?.state(draft.id), record = data?.snapshot(draft.id);
      const state = draft.legacyKey ? "Earlier note: original save needs review" :
        draft.targetCollectionId && draft.targetCollectionId !== openId ? "Waiting for its collection" :
        data?.problem(draft.id) ? "Original save needs attention" : saving?.state === "unresolved" ? "Original save unresolved" :
        saving?.state === "opening" || record?.state === "saving" ? "Saving…" :
        record && ["conflict", "recovery", "deleted", "error"].includes(record.state) ? "Original save needs attention" :
        record?.state === "saved_on_device" ? "Saved on this device; waiting for sync" : "On this device";
      text.textContent = `${new Date(draft.createdMs).toLocaleString()} — ${state}`; row.append(text);
      if (draft.id !== current.id && recovering(draft.id)) {
        const again = document.createElement("button"); again.type = "button"; retryButton(again, draft.id);
        again.onclick = () => retry(draft.id); row.append(again);
      }
      if (draft.id !== current.id) {
        const resume = document.createElement("button"); resume.type = "button"; resume.textContent = "Resume writing";
        resume.disabled = memoryOnly; resume.onclick = () => restoreDraft(draft.id); row.append(resume);
      }
      return row;
    }));
    // The header switcher appears once signed in; signing in starts in settings.
    switcherHost.hidden = !phase || ["starting", "signed_out", "unavailable", "closed"].includes(phase.kind);
    const option = (label: string, value: string) => {const item = document.createElement("option"); item.textContent = label; item.value = value; return item;};
    typeChoice.replaceChildren(option("Choose a type…", ""), ...types.map(item => option(item.name, item.name)));
    typeChoice.value = type?.name ?? "";
    element("type-row").hidden = types.length < 2;
    element("new-button").hidden = !current.body.trim();
    element("undo-button").hidden = !undoId;
    const retryCurrent = recovering(current.id), retryElement = element<HTMLButtonElement>("retry-button");
    retryElement.hidden = !retryCurrent; retryButton(retryElement, current.id);
    document.body.classList.toggle("retry", retryCurrent);
    element("menu-connection").textContent = openId ? `Notes save to ${name}.` : "Notes stay on this device until a collection is open.";
    document.body.classList.toggle("undo", !!undoId);
    element("keys").textContent = /Mac|iPhone|iPad/.test(document.defaultView?.navigator.platform ?? "") ? "⌘↩" : "Ctrl+↩";
    const words = segmenter ? [...segmenter.segment(current.body)].filter(item => item.isWordLike).length : current.body.match(/\S+/g)?.length ?? 0;
    element("word-count").textContent = `${words} word${words === 1 ? "" : "s"}`;
    element("word-count").hidden = words === 0;
  }
  function newPage(): void {transaction(() => {
    if (!current.body.trim()) {page.focus(); return;}
    if (memoryOnly) {problem = "Keep this page open: its text has not been preserved on this device."; render(); return;}
    const previous = current;
    try {
      const next = drafts.blank(snapshot()?.selectedCollectionId ?? null);
      drafts.patch(previous.id, {finished: true, touchedMs: Date.now()});
      current = next; unpersistedDraft = true;
      clearUndo(); undoId = previous.id;
      undoTimer = setTimeout(() => {clearUndo(); render();}, 8000);
      problem = null; renderPage(); render(); page.focus();
    } catch {current = previous; problem = "Keep this page open: Journal cannot preserve its text on this device."; render();}
  });}
  function undoNewPage(): void {transaction(() => {
    if (!undoId || current.body.trim()) return;
    const previous = drafts.get(undoId);
    if (!previous || previous.targetCollectionId !== snapshot()?.selectedCollectionId && snapshot()?.selectedCollectionId !== undefined) {clearUndo(); render(); return;}
    try {current = drafts.patch(previous.id, {finished: false}); unpersistedDraft = false; clearUndo(); renderPage(); render(); page.focus();}
    catch {problem = "Keep this page open: Journal cannot restore the previous draft safely."; render();}
  });}
  function restoreDraft(id: string): void {transaction(() => {
    if (disposed || memoryOnly) return;
    try {
      const earlier = drafts.get(id);
      if (!earlier) throw new DraftPersistenceError();
      if (current.body.trim()) drafts.patch(current.id, {finished: true, touchedMs: Date.now()});
      current = drafts.patch(id, {finished: false, touchedMs: Date.now()}); unpersistedDraft = false;
      clearUndo(); problem = null; renderPage(); save(); page.focus();
    } catch {problem = "Keep this page open: Journal cannot restore the earlier text safely."; render();}
  });}
  function visibleEntries(): {entry: JournalEntry; draft: JournalDraft | null}[] {
    const collection = snapshot()?.selectedCollectionId ?? current.targetCollectionId;
    const local = drafts.list().filter(draft => draft.targetCollectionId === collection && draft.body.trim());
    const rows = entries.filter(entry => !local.some(draft => draft.recordId === entry.id))
      .map(entry => ({entry, draft: null as JournalDraft | null}));
    rows.push(...local.map(draft => ({entry: {id: draft.id, created: draft.created, createdMs: draft.createdMs, path: draft.path ?? ""}, draft})));
    return rows.sort((a, b) => b.entry.createdMs - a.entry.createdMs);
  }
  function renderEntries(): void {
    let rows: ReturnType<typeof visibleEntries> = [];
    try {rows = visibleEntries().filter(row => !entryDate.value || dateKey(row.entry.createdMs) === entryDate.value);}
    catch {entriesProblem = "Earlier notes could not be read on this device.";}
    element("entries-status").textContent = entriesProblem ?? (entriesLoading ? "Loading entries…" : rows.length ? "" : "No entries on this date. Start a page below.");
    element("entry-list").replaceChildren(...rows.map(({entry, draft}) => {
      const button = document.createElement("button"); button.type = "button";
      const date = document.createElement("span"), summary = document.createElement("small");
      date.textContent = new Date(entry.createdMs).toLocaleString(undefined, {weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"});
      summary.textContent = draft?.body.trim().split("\n")[0]?.slice(0, 100) ?? entry.path.split("/").pop() ?? "Journal entry";
      button.append(date, summary); button.disabled = memoryOnly;
      button.onclick = () => {
        if (draft) {restoreDraft(draft.id); if (current.id === draft.id) entriesDialog.close(); return;}
        const owned = data;
        if (!owned || memoryOnly) return;
        button.disabled = true;
        void owned.resume(entry).then(value => {
          if (disposed || data !== owned) return;
          restoreDraft(value.id); if (current.id === value.id) entriesDialog.close();
        }, () => {if (!disposed && data === owned) {entriesProblem = "This entry could not be opened. Your current page is unchanged."; renderEntries();}});
      };
      return button;
    }));
  }
  function browse(date = ""): void {
    entryDate.value = date; entriesProblem = null; renderEntries();
    if (!entriesDialog.open) entriesDialog.showModal();
    const owned = data;
    if (!owned) return;
    entriesLoading = true; renderEntries();
    // The ready connection can arrive before its catalog. Its completion below
    // refreshes this sheet; never mistake that interval for an empty journal.
    if (!types.length) return;
    void owned.entries(types).then(value => {if (!disposed && data === owned) entries = value;}, () => {
      if (!disposed && data === owned) entriesProblem = "Saved entries could not be loaded. Notes on this device are still available.";
    }).finally(() => {if (!disposed && data === owned) {entriesLoading = false; renderEntries();}});
  }
  function startOnDate(date: Date): void {transaction(() => {
    if (memoryOnly || !Number.isFinite(date.getTime())) return;
    try {
      const next = drafts.blank(snapshot()?.selectedCollectionId ?? null, date);
      if (current.body.trim()) drafts.patch(current.id, {finished: true, touchedMs: Date.now()});
      current = next; unpersistedDraft = true;
      clearUndo(); problem = null; renderPage(); render(); page.focus();
    } catch {problem = "Keep this page open: Journal cannot preserve its text on this device."; render();}
  });}
  let navigatingDay = false;
  async function adjacentDay(offset: number): Promise<void> {
    if (navigatingDay || memoryOnly) return;
    const originalId = current.id, owned = data;
    const date = new Date(current.createdMs);
    date.setDate(date.getDate() + offset); date.setHours(12, 0, 0, 0);
    const destination = dateKey(date.getTime());
    const stillCurrent = (): boolean => !disposed && !memoryOnly && data === owned && current.id === originalId && !entriesDialog.open;
    navigatingDay = true;
    element<HTMLButtonElement>("previous-day").disabled = true;
    element<HTMLButtonElement>("next-day").disabled = true;
    try {
      if (owned) {
        const availableTypes = types.length ? types : await owned.types();
        const loaded = await owned.entries(availableTypes);
        if (!stillCurrent()) return;
        entries = loaded;
      }
      const row = visibleEntries().find(row => dateKey(row.entry.createdMs) === destination);
      if (row) {
        const earlier = row.draft ?? await owned?.resume(row.entry);
        if (!stillCurrent() || !earlier) return;
        restoreDraft(earlier.id);
      } else startOnDate(date);
    } catch {
      if (stillCurrent()) {problem = "This day could not be opened. Your current page is unchanged."; render();}
    } finally {
      navigatingDay = false;
      element<HTMLButtonElement>("previous-day").disabled = false;
      element<HTMLButtonElement>("next-day").disabled = false;
    }
  }
  listen(element("browse-button"), "click", () => browse());
  listen(element("previous-day"), "click", () => {void adjacentDay(-1);});
  listen(element("next-day"), "click", () => {void adjacentDay(1);});
  listen(entryDate, "input", renderEntries);
  listen(element("close-entries"), "click", () => entriesDialog.close());
  listen(entriesDialog, "close", () => page.focus());
  listen(element("write-date"), "click", () => {
    const originalId = current.id;
    startOnDate(entryDate.value ? new Date(`${entryDate.value}T12:00:00`) : new Date());
    if (current.id !== originalId) entriesDialog.close();
  });
  function save(): void {
    const owned = data, selectedType = type, queue = opens;
    if (!owned || !selectedType || !queue || disposed || memoryOnly) {render(); return;}
    try {
      for (const draft of drafts.list()) queue.request(draft.id, selectedType, draft.id === current.id);
    } catch {problem = "Keep this page open: Journal cannot read its drafts on this device.";}
    render();
  }
  function changed(): void {
    if (!mdbase || disposed) return;
    const selectedId = snapshot()?.selectedCollectionId ?? null;
    const selectionChanged = selectedId !== observedCollectionId;
    observedCollectionId = selectedId;
    const next = journalConnection(mdbase);
    if (next !== data?.connection) {
      unlistenData?.(); unlistenData = null; unlistenStatus?.(); unlistenStatus = null; opens?.dispose(); opens = null; data?.release(); data = null; types = []; type = null; actionProblem = null;
      entries = []; entriesLoading = false;
      if (next) {
        const owned = new JournalData(next, drafts); data = owned;
        opens = new DraftOpens(owned, drafts, () => !disposed && data === owned && owned.connection.isCurrent(), render);
        unlistenData = owned.subscribe(render);
        // A status push (back online, pending writes settled) is when a failed open can succeed.
        unlistenStatus = next.records.onStatus(save);
        void owned.types().then(value => {
          if (disposed || data !== owned) return;
          types = value; type = value.find(item => item.name === preferences.entryTypes?.[owned.connection.id]) ?? (value.length === 1 ? value[0]! : null);
          render(); void save();
          if (entriesDialog.open) browse(entryDate.value);
        }, error => {if (!disposed && data === owned) {
          actionProblem = describeError(error) ?? describeError("internal");
          entriesLoading = false; entriesProblem = "Saved entries could not be loaded. Notes on this device are still available."; render();
        }});
      }
    }
    if (!memoryOnly && selectionChanged && selectedId !== current.targetCollectionId) {
      clearUndo();
      try {
        if (!current.targetCollectionId && selectedId && !current.legacyKey) {
          current = unpersistedDraft ? {...current, targetCollectionId: selectedId} : drafts.patch(current.id, {targetCollectionId: selectedId});
        } else if (current.body.trim()) {
          const next = drafts.blank(selectedId);
          drafts.patch(current.id, {finished: true, touchedMs: Date.now()}); current = next; unpersistedDraft = true; renderPage();
        } else current = unpersistedDraft ? {...current, targetCollectionId: selectedId} : drafts.patch(current.id, {targetCollectionId: selectedId});
      } catch {memoryOnly = true; problem = "Keep this page open: Journal cannot preserve its text before changing collections.";}
    }
    render();
  }
  listen(page, "input", () => {
    clearUndo();
    const body = page.value, base = current, wasUnpersisted = unpersistedDraft, owned = data;
    const source = {body: base.body, revision: displayedRecordRevision}, epoch = ++inputEpoch;
    current = {...base, body, revision: draftRevision(body)};
    pendingInputs++;
    void drafts.mutate(() => {
      if (!drafts.get(base.id) && !wasUnpersisted) throw new DraftPersistenceError();
      const value = drafts.updateBody(base, body, base.path ?? (body.trim() ? notePath(new Date(base.createdMs), folder, base.id) : null));
      if (current.id === base.id && epoch === inputEpoch) {current = value; memoryOnly = false; unpersistedDraft = false; problem = null;}
      if (owned === data && owned?.snapshot(base.id)) {
        void owned.setBody(base.id, body, source).catch(error => {
          if (current.id === base.id) {conflicted = true; problem = error instanceof Error ? error.message : "Your original save needs review."; render();}
        });
      } else void save();
    }).catch(error => {
      if (current.id !== base.id || epoch !== inputEpoch) return;
      memoryOnly = true;
      conflicted = error instanceof DraftConflictError;
      problem = error instanceof Error ? error.message : "Keep this page open: Journal cannot preserve its text on this device.";
    }).finally(() => {pendingInputs--; render();});
    page.style.height = "auto"; page.style.height = `${Math.max(240, page.scrollHeight)}px`;
    document.body.classList.toggle("quiet", !!body.trim()); render();
  });
  listen(document, "keydown", event => {const key = event as KeyboardEvent; if ((key.ctrlKey || key.metaKey) && key.key === "Enter" && key.target === page && !document.querySelector("dialog[open]")) {key.preventDefault(); newPage();}});
  listen(element("new-button"), "click", newPage);
  listen(element("undo-button"), "click", undoNewPage);
  listen(element("retry-button"), "click", () => retry(current.id));
  function openMenu(): void {element<HTMLInputElement>("folder").value = folder; render(); menu.showModal();}
  listen(element("menu-button"), "click", openMenu);
  listen(element("close-menu"), "click", () => menu.close());
  listen(menu, "close", () => {
    const candidate = element<HTMLInputElement>("folder").value.trim() || "journal";
    try {notePath(new Date(), candidate); transaction(() => {drafts.savePreferences({...preferences, folder: candidate}); folder = candidate;});}
    catch {problem = "Choose a folder within this collection that Journal can preserve on this device."; render();}
    page.focus();
  });
  listen(typeChoice, "change", () => {
    type = types.find(item => item.name === typeChoice.value) ?? null;
    if (data && type) {
      preferences.entryTypes = Object.fromEntries(Object.entries({...preferences.entryTypes, [data.connection.id]: type.name}).slice(-64));
      try {transaction(() => drafts.savePreferences({...preferences, folder}));} catch {problem = "Journal could not preserve your entry type preference on this device.";}
    }
    save();
  });
  listen(element("status-button"), "click", () => {if (problem && data) void save(); else openMenu();});
  function applyTheme(): void {
    if (preferences.theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = preferences.theme;
    for (const button of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preferences.theme));
  }
  for (const button of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) listen(button, "click", () => {
    const theme = button.dataset.themeChoice;
    preferences.theme = theme === "light" || theme === "dark" ? theme : "system";
    try {transaction(() => drafts.savePreferences({...preferences, folder}));} catch {problem = "Journal could not preserve your theme preference.";}
    applyTheme(); render();
  });
  for (const name of ["pointermove", "wheel", "touchmove", "focusin"]) listen(document, name, () => document.body.classList.remove("quiet"));
  applyTheme();
  const unlistenApp = mdbase?.subscribe(() => transaction(changed)) ?? (() => {});
  if (document.defaultView) for (const name of ["online", "offline"]) listen(document.defaultView, name, render);
  listen(element("copy-conflicting-text"), "click", () => {
    const clipboard = document.defaultView?.navigator.clipboard;
    if (!clipboard) {page.focus(); page.select(); problem = "Your text is selected. Copy it before using the saved version."; render(); return;}
    void clipboard.writeText(page.value).then(() => {problem = "Text copied. You can now use the saved version."; render();}, () => {page.focus(); page.select(); problem = "Copy your selected text before using the saved version."; render();});
  });
  listen(element("use-saved-version"), "click", () => {
    const id = current.id, chosenEpoch = inputEpoch;
    const choose = (current.reviewRequired || data?.snapshot(id)?.state === "conflict") && data ? data.useSavedVersion(id) : drafts.mutate(() => drafts.get(id));
    void choose.then(value => {
      if (disposed || current.id !== id || inputEpoch !== chosenEpoch || !value) return;
      current = value; memoryOnly = false; conflicted = false; problem = null;
      renderPage(); render();
    }, error => {problem = error instanceof Error ? error.message : "The saved version could not be opened. Keep your text here."; render();});
  });
  if (document.defaultView) {
    listen(document.defaultView, "storage", event => {
      const key = (event as StorageEvent).key;
      if (key !== null && key !== `journal.native.note.${current.id}`) return;
      const before = current, owned = data, source = {body: current.body, revision: displayedRecordRevision};
      render();
      // Another tab's durable local edit can use this same original lease.
      // The displayed-source guard still refuses a changed native baseline.
      if (!memoryOnly && !pendingInputs && owned === data && before.id === current.id && before.body !== current.body && owned?.snapshot(current.id)) {
        void owned.setBody(current.id, current.body, source).catch(error => {
          conflicted = true; problem = error instanceof Error ? error.message : "Your original save needs review."; render();
        });
      }
    });
    listen(document.defaultView, "beforeunload", event => {
      if (memoryOnly || pendingInputs || current.reviewRequired) {event.preventDefault(); (event as BeforeUnloadEvent).returnValue = "";}
    });
  }
  // The shared panel starts the SDK; failures are on the snapshot, shown with their fix.
  renderPage(); changed(); render();
  return {currentDraft: () => current, newPage, undoNewPage, dispose() {
    if (disposed) return;
    disposed = true; caller.abort(); clearUndo(); unlistenApp(); unlistenData?.(); unlistenStatus?.(); opens?.dispose(); data?.release();
    for (const part of mounted) part.unmount();
    // No SDK replacement, physical close or borrowed-client shutdown on disposal.
  }};
}
