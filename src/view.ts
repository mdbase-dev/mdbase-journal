import type {MdbaseApplicationEntry, MdbaseApplicationSnapshot} from "@mdbase-dev/sdk";
import {journalConnection} from "./application.js";
import {DraftPersistenceError, JournalDrafts, notePath, type JournalDraft} from "./drafts.js";
import {JournalData, type JournalEntryType} from "./journal-data.js";
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
  let unlistenData: (() => void) | null = null;
  let types: JournalEntryType[] = [];
  let type: JournalEntryType | null = null;
  let problem: string | null = null;
  let busy = false;
  let disposed = false;
  let undoId: string | null = null;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let memoryOnly = false;
  let unpersistedDraft = false;
  const preferences = drafts.preferences();
  let folder = preferences.folder;
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, {granularity: "word"}) : null;
  let current = drafts.blank(application?.getSnapshot().selectedCollectionId ?? null);
  try {current = drafts.put(current);} catch {memoryOnly = true; unpersistedDraft = true; problem = "Keep this page open: Journal cannot preserve its text on this device.";}
  const listen = (target: EventTarget, name: string, handler: EventListener) => target.addEventListener(name, handler, {signal: caller.signal});
  const snapshot = (): MdbaseApplicationSnapshot | null => application?.getSnapshot() ?? null;
  function clearUndo(): void {undoId = null; if (undoTimer !== null) clearTimeout(undoTimer); undoTimer = null;}
  function renderPage(): void {
    page.value = current.body;
    page.style.height = "auto";
    page.style.height = `${Math.max(240, page.scrollHeight)}px`;
    document.body.classList.toggle("typing", !!current.body.trim());
    document.body.classList.remove("quiet");
    element("when").textContent = new Date(current.createdMs).toLocaleString(undefined, {weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit"});
  }
  function render(): void {
    if (disposed) return;
    if (!memoryOnly) current = drafts.get(current.id) ?? current;
    const state = snapshot();
    const selected = state?.collections.find(item => item.collectionId === state.selectedCollectionId);
    const name = selected?.displayName ?? "your collection";
    const record = data?.snapshot(current.id);
    let unresolved: JournalDraft[] = [];
    try {unresolved = drafts.list().filter(draft => !!draft.body.trim() && draft.body !== draft.savedBody);} catch {problem = "Keep this page open: Journal cannot read its drafts on this device.";}
    let message = problem ?? data?.problem(current.id);
    if (!message && record) {
      message = record.state === "saved" && current.body === current.savedBody ? "Saved" : record.state === "saving" ? "Saving…" :
        ["conflict", "recovery", "deleted", "error"].includes(record.state) ? "Your text is on this device. Resolve its original save before continuing." : "On this device";
    }
    if (!message) message = !entry ? "On this device. Journal needs its registered application before connecting." :
      state?.problem === "application_not_yet_available" ? "On this device. Opening collections isn't available in this build yet." :
      state?.status === "authorizing" ? "Waiting for approval in the mdbase tab…" :
      state?.status === "setup_required" ? `Set up Journal in ${name}` :
      state?.status === "closed" ? "Signed out. Reload to sign in again." :
      data ? "On this device" : "On this device. Sign in to save.";
    status.textContent = message;
    status.setAttribute("role", problem ? "alert" : "status");
    const other = unresolved.filter(draft => draft.targetCollectionId && draft.targetCollectionId !== state?.selectedCollectionId).length;
    const legacy = drafts.legacyPendingCount();
    pending.textContent = `${unresolved.length} note${unresolved.length === 1 ? "" : "s"} on this device${other ? `; ${other} waiting for another collection` : ""}${legacy ? `; ${legacy} earlier prototype note${legacy === 1 ? "" : "s"} preserved separately` : ""}`;
    element("pending-row").hidden = !unresolved.length && !legacy && !memoryOnly;
    element("collection-name").textContent = selected?.displayName ?? "";
    element("collection-name").hidden = !selected;
    const collections = state?.collections ?? [];
    const option = (label: string, value: string) => {const item = document.createElement("option"); item.textContent = label; item.value = value; return item;};
    choice.replaceChildren(option("Choose a collection…", ""), ...collections.map(item => option(item.displayName, item.collectionId)));
    choice.value = state?.selectedCollectionId ?? "";
    choice.disabled = memoryOnly || busy || !application || state?.status === "closed";
    typeChoice.replaceChildren(option("Choose a type…", ""), ...types.map(item => option(item.name, item.name)));
    typeChoice.value = type?.name ?? "";
    element("type-row").hidden = types.length < 2;
    element("new-button").hidden = !current.body.trim();
    element("undo-button").hidden = !undoId;
    const connect = element<HTMLButtonElement>("connect-from-menu");
    connect.textContent = state?.status === "setup_required" ? "Set up Journal" : "Sign in";
    connect.hidden = state?.status === "closed";
    connect.disabled = busy || !application || state?.problem === "application_not_yet_available" || state?.status === "authorizing";
    element<HTMLButtonElement>("disconnect").textContent = "Sign out";
    element<HTMLButtonElement>("disconnect").disabled = busy;
    element("disconnect").hidden = !state?.signIn || state.status === "closed";
    const forget = element<HTMLButtonElement>("reconnect-from-menu");
    forget.textContent = "Forget selected collection";
    forget.hidden = !state?.selectedCollectionId || state.status === "closed";
    forget.disabled = busy;
    element("menu-connection").textContent = selected ? `Writing to ${name} when the SDK confirms this collection is ready.` : "Notes stay on this device until a collection is ready.";
    document.body.classList.toggle("undo", !!undoId);
    element("keys").textContent = /Mac|iPhone|iPad/.test(document.defaultView?.navigator.platform ?? "") ? "⌘↩" : "Ctrl+↩";
    const words = segmenter ? [...segmenter.segment(current.body)].filter(item => item.isWordLike).length : current.body.match(/\S+/g)?.length ?? 0;
    element("word-count").textContent = `${words} word${words === 1 ? "" : "s"}`;
    element("word-count").hidden = words === 0;
  }
  /** Invoke synchronously in the gesture stack. SDK reserves its own popup. */
  async function act(action: () => Promise<unknown>): Promise<void> {
    if (disposed || busy) return;
    busy = true; problem = null;
    try {const pending = action(); render(); await pending; caller.signal.throwIfAborted();}
    catch {if (!caller.signal.aborted) problem = "Journal could not finish that action. Your text is still on this device.";}
    finally {if (!caller.signal.aborted) {busy = false; render();}}
  }
  function newPage(): void {
    if (!current.body.trim()) {page.focus(); return;}
    if (memoryOnly) {problem = "Keep this page open: its text has not been preserved on this device."; render(); return;}
    const previous = current;
    try {
      const next = drafts.create(snapshot()?.selectedCollectionId ?? null);
      drafts.patch(previous.id, {finished: true});
      current = next;
      clearUndo(); undoId = previous.id;
      undoTimer = setTimeout(() => {clearUndo(); render();}, 8000);
      problem = null; renderPage(); render(); page.focus();
    } catch {current = previous; problem = "Keep this page open: Journal cannot preserve its text on this device."; render();}
  }
  function undoNewPage(): void {
    if (!undoId || current.body.trim()) return;
    const previous = drafts.get(undoId);
    if (!previous || previous.targetCollectionId !== snapshot()?.selectedCollectionId && snapshot()?.selectedCollectionId !== undefined) {clearUndo(); render(); return;}
    try {current = drafts.patch(previous.id, {finished: false}); clearUndo(); renderPage(); render(); page.focus();}
    catch {problem = "Keep this page open: Journal cannot restore the previous draft safely."; render();}
  }
  async function save(): Promise<void> {
    const owned = data, selectedType = type;
    if (!owned || !selectedType || disposed || memoryOnly) return;
    try {
      for (const draft of drafts.list().filter(item => !!item.body.trim() && item.body !== item.savedBody && (!item.targetCollectionId || item.targetCollectionId === owned.connection.id))) {
        await owned.open(draft.id, selectedType);
        if (data !== owned || disposed) return;
      }
      problem = null;
    } catch (error) {if (data === owned && !disposed) problem = error instanceof Error ? error.message : "Your note remains on this device.";}
    render();
  }
  function changed(): void {
    if (!entry || disposed) return;
    const selectedId = snapshot()?.selectedCollectionId ?? null;
    const next = journalConnection(entry);
    if (next !== data?.connection) {
      unlistenData?.(); unlistenData = null; data?.release(); data = null; types = []; type = null;
      if (next) {
        const owned = new JournalData(next, drafts); data = owned;
        unlistenData = owned.subscribe(render);
        void owned.types().then(value => {
          if (disposed || data !== owned) return;
          types = value; type = value.length === 1 ? value[0]! : null;
          render(); void save();
        }, error => {if (!disposed && data === owned) {problem = error instanceof Error ? error.message : "Journal could not read this collection's types."; render();}});
      }
    }
    if (!memoryOnly && selectedId !== current.targetCollectionId) {
      clearUndo();
      try {
        if (!current.targetCollectionId && selectedId) current = drafts.patch(current.id, {targetCollectionId: selectedId});
        else if (current.body.trim()) {
          const next = drafts.create(selectedId);
          drafts.patch(current.id, {finished: true}); current = next; renderPage();
        } else current = drafts.patch(current.id, {targetCollectionId: selectedId});
      } catch {memoryOnly = true; problem = "Keep this page open: Journal cannot preserve its text before changing collections.";}
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
      current = drafts.put({...original, body, touchedMs: Date.now(), path: original.path ?? (body.trim() ? notePath(new Date(current.createdMs), folder) : null)});
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
  listen(element("menu-button"), "click", () => {element<HTMLInputElement>("folder").value = folder; render(); menu.showModal();});
  listen(element("close-menu"), "click", () => menu.close());
  listen(menu, "close", () => {
    const candidate = element<HTMLInputElement>("folder").value.trim() || "journal";
    try {notePath(new Date(), candidate); drafts.savePreferences({...preferences, folder: candidate}); folder = candidate;}
    catch {problem = "Choose a folder within this collection that Journal can preserve on this device."; render();}
    page.focus();
  });
  listen(choice, "change", () => {const id = choice.value; if (!application) return; void act(() => id ? application.select(id, {signal: caller.signal}) : application.clearSelection({signal: caller.signal}));});
  listen(typeChoice, "change", () => {type = types.find(item => item.name === typeChoice.value) ?? null; void save();});
  const authorize = () => {if (application) void act(() => snapshot()?.status === "setup_required" ? application.configure({signal: caller.signal}) : application.authorize({signal: caller.signal}));};
  listen(element("connect-from-menu"), "click", authorize);
  listen(element("reconnect-from-menu"), "click", () => {const id = snapshot()?.selectedCollectionId; if (application && id) void act(() => application.forget(id, {signal: caller.signal}));});
  listen(element("disconnect"), "click", () => {if (application) void act(() => application.close());});
  listen(element("status-button"), "click", () => {if (problem && data) void save(); else menu.showModal();});
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
    disposed = true; caller.abort(); clearUndo(); unlistenApp(); unlistenData?.(); data?.release();
    // No SDK replacement, physical close or borrowed-client shutdown on disposal.
  }};
}
