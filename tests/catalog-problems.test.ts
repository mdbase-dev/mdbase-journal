import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock, test} from "node:test";
import {JSDOM} from "jsdom";
import {uuidv7, type DescribeResult} from "@mdbase-dev/sdk";
import {JournalDrafts} from "../src/drafts.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const GENERIC = /Something went wrong/;
function dom() {
  const window = new JSDOM(html, {url: "https://journal.fixture/", runScripts: "outside-only"}).window;
  const page = window.document.querySelector<HTMLTextAreaElement>("#page")!;
  const text = (id: string) => window.document.getElementById(id)!.textContent!;
  return {window, page, text, write(body: string) {page.value = body; page.dispatchEvent(new window.Event("input", {bubbles: true}));}};
}
/** Catalogs SDK readiness accepts (the contract exists and a type claims it)
 * but which give Journal no usable entry type. */
const broken: [string, () => DescribeResult, RegExp][] = [
  ["the contract is missing", () => ({...catalog(), contracts: []}), /required Journal contract/],
  ["no type maps the created field", () => {
    const value = catalog(); value.types[0]!.implements[0]!.fields = {}; return value;
  }, /no Journal entry type/],
  ["the created field is nested", () => catalog("meta.created"), /maps the journal\.entry created field to meta\.created/],
  ["a type implements the contract twice", () => {
    const value = catalog(); value.types[0]!.implements.push({...value.types[0]!.implements[0]!}); return value;
  }, /collection-owned-entry has an ambiguous Journal type binding/],
];
for (const [name, value, detail] of broken) void test(`a catalog where ${name} explains itself instead of a generic error`, async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  const describe = mock.method(f.records, "describe", async () => value()), create = mock.method(f.records, "create");
  const warn = mock.method(console, "warn", () => {});
  const view = mountJournal(h.window.document, drafts, f.mdbase);
  try {
    await turn();
    h.write("Text that must stay on this device");
    await turn();
    assert.equal(h.text("status"), "Journal can't save to this collection");
    assert.doesNotMatch(h.text("status"), GENERIC);
    assert.match(h.window.document.getElementById("status")!.title, detail);
    assert.match(h.text("menu-connection"), detail);
    assert.match(h.text("menu-connection"), /stay on this device/);
    assert.equal(create.mock.callCount(), 0);
    assert.equal(drafts.get(view.currentDraft().id)?.body, "Text that must stay on this device");
    assert.equal(warn.mock.callCount(), 1);
  } finally {view.dispose(); describe.mock.restore(); create.mock.restore(); warn.mock.restore(); h.window.close(); f.close();}
});
void test("an uncoded catalog failure names what failed, not a generic error", async () => {
  const f = await applicationFixture(), h = dom();
  const describe = mock.method(f.records, "describe", async () => {throw new TypeError("unexpected");});
  const warn = mock.method(console, "warn", () => {});
  const view = mountJournal(h.window.document, new JournalDrafts(memoryStorage()), f.mdbase);
  try {
    await turn();
    assert.equal(h.text("status"), "Journal couldn't read this collection's entry types");
    assert.match(h.text("menu-connection"), /Reload to try again/);
  } finally {view.dispose(); describe.mock.restore(); warn.mock.restore(); h.window.close(); f.close();}
});
void test("repairing the collection's entry type clears the problem without a reload", async () => {
  const f = await applicationFixture(), h = dom(), drafts = new JournalDrafts(memoryStorage());
  let repaired = false;
  const describe = mock.method(f.records, "describe", async () => repaired ? catalog() : {...catalog(), contracts: []});
  const warn = mock.method(console, "warn", () => {});
  const view = mountJournal(h.window.document, drafts, f.mdbase);
  try {
    await turn();
    assert.equal(h.text("status"), "Journal can't save to this collection");
    const calls = describe.mock.callCount();
    repaired = true;
    // Any collection change (here another app's record) retries the catalog read.
    await f.records.settle(f.records.create({id: uuidv7(), path: "elsewhere.md", type: "collection-owned-entry",
      frontmatter: {created: new Date().toISOString()}, body: "Written elsewhere"}));
    for (let i = 0; i < 20 && h.text("status") === "Journal can't save to this collection"; i++) await turn();
    assert(describe.mock.callCount() > calls);
    assert.notEqual(h.text("status"), "Journal can't save to this collection");
    assert.match(h.text("menu-connection"), /^Notes save to /);
  } finally {view.dispose(); describe.mock.restore(); warn.mock.restore(); h.window.close(); f.close();}
});
