import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock, test} from "node:test";
import {JSDOM} from "jsdom";
import {JournalDrafts} from "../src/drafts.js";
import {journalConnection} from "../src/application.js";
import {mountJournal} from "../src/view.js";
import {applicationFixture, catalog, deferred, memoryStorage} from "./support.js";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("the opening status meets WCAG AA in light and dark mode", async () => {
  const f = await applicationFixture();
  const {window} = new JSDOM(html);
  const {document} = window;
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL("../public/journal.css", import.meta.url), "utf8");
  document.head.append(style);
  const drafts = new JournalDrafts(memoryStorage());
  const mdbase = {...f.mdbase, getSnapshot: () => ({...f.mdbase.getSnapshot(),
    phase: {kind: "opening" as const, collectionId: f.connection.id, displayName: "Writing", slow: false}})};
  const view = mountJournal(document, drafts, mdbase);
  try {
    assert.match(document.getElementById("status")!.textContent!, /Opening Writing/);
    const button = document.getElementById("status-button")!;
    assert(button.classList.contains("notice"));
    const luminance = (rgb: number[]) => rgb.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
    const rgb = (hex: string) => hex.trim().slice(1).match(/../g)!.map(pair => parseInt(pair, 16));
    for (const theme of ["light", "dark"]) {
      document.documentElement.dataset.theme = theme;
      const palette = window.getComputedStyle(document.documentElement);
      const background = rgb(palette.getPropertyValue("--bg"));
      const foreground = rgb(palette.getPropertyValue("--muted"));
      const opacity = Number(window.getComputedStyle(button).opacity || 1);
      const composited = foreground.map((value, i) => value * opacity + background[i]! * (1 - opacity));
      const values = [luminance(background), luminance(composited)];
      const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
      assert(ratio >= 4.5, `${theme} opening status contrast is ${ratio.toFixed(2)}:1`);
    }
  } finally {view.dispose(); window.close(); await f.fixture.close();}
});
test("advisory list unavailability cannot retire the original ready lease, clear writing or change its identity", async () => {
  const f = await applicationFixture(), job = deferred<ReturnType<typeof catalog>>(), describe = mock.method(f.records, "describe", () => job.promise);
  const h = new JSDOM(html, {runScripts: "outside-only"}), drafts = new JournalDrafts(memoryStorage());
  const originalLease = journalConnection(f.mdbase), view = mountJournal(h.window.document, drafts, f.mdbase);
  try {
    const page = h.window.document.getElementById("page") as HTMLTextAreaElement;
    page.value = "uipolish: keep original writing"; page.dispatchEvent(new h.window.Event("input")); const original = view.currentDraft();
    const entry = {...f.ready.collections[0]!, availability: {state: "unavailable" as const, reason: "device_offline" as const}};
    f.fixture.controls.publishSnapshot({...f.ready, collections: [entry]});
    assert.equal(journalConnection(f.mdbase), originalLease); assert.equal(view.currentDraft().id, original.id); assert.equal(page.value, original.body);
    assert.equal(drafts.get(original.id)?.targetCollectionId, original.targetCollectionId);
    view.newPage(); view.undoNewPage(); assert.equal(page.value, original.body); assert.equal(view.currentDraft().id, original.id);
  } finally {view.dispose(); describe.mock.restore(); job.resolve(catalog()); h.window.close(); f.close();}
});
