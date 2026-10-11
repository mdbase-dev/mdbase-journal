import {describeError, summarizeStatus, type MdbaseApplicationEntry, type MdbaseApplicationSnapshot, type MdbaseErrorDescription} from "@mdbase-dev/sdk";
import {journalConnection} from "./application.js";
import {DraftPersistenceError, JournalDrafts, notePath, type JournalDraft} from "./drafts.js";
import {JournalData, type JournalEntryType} from "./journal-data.js";
import {DraftOpens} from "./draft-opens.js";
export interface JournalView {dispose(): void; currentDraft(): JournalDraft; newPage(): void; undoNewPage(): void}
/** Typed presentation over the public singleton. Local text never depends on
 * sign-in; the view only releases its subscriptions and borrowed record leases. */
export function mountJournal(document: Document, drafts: JournalDrafts, entry: MdbaseApplicationEntry | null): JournalView {
  const element = <T extends HTMLElement>(id: string): T => {
    const value = document.querySelector<T>(`#${id}`);
    if (!value) throw new Error(`Journal is missing ${id}`);
    return value;
  };
  const page = element<HTMLTextAreaElement>("page");
  const menu = element<HTMLDialogElement>("menu");
  const choice = element<HTMLSelectElement>("collection-choice");
  const typeChoice = element<HTMLSelectElement>("entry-type");
  const status = element("status");
  const pending = element("pending-count");
  const caller = new (document.defaultView?.AbortController ?? AbortController)();
  const application = entry?.application() ?? null;
  let data: JournalData | null = null;
  let opens: DraftOpens | null = null;
  let unlistenData: (() => void) | null = null;
  let unlistenStatus: (() => void) | null = null;
  let actionProblem: MdbaseErrorDescription | null = null;
  let types: JournalEntryType[] = [];
  let type: JournalEntryType | null = null;
  let problem: string | null = null;
  let busy = false;
  let disposed = false;
  let undoId: string | null = null;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let memoryOnly = false;
  let unpersistedDraft = true;
  const preferences = drafts.preferences();
  let folder = preferences.folder;
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, {granularity: "word"}) : null;
  let observedCollectionId = application?.getSnapshot().selectedCollectionId ?? null;
  let current = drafts.blank(observedCollectionId);
  try {drafts.pruneConfirmed();} catch {/* Best-effort cleanup never interrupts local writing. */}
  try {drafts.importLegacy();} catch {problem = "Earlier notes could not be copied on this device. Their original text is still preserved.";}
  const listen = (target: EventTarget, name: string, handler: EventListener) => target.addEventListener(name, handler, {signal: caller.signal});
  const snapshot = (): MdbaseApplicationSnapshot | null => application?.getSnapshot() ?? null;
  function clearUndo(): void {undoId = null; if (undoTimer !== null) clearTimeout(undoTimer); undoTimer = null;}
  function renderPage(): void {
    page.value = current.body;
    page.style.height = "auto";
    page.style.height = `${Math.max(240, page.scrollHeight)}px`;
    document.body.classList.remove("quiet");
    element("when").textContent = new Date(current.createdMs).toLocaleString(undefined, {weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit"});
  }
  function render(): void {
    if (disposed) return;
    if (!memoryOnly) current = drafts.get(current.id) ?? current;
    document.body.classList.toggle("typing", !!current.body.trim());
    const state = snapshot();
    const selected = state?.selection.usable ?? null;
    const selection = state?.selection;
    const name = selected?.displayName ?? "your collection";
    const record = data?.snapshot(current.id);
    const description = actionProblem ?? describeError(state) ?? describeError(selection?.problem) ??
      (selection?.state === "blocked" ? describeError("unavailable") : null);
    const sync = data && state?.problem ? summarizeStatus(data.connection.records.status, state.problem) : null;
    let unresolved: JournalDraft[] = [];
    try {unresolved = drafts.list().filter(draft => !!draft.body.trim() && draft.body !== draft.savedBody);} catch {problem = "Keep this page open: Journal cannot read its drafts on this device.";}
    let message = problem ?? data?.problem(current.id);
    const opening = opens?.state(current.id);
    if (!message && current.legacyKey) message = "Earlier note: review its original save. Your text stays on this device.";
    if (!message && opening?.state === "retrying") message = "The original save is unresolved. Your text stays on this device; checking again.";
    if (!message && record && ["conflict", "recovery", "deleted", "error"].includes(record.state)) message = "Your text is on this device. Resolve its original save before continuing.";
    if (!message && description) message = sync?.text ?? description.title;
    if (!message && opening) message = "Saving…";
    if (!message && record) {
      message = record.state === "saved" && current.body === current.savedBody ? "Saved" : record.state === "saving" ? "Saving…" :
        ["conflict", "recovery", "deleted", "error"].includes(record.state) ? "Your text is on this device. Resolve its original save before continuing." : "On this device";
    }
    if (!message) message = !entry ? "On this device. Sign-in is unavailable in this build." :
      state?.problem === "application_not_yet_available" ? "On this device. Opening collections isn't available in this build yet." :
      selection?.state === "invalid" ? "The requested collection is invalid. Your text stays on this device." :
      selection?.state === "approval_required" ? "Approve the requested collection, or choose another. Your text stays on this device." :
      selection?.state === "approving" || state?.status === "authorizing" ? "Waiting for approval in the mdbase tab…" :
      selection?.state === "opening" || selection?.state === "pending" ? "Opening the requested collection. Your text stays on this device." :
      state?.problem || selection?.state === "blocked" ? "Journal could not open this collection. Your text stays on this device." :
      selection?.state === "usable" && state?.status === "setup_required" ? `Set up Journal in ${name}` :
      state?.status === "unselected" ? "Choose a collection. Your text stays on this device." :
      state?.status === "closed" ? "Signed out. Reload to sign in again." :
      data ? "On this device" : "On this device. Sign in to save.";
    status.textContent = message;
    status.setAttribute("role", problem ? "alert" : "status");
    const other = unresolved.filter(draft => draft.targetCollectionId && draft.targetCollectionId !== state?.selectedCollectionId).length;
    const legacy = drafts.legacyPendingCount();
    pending.textContent = `${unresolved.length} note${unresolved.length === 1 ? "" : "s"} on this device${other ? `; ${other} waiting for another collection` : ""}${legacy ? `; ${legacy} earlier prototype note${legacy === 1 ? "" : "s"} preserved separately` : ""}`;
    element("pending-row").hidden = !unresolved.length && !legacy && !memoryOnly;
    const details = element("pending-details");
    details.replaceChildren(...unresolved.map(draft => {
      const row = document.createElement("div"); row.className = "pending-entry";
      const text = document.createElement("small"), saving = opens?.state(draft.id), record = data?.snapshot(draft.id);
      const state = draft.legacyKey ? "Earlier note: original save needs review" :
        draft.targetCollectionId && draft.targetCollectionId !== selected?.collectionId ? "Waiting for its collection" :
        data?.problem(draft.id) ? "Original save needs attention" : saving?.state === "retrying" ? "Original save unresolved; checking again" :
        saving?.state === "opening" || record?.state === "saving" ? "Saving…" :
        record && ["conflict", "recovery", "deleted", "error"].includes(record.state) ? "Original save needs attention" : "On this device";
      text.textContent = `${new Date(draft.createdMs).toLocaleString()} — ${state}`; row.append(text);
      if (draft.id !== current.id) {
        const resume = document.createElement("button"); resume.type = "button"; resume.textContent = "Resume writing";
        resume.disabled = memoryOnly; resume.onclick = () => restoreDraft(draft.id); row.append(resume);
      }
      return row;
    }));
    element("collection-name").textContent = selected?.displayName ?? "";
    element("collection-name").hidden = !selected;
    const collections = state?.collections ?? [];
    const option = (label: string, value: string) => {const item = document.createElement("option"); item.textContent = label; item.value = value; return item;};
    const requested = selection?.requested.collectionId ?? null;
    choice.replaceChildren(option("Choose a collection…", ""), ...collections.map(item => {
      const guidance = describeError(item);
      const label = guidance ? `${item.displayName} — ${guidance.title}` : item.collectionId === requested && description && state?.status !== "ready" ? `${item.displayName} — ${description.title}` : item.displayName;
      const entry = option(label, item.collectionId); entry.disabled = item.availability?.state === "unavailable"; return entry;
    }), ...(requested && !collections.some(item => item.collectionId === requested) ? [option("Requested collection (approval needed)", requested)] : []));
    const availability = element("collection-availability");
    availability.replaceChildren(...collections.flatMap(item => {
      const guidance = describeError(item);
      if (item.availability?.state !== "unavailable" || !guidance) return [];
      const row = document.createElement("div"); row.className = "collection-guidance"; row.dataset.collectionId = item.collectionId;
      const title = document.createElement("strong"), message = document.createElement("p");
      title.textContent = `${item.displayName} — ${guidance.title}`; message.textContent = guidance.message; row.append(title, message);
      if (guidance.actionLabel) {
        if (guidance.updateUrl) {
          const link = document.createElement("a"); link.textContent = guidance.actionLabel; link.href = guidance.updateUrl;
          link.target = "_blank"; link.rel = "noopener noreferrer"; row.append(link);
        } else {const next = document.createElement("small"); next.textContent = guidance.actionLabel; row.append(next);}
      }
      return [row];
    }));
    availability.hidden = !availability.childElementCount;
    choice.value = requested ?? "";
    choice.disabled = memoryOnly || busy || !application || state?.status === "closed";
    const previous = element<HTMLButtonElement>("last-collection");
    previous.hidden = !!requested || !preferences.collectionId || !application || state?.status === "closed";
    const previousCollection = collections.find(item => item.collectionId === preferences.collectionId);
    previous.disabled = memoryOnly || busy || previousCollection?.availability?.state === "unavailable";
    const previousName = previousCollection?.displayName;
    previous.textContent = previousName ? `Open ${previousName}` : "Open last used collection";
    typeChoice.replaceChildren(option("Choose a type…", ""), ...types.map(item => option(item.name, item.name)));
    typeChoice.value = type?.name ?? "";
    element("type-row").hidden = types.length < 2;
    element("new-button").hidden = !current.body.trim();
    element("undo-button").hidden = !undoId;
    const connect = element<HTMLButtonElement>("connect-from-menu");
    connect.textContent = selection?.state === "usable" && state?.status === "setup_required" ? "Set up Journal" :
      selection?.state === "usable" ? "Review access" : selection?.state === "approval_required" ? "Approve this collection" :
      selection?.state === "approving" || state?.status === "authorizing" ? "Continue sign-in" : "Sign in";
    connect.hidden = state?.status === "closed";
    connect.disabled = busy || !application || state?.problem === "application_not_yet_available";
    element<HTMLButtonElement>("disconnect").textContent = "Sign out";
    element<HTMLButtonElement>("disconnect").disabled = busy;
    element("disconnect").hidden = !state?.signIn || state.status === "closed";
    const another = element<HTMLButtonElement>("reconnect-from-menu");
    another.textContent = "Choose another collection";
    another.hidden = (!requested && selection?.state !== "invalid") || state?.status === "closed";
    another.disabled = busy;
    const localCopy = selection?.state === "usable" && selected ? `Notes save to ${name} when this collection is ready.` : "Notes stay on this device until the requested collection is ready.";
    element("menu-connection").textContent = description ? `${description.title}. ${description.message}${description.actionLabel ? ` Next: ${description.actionLabel}.` : ""} ${localCopy}` : localCopy;
    const update = element<HTMLAnchorElement>("update-app");
    update.hidden = !description?.updateUrl;
    update.textContent = description?.actionLabel ?? "Update the app";
    if (description?.updateUrl) update.href = description.updateUrl; else update.removeAttribute("href");
    document.body.classList.toggle("undo", !!undoId);
    element("keys").textContent = /Mac|iPhone|iPad/.test(document.defaultView?.navigator.platform ?? "") ? "⌘↩" : "Ctrl+↩";
    const words = segmenter ? [...segmenter.segment(current.body)].filter(item => item.isWordLike).length : current.body.match(/\S+/g)?.length ?? 0;
    element("word-count").textContent = `${words} word${words === 1 ? "" : "s"}`;
    element("word-count").hidden = words === 0;
  }
  /** Invoke synchronously in the gesture stack. SDK reserves its own popup. */
  async function act(action: () => Promise<unknown>): Promise<void> {
    if (disposed || busy) return;
    busy = true; problem = null; actionProblem = null;
    try {const pending = action(); render(); await pending; caller.signal.throwIfAborted();}
    catch (error) {if (!caller.signal.aborted) actionProblem = describeError(error) ?? describeError("internal");}
    finally {if (!caller.signal.aborted) {busy = false; render();}}
  }
  function newPage(): void {
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
  }
  function undoNewPage(): void {
    if (!undoId || current.body.trim()) return;
    const previous = drafts.get(undoId);
    if (!previous || previous.targetCollectionId !== snapshot()?.selectedCollectionId && snapshot()?.selectedCollectionId !== undefined) {clearUndo(); render(); return;}
    try {current = drafts.patch(previous.id, {finished: false}); unpersistedDraft = false; clearUndo(); renderPage(); render(); page.focus();}
    catch {problem = "Keep this page open: Journal cannot restore the previous draft safely."; render();}
  }
  function restoreDraft(id: string): void {
    if (disposed || memoryOnly) return;
    try {
      const earlier = drafts.get(id);
      if (!earlier) throw new DraftPersistenceError();
      if (current.body.trim()) drafts.patch(current.id, {finished: true, touchedMs: Date.now()});
      current = drafts.patch(id, {finished: false}); unpersistedDraft = false;
      clearUndo(); problem = null; renderPage(); render(); page.focus();
    } catch {problem = "Keep this page open: Journal cannot restore the earlier text safely."; render();}
  }
  function save(): void {
    const owned = data, selectedType = type, queue = opens;
    if (!owned || !selectedType || !queue || disposed || memoryOnly) return;
    try {
      for (const draft of drafts.list()) queue.request(draft.id, selectedType);
    } catch {problem = "Keep this page open: Journal cannot read its drafts on this device.";}
    render();
  }
  function changed(): void {
    if (!entry || disposed) return;
    const selectedId = snapshot()?.selectedCollectionId ?? null;
    if (snapshot()?.status === "ready" && !snapshot()?.problem) actionProblem = null;
    const selectionChanged = selectedId !== observedCollectionId;
    observedCollectionId = selectedId;
    const next = journalConnection(entry);
    if (next !== data?.connection) {
      unlistenData?.(); unlistenData = null; unlistenStatus?.(); unlistenStatus = null; opens?.dispose(); opens = null; data?.release(); data = null; types = []; type = null;
      if (next) {
        const owned = new JournalData(next, drafts); data = owned;
        opens = new DraftOpens(owned, drafts, () => !disposed && data === owned && owned.connection.isCurrent(), render);
        unlistenData = owned.subscribe(render);
        unlistenStatus = next.records.onStatus(render);
        void owned.types().then(value => {
          if (disposed || data !== owned) return;
          types = value; type = value.find(item => item.name === preferences.entryTypes?.[owned.connection.id]) ?? (value.length === 1 ? value[0]! : null);
          render(); void save();
        }, error => {if (!disposed && data === owned) {actionProblem = describeError(error) ?? describeError("internal"); render();}});
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
    const usable = snapshot()?.selection.usable;
    if (usable && preferences.collectionId !== usable.collectionId) {
      preferences.collectionId = usable.collectionId;
      try {drafts.savePreferences({...preferences, folder});} catch {problem = "Journal could not preserve your collection preference on this device.";}
    }
    render();
  }
  listen(page, "input", () => {
    clearUndo();
    const body = page.value;
    try {
      const durable = drafts.get(current.id);
      if (!durable && !unpersistedDraft) throw new DraftPersistenceError();
      const original = durable ?? current;
      current = drafts.put({...original, body, touchedMs: Date.now(), path: original.path ?? (body.trim() ? notePath(new Date(current.createdMs), folder, current.id) : null)});
      memoryOnly = false; unpersistedDraft = false; problem = null;
      if (data?.snapshot(current.id)) data.setBody(current.id, body);
      else void save();
    } catch (error) {
      current = {...current, body};
      if (error instanceof DraftPersistenceError) {memoryOnly = true; problem = error.message;}
      else problem = "Your text is on this device. Its original save has not completed.";
    }
    page.style.height = "auto"; page.style.height = `${Math.max(240, page.scrollHeight)}px`;
    document.body.classList.toggle("quiet", !!body.trim()); render();
  });
  listen(document, "keydown", event => {const key = event as KeyboardEvent; if ((key.ctrlKey || key.metaKey) && key.key === "Enter" && key.target === page && !document.querySelector("dialog[open]")) {key.preventDefault(); newPage();}});
  listen(element("new-button"), "click", newPage);
  listen(element("undo-button"), "click", undoNewPage);
  function openMenu(): void {element<HTMLInputElement>("folder").value = folder; render(); menu.showModal();}
  listen(element("menu-button"), "click", openMenu);
  listen(element("close-menu"), "click", () => menu.close());
  listen(menu, "close", () => {
    const candidate = element<HTMLInputElement>("folder").value.trim() || "journal";
    try {notePath(new Date(), candidate); drafts.savePreferences({...preferences, folder: candidate}); folder = candidate;}
    catch {problem = "Choose a folder within this collection that Journal can preserve on this device."; render();}
    page.focus();
  });
  listen(choice, "change", () => {
    const id = choice.value;
    if (!application || choice.disabled) return;
    if (snapshot()?.collections.find(item => item.collectionId === id)?.availability?.state === "unavailable") {render(); return;}
    void act(() => id ? application.select(id, {signal: caller.signal}) : application.chooseAnother({signal: caller.signal}));
  });
  listen(element("last-collection"), "click", () => {
    if (!element<HTMLButtonElement>("last-collection").disabled && application && preferences.collectionId)
      void act(() => application.select(preferences.collectionId!, {signal: caller.signal}));
  });
  listen(typeChoice, "change", () => {
    type = types.find(item => item.name === typeChoice.value) ?? null;
    if (data && type) {
      preferences.entryTypes = Object.fromEntries(Object.entries({...preferences.entryTypes, [data.connection.id]: type.name}).slice(-64));
      try {drafts.savePreferences({...preferences, folder});} catch {problem = "Journal could not preserve your entry type preference on this device.";}
    }
    save();
  });
  const authorize = () => {
    if (!application) return;
    const state = snapshot(), usable = state?.selection.state === "usable";
    void act(() => usable && state?.status === "setup_required" ? application.configure({signal: caller.signal}) :
      usable ? application.reauthorize({signal: caller.signal}) : application.approve(undefined, {signal: caller.signal}));
  };
  listen(element("connect-from-menu"), "click", authorize);
  listen(element("reconnect-from-menu"), "click", () => {if (application) void act(() => application.chooseAnother({signal: caller.signal}));});
  listen(element("disconnect"), "click", () => {if (application) void act(() => application.close());});
  listen(element("status-button"), "click", () => {if (problem && data) void save(); else openMenu();});
  const foreground = () => {if (application && !disposed) {try {application.setForeground(document.visibilityState === "visible");} catch {/* unavailable owner stays unavailable */}}};
  listen(document, "visibilitychange", foreground);
  function applyTheme(): void {
    if (preferences.theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = preferences.theme;
    for (const button of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) button.setAttribute("aria-pressed", String(button.dataset.themeChoice === preferences.theme));
  }
  for (const button of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) listen(button, "click", () => {
    const theme = button.dataset.themeChoice;
    preferences.theme = theme === "light" || theme === "dark" ? theme : "system";
    try {drafts.savePreferences({...preferences, folder});} catch {problem = "Journal could not preserve your theme preference.";}
    applyTheme(); render();
  });
  for (const name of ["pointermove", "wheel", "touchmove", "focusin"]) listen(document, name, () => document.body.classList.remove("quiet"));
  applyTheme();
  const unlistenApp = application?.subscribe(changed) ?? (() => {});
  renderPage(); changed(); render(); foreground();
  if (application?.getSnapshot().status === "not_started") void act(() => application.start({signal: caller.signal}));
  return {currentDraft: () => current, newPage, undoNewPage, dispose() {
    if (disposed) return;
    disposed = true; caller.abort(); clearUndo(); unlistenApp(); unlistenData?.(); unlistenStatus?.(); opens?.dispose(); data?.release();
    // No SDK replacement, physical close or borrowed-client shutdown on disposal.
  }};
}
