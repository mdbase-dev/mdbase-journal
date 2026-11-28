import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {setTimeout} from "node:timers/promises";
import {afterAll, bench, describe, vi} from "vitest";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.ts";
import {JournalData} from "../src/journal-data.ts";
import {mountJournal} from "../src/view.ts";

// The shared DOM test adapter installs browser globals. Tinybench's Node
// EventTarget requires Node's own Event even while React renders into JSDOM.
const nativeEvent = globalThis.Event;
const {applicationFixture, memoryStorage} = await import("../tests/support.ts");
globalThis.Event = nativeEvent;

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const entryType = {name: "collection-owned-entry", createdField: "created"};
const dateKey = new Intl.DateTimeFormat("sv-SE", {year: "numeric", month: "2-digit", day: "2-digit"});

async function history(size) {
  const fixture = await applicationFixture();
  const {window} = new JSDOM(html);
  const {document} = window;
  const drafts = new JournalDrafts(memoryStorage());
  const records = Array.from({length: size}, (_, index) => {
    const date = new Date(2010, 0, index + 1, 12);
    return {id: String(index), path: `journal/${dateKey.format(date)}.md`,
      types: [entryType.name], frontmatter: {created: date.toISOString()}};
  });
  // The SDK boundary delivers 500-record pages without network/replica latency.
  const pages = vi.spyOn(fixture.records, "pages").mockImplementation(async function* () {
    for (let start = 0; start < size; start += 500) yield {complete: true, records: records.slice(start, start + 500)};
  });
  const data = new JournalData(fixture.connection, drafts);
  const view = mountJournal(document, drafts, fixture.mdbase);
  const dialog = document.getElementById("entries");
  const date = document.getElementById("entry-date");
  const status = document.getElementById("entries-status");
  const list = document.getElementById("entry-list");
  dialog.showModal = () => dialog.setAttribute("open", "");
  document.getElementById("browse-button").click();
  for (let i = 0; i < 100 && (status.textContent || !list.children.length); i++) await setTimeout(5);
  assert.equal(status.textContent, "");
  assert.equal((await data.entries([entryType])).length, size);
  assert(list.children.length > 0);
  const dates = records.slice(0, 2).map(record => record.path.slice("journal/".length, -".md".length));
  console.log(`${size} saved entries: ${list.querySelectorAll("button").length} mounted entry buttons`);
  return {data, dates, filter(value) {date.value = value; date.dispatchEvent(new window.Event("input"));},
    async close() {view.dispose(); data.release(); pages.mockRestore(); window.close(); await fixture.fixture.close();}};
}

for (const size of [1_000, 5_000]) {
  const fixture = await history(size);
  afterAll(() => fixture.close());
  describe(`${size} daily entries`, () => {
    let day = 0;
    bench("parse, collect and sort SDK pages", async () => {await fixture.data.entries([entryType]);});
    bench("render the unfiltered entry picker", () => {fixture.filter("");}, {time: 300, iterations: 5, warmupTime: 200, warmupIterations: 2});
    bench("change the date filter", () => {fixture.filter(fixture.dates[day++ % fixture.dates.length]);});
  });
}
