import {createTestMdbase} from "@mdbase-dev/sdk/testing";
import {JournalDrafts} from "../src/drafts.ts";
import {JOURNAL_CONTRACT} from "../src/journal-data.ts";
import {mountJournal} from "../src/view.ts";

const el = id => document.getElementById(id);
const pastDate = "2010-01-01";
const largeBody = "A line of journal writing.\n".repeat(2048);
const recordId = index => "018e0000-0000-7000-8000-" + (index + 1).toString(16).padStart(12, "0");
const pastId = recordId(0);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function until(check) {
  const deadline = performance.now() + 10000;
  while (!check()) {
    if (performance.now() > deadline) throw Error("Timed out waiting for " + check);
    await tick();
  }
}

export async function start(size, recovery = false) {
  const type = "journal-bench-entry";
  const records = Array.from({length: size}, (_, index) => {
    const created = new Date(Date.UTC(2010, 0, index + 1, 12)).toISOString();
    return {id: recordId(index), path: 'journal/' + created.slice(0, 10) + '.md',
      types: [type], frontmatter: {created}};
  });
  const original = records[0];
  const mdbase = await createTestMdbase({collections: [{name: "Writing", contracts: [
    {id: JOURNAL_CONTRACT.id, version: JOURNAL_CONTRACT.version, type, fields: {created: "created"}, contractDigest: JOURNAL_CONTRACT.digest}
  ]}]});
  const client = mdbase.fixture.client();
  await client.settle(client.create({id: pastId, path: original.path, type, frontmatter: original.frontmatter, body: largeBody}));
  let historyReads = 0;
  client.pages = async function* () {
    for (let i = 0; i < size; i += 500) yield {complete: true, records: records.slice(i, i + 500)};
    historyReads++;
  };
  const drafts = new JournalDrafts(localStorage, undefined, op => navigator.locks.request("journal.native.drafts", op));
  if (recovery) await drafts.mutate(() => drafts.put({...drafts.blank(client.collection), body: "Keep my local changes",
    path: original.path, recordId: pastId, savedBody: largeBody, reviewRequired: true}));
  const start = performance.now();
  const view = await drafts.mutate(() => mountJournal(document, drafts, mdbase));
  await until(() => historyReads > 0);
  return {startup: performance.now() - start, async sample() {
    const t = performance.now();
    el("browse-button").click();
    await until(() => el("entry-range").textContent === '1–50 of ' + size && !el("entries-status").textContent);
    const picker = performance.now() - t;
    const p = performance.now();
    el("older-entries").click();
    if (el("entry-range").textContent !== '51–100 of ' + size) throw Error("Wrong page");
    const paginate = performance.now() - p;
    const d = performance.now();
    el("entry-date").value = pastDate;
    el("entry-date").dispatchEvent(new Event("input"));
    if (el("entry-list").children.length !== 1) throw Error("Wrong date");
    const filter = performance.now() - d;
    el("entry-list").firstElementChild.click();
    await until(() => el("page").value === largeBody && el("status").textContent === "Saved");
    const input = el("page");
    const k = performance.now();
    input.setRangeText("!", input.value.length, input.value.length, "end");
    input.dispatchEvent(new Event("input"));
    const typing = performance.now() - k;
    await until(() => view.currentDraft().savedBody === largeBody + "!");
    return {picker, paginate, filter, typing, autosave: performance.now() - k};
  }};
}
