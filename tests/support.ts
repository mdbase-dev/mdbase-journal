import type {MdbaseApplicationConnection, MdbaseApplicationSnapshot, wire} from "@mdbase-dev/sdk";
import {createTestMdbase} from "@mdbase-dev/sdk/testing";
import {shareTestDocument} from "@mdbase-dev/ui/collections/testing";
import {JSDOM} from "jsdom";
import {JOURNAL_CONTRACT} from "../src/journal-data.js";
// The shared collection UI's React and focus code read the global window and
// document. Tests render into their own JSDOM documents.
shareTestDocument(new JSDOM("").window);
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
/** The SDK's test front door over one collection. `confirmed: false` keeps
 * writes pending (the log is unreachable) until `replica.confirmAll()`. */
export async function applicationFixture({confirmed = true} = {}) {
  const mdbase = await createTestMdbase({collections: [{name: "Writing", role: "owner"}]});
  const {fixture} = mdbase, replica = fixture.replica(), records = fixture.client();
  if (!confirmed) replica.setOnline(false);
  const ready = fixture.application.getSnapshot() as MdbaseApplicationSnapshot;
  let active = true;
  const connection: MdbaseApplicationConnection = {...fixture.entry.connection(records.collection)!, isCurrent: () => active};
  return {replica, records, connection, fixture, mdbase, ready, retire: () => {active = false;}, close: () => {void fixture.close();}};
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
/** Exclusive Web Locks stand-in shared by the simulated tab navigators. */
export function memoryLocks(): LockManager {
  const tails = new Map<string, Promise<void>>();
  return {request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) {
    const previous = tails.get(name) ?? Promise.resolve(), done = deferred<void>();
    tails.set(name, previous.then(() => done.promise));
    return (async () => {
      const aborted = deferred<never>();
      const abort = () => aborted.reject(new Error("Lock request aborted"));
      options.signal?.addEventListener("abort", abort, {once: true});
      try {
        if (options.signal?.aborted) throw new Error("Lock request aborted");
        await Promise.race([previous, aborted.promise]);
        options.signal?.removeEventListener("abort", abort);
        return await callback({name, mode: "exclusive"});
      } finally {options.signal?.removeEventListener("abort", abort); done.resolve();}
    })();
  }} as LockManager;
}
