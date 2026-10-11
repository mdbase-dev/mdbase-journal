import {connect, MdbasePeopleClient, type MdbaseApplicationSnapshot, type MdbaseApplicationConnection, type wire} from "@mdbase-dev/sdk";
import {createApplicationFixture, MemoryReplica} from "@mdbase-dev/sdk/testing";
import {JOURNAL_CONTRACT} from "../src/journal-data.js";
export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {get length() {return values.size;}, key: i => [...values.keys()][i] ?? null, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {values.set(key, String(value));}, removeItem: key => {values.delete(key);}, clear: () => values.clear()};
}
/** Controlled application/canonical-catalog metadata, NOT native runtime or
 * registration evidence. Record/file calls use the actual SDK protocol client. */
export function snapshot(patch: Partial<MdbaseApplicationSnapshot> = {}): MdbaseApplicationSnapshot {
  const facet = {checking: false, assessment: {status: "ready" as const, problem: null}, problem: null};
  return {status: "signed_out", signIn: null, collections: [], selectedCollectionId: null, timing: null, problem: null,
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
  return {replica, records, connection, fixture, ready, retire: () => {active = false;}, close: () => {fixture.controls.close(); records.close();}};
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
