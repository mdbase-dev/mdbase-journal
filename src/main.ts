import {createJournalApplication, type JournalApplicationInputs} from "./application.js";
import {JournalDrafts} from "./drafts.js";
import {mountJournal} from "./view.js";
declare const JOURNAL_APPLICATION_INPUTS: JournalApplicationInputs | null;
// A writing-only build never supplies a pretend registered ID or SDK runtime.
const entry = JOURNAL_APPLICATION_INPUTS === null ? null : createJournalApplication(JOURNAL_APPLICATION_INPUTS);
// Access storage inside operations: browser privacy policy can throw even from
// the localStorage getter. No in-memory storage substitute authorizes a save.
const drafts = new JournalDrafts({getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key), key: index => localStorage.key(index), get length() {return localStorage.length;}});
const view = mountJournal(document, drafts, entry);
addEventListener("pagehide", () => view.dispose(), {once: true});
