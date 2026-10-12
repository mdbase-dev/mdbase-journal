import {connect, MdbasePeopleClient, type Mdbase, type MdbaseApplicationEntry, type MdbaseApplicationSnapshot, type MdbaseApplicationConnection, type MdbaseSnapshot, type wire} from "@mdbase-dev/sdk";
import {createApplicationFixture, MemoryReplica} from "@mdbase-dev/sdk/testing";
import {JSDOM} from "jsdom";
import {JOURNAL_CONTRACT} from "../src/journal-data.js";
// The shared collection UI renders with React, which reads the global window
// (window.event) while updating; its focus effects read document. Tests
// render into their own JSDOM documents.
if (typeof globalThis.window === "undefined") {
  const shared = new JSDOM("").window;
  Object.defineProperty(globalThis, "window", {configurable: true, value: shared});
  Object.defineProperty(globalThis, "document", {configurable: true, value: shared.document});
}
export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {get length() {return values.size;}, key: i => [...values.keys()][i] ?? null, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {values.set(key, String(value));}, removeItem: key => {values.delete(key);}, clear: () => values.clear()};
}
/** Controlled application/canonical-catalog metadata, NOT native runtime or
 * registration evidence. Record/file calls use the actual SDK protocol client. */
export function snapshot(patch: Partial<MdbaseApplicationSnapshot> = {}): MdbaseApplicationSnapshot {
  const facet = {checking: false, assessment: {status: "ready" as const, problem: null}, problem: null};
  const id = patch.selectedCollectionId ?? null, collection = patch.collections?.find(item => item.collectionId === id) ?? null;
  const usable = patch.status === "ready" || patch.status === "setup_required" ? collection : null;
  // Explicit controlled fixture selection, not an app URL/approval engine.
  const selection: MdbaseApplicationSnapshot["selection"] = {state: usable ? "usable" : id ? "pending" : "none", problem: null, usable,
    requested: {collectionId: id, source: id ? "user" : "none", displayName: collection?.displayName ?? null, approved: collection !== null}};
  return {status: "signed_out", signIn: null, collections: [], selectedCollectionId: null, timing: null, problem: null, selection,
    readiness: {...facet, facets: {capabilities: facet, contracts: facet, configuration: facet, files: facet, people: facet, notifications: facet}}, ...patch};
}
export function catalog(field = "created", name = "collection-owned-entry"): wire.DescribeResult {
  return {specVersion: "test", settings: new Map(), inclusion: {include: []}, issues: [],
    contracts: [{...JOURNAL_CONTRACT, path: "_contracts/journal.entry.md", contractType: "record", implementedBy: [name]}],
    types: [{name, path: "_types/custom.md", implements: [{contract: JOURNAL_CONTRACT.id, version: JOURNAL_CONTRACT.version, fields: new Map([["created", field]])}]}]};
}
export async function applicationFixture(confirmDelayMs: number | null = 0) {
  const replica = new MemoryReplica({confirmDelayMs});
  const records = await connect({connector: replica.connector(), app: {name: "journal-fixture", version: "test"}, reconnect: false});
  const people = new MdbasePeopleClient(records, {collection: records.collection, request: async () => {throw new Error("No People request in Journal fixture");}, isCurrent: () => true});
  let active = true;
  const connection: MdbaseApplicationConnection = {id: records.collection, displayName: "Writing", records, files: records.files, people,
    scope: {account: "fixture-account", installation: "fixture-installation", collection: records.collection}, generation: "fixture-generation", isCurrent: () => active};
  const ready = snapshot({status: "ready", selectedCollectionId: records.collection, collections: [{collectionId: records.collection, displayName: "Writing", role: "owner"}]});
  const fixture = createApplicationFixture({declaration: {id: "journal.fixture", name: "Journal", origin: "https://journal.fixture", environment: "lab", manifest: {id: "dev.journal.fixture"}}, connections: [connection], initialSnapshot: ready});
  return {replica, records, connection, fixture, mdbase: asMdbase(fixture.entry), ready, retire: () => {active = false;}, close: () => {fixture.controls.close(); records.close();}};
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
/** The fixture entry behind the same front door `createMdbase` builds over a real
 * entry (the fixture already derives `phase`, `sync` and `links`). The SDK's
 * testing module offers no `Mdbase` fixture yet. */
export function asMdbase(entry: MdbaseApplicationEntry): Mdbase {
  const app = entry.application(), view = () => app.getSnapshot() as MdbaseSnapshot;
  const then = async (pending: Promise<unknown>) => {await pending; return view();};
  return {getSnapshot: view, subscribe: listener => app.subscribe(listener), start: options => then(app.start(options)),
    signIn: options => then(app.authorize(options)), addCollection: options => then(app.approve(null, options)),
    approve: (id, options) => then(app.approve(id, options)), select: (id, options) => then(app.select(id, options)),
    chooseAnother: options => then(app.chooseAnother(options)),
    refreshCollectionList: (options) =>
      app.refreshCollectionList ? then(app.refreshCollectionList(options)) : Promise.reject(new Error("No refreshCollectionList")),
    reauthorize: (options) => then(app.reauthorize(options)),
    configure: (options) => then(app.configure(options)), forget: (id, options) => then(app.forget(id, options)),
    deleteCollection: (id, options) => then(app.deleteCollection(id, options)), requestAccess: (request, options) => app.requestAccess(request, options),
    assess: options => app.assess(options),
    setup: {plan: options => app.setup.plan(options), apply: async (plan, options) => ({outcome: "applied", snapshot: await then(app.setup.apply(plan, options))})},
    connection: id => entry.connection(id), setForeground: active => app.setForeground(active),
    signOut: options => {if (!app.signOut) throw new Error("No sign-out in this fixture"); return then(app.signOut(options));},
    close: () => app.close(), application: app};
}
