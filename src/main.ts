import {createJournalApplication, type JournalApplicationInputs} from "./application.js";
import {DraftPersistenceError, JournalDrafts} from "./drafts.js";
import {mountJournal} from "./view.js";
import {mountReturningNotice} from "./returning-notice.js";
import {completeAppGrantCallback} from "./grant-callback.js";
declare const JOURNAL_APPLICATION_INPUTS: JournalApplicationInputs | null;
// The Private collection consent window returns here: hand its result to the
// waiting Journal tab and close, without starting a second SDK owner.
if (!completeAppGrantCallback(new URL(location.href), {document, load: () => import("@mdbase-dev/sdk/app-grant"), close: () => window.close()})) {
  mountReturningNotice(document, () => localStorage);
  // A writing-only build never supplies a pretend registered ID or SDK runtime.
  const entry = JOURNAL_APPLICATION_INPUTS === null ? null : createJournalApplication(JOURNAL_APPLICATION_INPUTS);
  // Access storage inside operations: browser privacy policy can throw even from
  // the localStorage getter. No in-memory storage substitute authorizes a save.
  const drafts = new JournalDrafts({getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key), key: index => localStorage.key(index), get length() {return localStorage.length;}}, undefined,
    operation => navigator.locks ? navigator.locks.request("journal.native.drafts", operation) : Promise.reject(new DraftPersistenceError()));
  // Initialization changes metadata and prunes copies under the same lock.
  const view = await drafts.mutate(() => mountJournal(document, drafts, entry)).catch(() => mountJournal(document, drafts, entry));
  addEventListener("pagehide", () => view.dispose(), {once: true});
}
