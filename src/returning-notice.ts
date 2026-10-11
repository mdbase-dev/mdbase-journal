type NoticeStorage = Pick<Storage, "getItem" | "setItem" | "key" | "length">;
const marker = "journal.mdbase-upgrade-notice.v1";
const visited = new WeakSet<NoticeStorage>();
/** Informational only. Old-key presence is not sign-in or collection authority. */
export function mountReturningNotice(doc: Document, getStorage: () => NoticeStorage): void {
  let storage: NoticeStorage, returning = false;
  try {
    storage = getStorage();
    if (visited.has(storage) || storage.getItem(marker) !== null) return;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === "journal.prefs.v1" || key === "journal.prefs.v2" || key === "journal.collection" || key?.startsWith("journal.note.") || key?.startsWith("journal.native.note.")) {
        returning = true; break;
      }
    }
  } catch {return;}
  visited.add(storage);
  try {storage.setItem(marker, "seen");} catch {/* A notice must never interrupt writing. */}
  if (!returning) return;
  const notice = doc.createElement("aside"); notice.id = "returning-user-notice"; notice.setAttribute("aria-label", "mdbase update");
  const message = doc.createElement("p"); message.textContent = "mdbase was upgraded. Approve Journal once to continue. Your collections and notes are unchanged.";
  const difference = doc.createElement("p"); difference.textContent = "Private collections need your desktop online.";
  const actions = doc.createElement("div"), link = doc.createElement("a"), dismiss = doc.createElement("button");
  link.textContent = "Learn more"; link.href = "https://mdbase.dev/"; link.target = "_blank"; link.rel = "noopener noreferrer";
  dismiss.type = "button"; dismiss.textContent = "Dismiss"; dismiss.addEventListener("click", () => notice.remove(), {once: true});
  actions.append(link, dismiss); notice.append(message, difference, actions);
  doc.querySelector("main")?.before(notice);
}
