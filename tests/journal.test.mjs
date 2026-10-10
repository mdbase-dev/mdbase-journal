import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].split("// ---------- Start ----------")[0];

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: (i) => [...values.keys()][i],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function harness(url = "https://journal.test/", localStorage = memoryStorage()) {
  const elements = new Map();
  function element() {
    const classes = new Set();
    const events = new Map();
    return {
      value: "", textContent: "", hidden: false, style: {}, scrollHeight: 800,
      classList: {
        toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
        remove(name) { classes.delete(name); },
        contains(name) { return classes.has(name); }
      },
      addEventListener(type, listener) {
        const list = events.get(type) || [];
        list.push(listener);
        events.set(type, list);
      },
      emit(type, event) { for (const listener of events.get(type) || []) listener(event); },
      setAttribute() {}, focus() {}, setSelectionRange() {},
      replaceChildren(...children) { this.children = children; },
      showModal() { this.open = true; }, close() { this.open = false; }
    };
  }
  const listeners = new Map();
  const timers = new Map();
  let timerId = 0;
  function listen(type, listener) {
    const list = listeners.get(type) || [];
    list.push(listener);
    listeners.set(type, list);
  }
  const context = vm.createContext({
    URL, URLSearchParams, console, Date, Promise,
    crypto: { randomUUID }, localStorage, sessionStorage: memoryStorage(),
    location: new URL(url), navigator: { platform: "Linux" }, scrollY: 0,
    document: {
      body: element(), documentElement: { dataset: {}, removeAttribute() {} },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      querySelectorAll: () => [], querySelector: () => null, addEventListener: listen
    },
    Option: function(text, value) { this.text = text; this.value = value; },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, scrollTo() {},
    addEventListener: listen
  });
  context.window = context;
  context.history = {
    state: null,
    replaceState(state, _title, value) { this.state = state; context.location = new URL(value, context.location); },
    pushState(state, title, value) { this.replaceState(state, title, value); }
  };
  const run = (source) => vm.runInContext(source, context);
  run(script);
  run("selection = new JournalSelection(); openPage();");
  return {
    context, run, elements, localStorage,
    emit(type, event) { for (const listener of listeners.get(type) || []) listener(event); },
    expireUndo() {
      const [id, timer] = [...timers].find(([, timer]) => timer.delay === 8000);
      timers.delete(id);
      timer.callback();
    }
  };
}

const TYPE = { typeName: "journal-entry", fields: { created: "created" } };
function collection(id) {
  const writes = [];
  return {
    collectionId: id, writes,
    async describe() {
      return { ok: true, value: { contracts: [{ id: "journal.entry", implementations: [TYPE] }] } };
    },
    async create(input) {
      writes.push({ kind: "create", ...input });
      return { ok: true, value: { revision: "1" } };
    },
    async update(input) {
      writes.push({ kind: "update", ...input });
      return { ok: true, value: { revision: "2" } };
    }
  };
}
function useCollection(h, target) {
  h.context.target = target;
  h.context.targetType = TYPE;
  h.run("connection = target; entryType = targetType; connectionInfo = { collectionId: target.collectionId, displayName: target.collectionId }; sessionState = 'ready';");
}
function write(h, body) {
  h.context.bodyText = body;
  h.run("current = patchNote(current.id, { body: bodyText, path: current.path || notePath(new Date(current.createdMs)) }); page.value = bodyText;");
}
function note(h) { return JSON.parse(h.run("JSON.stringify(readNote(current.id))")); }

// Selection is URL-scoped, while the remembered choice supplies a default on a later visit.
test("URL collection wins over remembered selection and preserves other parameters", () => {
  const storage = memoryStorage();
  storage.setItem("journal.collection", JSON.stringify("remembered"));
  const h = harness("https://journal.test/?collection=linked&extra=1#writing", storage);
  assert.equal(h.run("selection.selectedCollectionId()"), "linked");
  assert.equal(note(h).targetCollectionId, "linked");
  h.run("selection.select('next')");
  assert.equal(h.context.location.searchParams.get("collection"), "next");
  assert.equal(h.context.location.searchParams.get("extra"), "1");
  assert.equal(h.context.location.hash, "#writing");
  assert.equal(JSON.parse(storage.getItem("journal.collection")), "next");
  assert.equal(harness("https://journal.test/", storage).run("selectedCollectionId()"), "next");
});

test("collection choices in another tab do not redirect this tab", () => {
  const storage = memoryStorage();
  const a = harness("https://journal.test/?collection=a", storage);
  const b = harness("https://journal.test/?collection=b", storage);
  b.run("selection.select('c')");
  a.emit("storage", { key: "journal.collection" });
  assert.equal(a.run("selectedCollectionId()"), "a");
  assert.equal(b.run("selectedCollectionId()"), "c");
});

test("clearing selection removes URL and remembered selection", () => {
  const h = harness("https://journal.test/?collection=a&extra=1");
  h.run("selection.select(null)");
  assert.equal(h.run("selectedCollectionId()"), null);
  assert.equal(h.context.location.searchParams.get("extra"), "1");
  assert.equal(h.localStorage.getItem("journal.collection"), null);
});

test("popstate notifies selection subscribers", () => {
  const h = harness("https://journal.test/?collection=a");
  h.run("var changes = 0; selection.subscribe(() => changes++);");
  h.context.location = new URL("https://journal.test/?collection=b");
  h.emit("popstate");
  assert.equal(h.run("changes"), 1);
  assert.equal(h.run("selectedCollectionId()"), "b");
});

test("authorization returns to the requested page with the authorized collection", () => {
  const h = harness("https://journal.test/auth/mdbase/callback?code=secret&state=state");
  h.run("selection.finishAuthorization('/?collection=a&extra=1#writing', 'b')");
  assert.equal(h.context.location.pathname, "/");
  assert.equal(h.context.location.searchParams.get("collection"), "b");
  assert.equal(h.context.location.searchParams.get("extra"), "1");
  assert.equal(h.context.location.searchParams.has("code"), false);
  h.run("selection.finishAuthorization('https://other.test/', 'c')");
  assert.equal(h.context.location.origin, "https://journal.test");
});

test("legacy pending notes keep their original destination before URL selection changes it", () => {
  const storage = memoryStorage();
  storage.setItem("journal.collection", JSON.stringify("a"));
  storage.setItem("journal.note.legacy", JSON.stringify({ id: "legacy", createdIn: null, body: "Private", path: "journal/legacy.md", createdMs: 1 }));
  const h = harness("https://journal.test/?collection=b", storage);
  assert.equal(h.run("readNote('legacy').targetCollectionId"), "a");
});

test("settings switcher lists authorized collections and opens a fresh page without moving old notes", async () => {
  const h = harness("https://journal.test/?collection=a");
  const a = collection("a"), b = collection("b");
  useCollection(h, a);
  write(h, "Private A entry");
  const previous = note(h).id;
  let selected = "a";
  h.context.appSession = {
    getSnapshot: () => ({ status: "ready", collectionId: selected, connections: [
      { collectionId: "a", displayName: "Personal" }, { collectionId: "b", displayName: "Work" }
    ] }),
    connection: () => selected === "a" ? a : b,
    select(id) {
      selected = id;
      h.context.chosenId = id;
      h.run("selection.select(chosenId); onSessionChange();");
      return { ok: true };
    }
  };
  // The script's appSession is lexical, not the global property above.
  h.run("appSession = window.appSession; render();");
  assert.deepEqual(h.elements.get("collection-choice").children.map((o) => o.text), ["Personal", "Work"]);
  h.elements.get("collection-choice").value = "b";
  h.elements.get("collection-choice").onchange();
  await h.run("syncAll()");
  assert.equal(h.context.location.searchParams.get("collection"), "b");
  assert.equal(h.run("current.body"), "");
  assert.equal(note(h).targetCollectionId, "b");
  assert.equal(h.run(`readNote(${JSON.stringify(previous)}).targetCollectionId`), "a");
  assert.equal(b.writes.length, 0);
  assert.match(h.elements.get("pending-count").textContent, /waiting for another collection/);
});

test("switching back saves only notes destined for that collection", async () => {
  const h = harness("https://journal.test/?collection=a");
  const a = collection("a"), b = collection("b");
  useCollection(h, a);
  write(h, "Entry A");
  h.run("finish(current); selection.select('b'); startNote();");
  useCollection(h, b);
  write(h, "Entry B");
  await h.run("syncAll()");
  assert.deepEqual(b.writes.map((w) => w.body), ["Entry B"]);
  h.run("selection.select('a')");
  useCollection(h, a);
  await h.run("syncAll()");
  assert.deepEqual(a.writes.map((w) => w.body), ["Entry A"]);
});

test("unconnected writing adopts its first collection once", async () => {
  const h = harness();
  write(h, "Before connecting");
  const a = collection("a"), b = collection("b");
  useCollection(h, a);
  await h.run("syncAll()");
  assert.equal(note(h).targetCollectionId, "a");
  write(h, "Still belongs to A");
  useCollection(h, b);
  await h.run("syncAll()");
  assert.equal(b.writes.length, 0);
});

test("an in-flight write remains pinned to its connection during a switch", async () => {
  const h = harness("https://journal.test/?collection=a");
  const a = collection("a"), b = collection("b");
  let complete;
  a.create = (input) => {
    a.writes.push(input);
    return new Promise((resolve) => { complete = resolve; });
  };
  useCollection(h, a);
  write(h, "Private A entry");
  const id = note(h).id;
  const saving = h.run("syncAll()");
  assert.equal(a.writes.length, 1);
  h.run("selection.select('b'); finish(current); startNote();");
  useCollection(h, b);
  complete({ ok: true, value: { revision: "1" } });
  await saving;
  assert.equal(h.run(`readNote(${JSON.stringify(id)})?.createdIn`), undefined); // Finished, saved draft was cleaned up.
  assert.equal(b.writes.length, 0);
  assert.equal(note(h).targetCollectionId, "b");
});

test("a stale type lookup cannot send an old collection's note to a new connection", async () => {
  const h = harness("https://journal.test/?collection=a");
  const a = collection("a"), b = collection("b");
  let complete;
  a.describe = () => new Promise((resolve) => { complete = resolve; });
  useCollection(h, a);
  h.run("entryType = null");
  write(h, "Entry A");
  const saving = h.run("syncAll()");
  useCollection(h, b);
  complete({ ok: true, value: { contracts: [{ id: "journal.entry", implementations: [TYPE] }] } });
  await saving;
  assert.equal(a.writes.length, 0);
  assert.equal(b.writes.length, 0);
});

test("scrolling gestures reveal controls and typing hides them again", () => {
  const h = harness();
  const page = h.elements.get("page");
  page.value = "Writing";
  page.emit("input");
  assert.equal(h.context.document.body.classList.contains("quiet"), true);
  h.emit("scroll"); // The immediate caret scroll should not undo quiet mode.
  assert.equal(h.context.document.body.classList.contains("quiet"), true);
  h.emit("touchmove");
  assert.equal(h.context.document.body.classList.contains("quiet"), false);
  page.emit("input");
  h.emit("wheel");
  assert.equal(h.context.document.body.classList.contains("quiet"), false);
  h.run("setQuiet(true); lastInputMs = 0;");
  h.emit("scroll");
  assert.equal(h.context.document.body.classList.contains("quiet"), false);
  page.value = "";
  page.emit("input");
  assert.equal(h.context.document.body.classList.contains("quiet"), false);
});

test("new-page shortcut only works on the writing surface outside dialogs", () => {
  const h = harness();
  write(h, "Keep this entry");
  const id = note(h).id;
  let prevented = false;
  const event = { ctrlKey: true, key: "Enter", preventDefault() { prevented = true; } };
  h.emit("keydown", { ...event, target: h.elements.get("folder") });
  assert.equal(note(h).id, id);
  assert.equal(prevented, false);
  h.context.document.querySelector = () => ({ open: true });
  h.emit("keydown", { ...event, target: h.elements.get("page") });
  assert.equal(note(h).id, id);
  h.context.document.querySelector = () => null;
  h.emit("keydown", { ...event, target: h.elements.get("page") });
  assert.equal(prevented, true);
  assert.notEqual(note(h).id, id);
  assert.equal(h.elements.get("undo-button").hidden, false);
});

test("undo restores the same entry after saving, preserving identity and revision", async () => {
  const h = harness("https://journal.test/?collection=a");
  const a = collection("a");
  useCollection(h, a);
  write(h, "Entry to restore");
  const previous = note(h);
  h.run("newPage()");
  await h.run("syncAll()");
  assert.equal(a.writes.length, 1);
  assert.equal(h.run(`readNote(${JSON.stringify(previous.id)}).revision`), "1");
  h.run("undoNewPage()");
  assert.equal(note(h).id, previous.id);
  assert.equal(note(h).path, previous.path);
  assert.equal(note(h).created, previous.created);
  assert.equal(note(h).body, "Entry to restore");
  assert.equal(note(h).finished, false);
  assert.equal(h.elements.get("undo-button").hidden, true);
  write(h, "Entry to restore, continued");
  await h.run("syncAll()");
  assert.deepEqual(a.writes.map((w) => w.kind), ["create", "update"]);
  assert.equal(a.writes[1].ifRevision, "1");
});

test("another tab's saver retains an entry during the undo window", async () => {
  const storage = memoryStorage();
  const h = harness("https://journal.test/?collection=a", storage);
  const a = collection("a");
  useCollection(h, a);
  write(h, "Recoverable entry");
  const id = note(h).id;
  h.run("newPage()");
  const other = harness("https://journal.test/?collection=a", storage);
  useCollection(other, a);
  await other.run("syncAll()");
  assert.equal(h.run(`readNote(${JSON.stringify(id)}).savedBody`), "Recoverable entry");
  h.run("undoNewPage()");
  assert.equal(note(h).id, id);
  assert.equal(note(h).body, "Recoverable entry");
});

test("undo expires and never discards writing on the new page", () => {
  const h = harness();
  write(h, "First entry");
  h.run("newPage()");
  h.expireUndo();
  assert.equal(h.elements.get("undo-button").hidden, true);
  const blankId = note(h).id;
  h.run("undoNewPage()");
  assert.equal(note(h).id, blankId);
  write(h, "Second entry");
  h.run("newPage()");
  const page = h.elements.get("page");
  page.value = "Third entry";
  page.emit("input");
  assert.equal(h.elements.get("undo-button").hidden, true);
  h.run("undoNewPage()");
  assert.equal(note(h).body, "Third entry");
});

test("collection switches do not offer undo back into a different collection", () => {
  const h = harness("https://journal.test/?collection=a");
  write(h, "Private A entry");
  h.run("selection.select('b'); newPage({ allowUndo: false });");
  assert.equal(note(h).targetCollectionId, "b");
  assert.equal(h.elements.get("undo-button").hidden, true);
});

test("header shows the selected collection name without showing a fake destination", () => {
  const h = harness("https://journal.test/?collection=a");
  h.run("connectionInfo = { collectionId: 'a', displayName: 'Personal' }; render();");
  assert.equal(h.elements.get("collection-name").textContent, "Personal");
  assert.equal(h.elements.get("collection-name").hidden, false);
  h.run("selection.select(null); connectionInfo = null; render();");
  assert.equal(h.elements.get("collection-name").hidden, true);
});

test("original page spacing is preserved with bottom scroll padding for the caret", () => {
  assert.match(html, /padding: 16vh 16px 40vh;/);
  assert.match(html, /scroll-padding-bottom: calc\(5rem \+ env\(safe-area-inset-bottom\)\);/);
  assert.doesNotMatch(html, /2lh/);
});

test("word count follows the writer's language, not just spaces", () => {
  const h = harness();
  assert.equal(h.run("countWords('')"), 0);
  assert.equal(h.run("countWords('  Fog over the river.\\n\\nTrees, only shapes. ')"), 7);
  assert.ok(h.run("countWords('今日は川に霧がかかっていた')") > 1, "unspaced scripts are segmented");
});

test("word count is shown only once something is written", () => {
  const h = harness();
  h.run("render()");
  assert.equal(h.elements.get("word-count").hidden, true);
  write(h, "One small entry");
  h.run("render()");
  assert.equal(h.elements.get("word-count").hidden, false);
  assert.equal(h.elements.get("word-count").textContent, "3 words");
});
