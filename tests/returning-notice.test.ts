import assert from "node:assert/strict";
import {test} from "node:test";
import {JSDOM} from "jsdom";
import {mountReturningNotice} from "../src/returning-notice.js";
import {memoryStorage} from "./support.js";
const marker = "journal.mdbase-upgrade-notice.v1";
function dom() {return new JSDOM('<main><textarea id="page" aria-label="Note"></textarea></main>');}
for (const key of ["journal.prefs.v1", "journal.prefs.v2", "journal.collection", "journal.note.old", "journal.native.note.old"]) test(`returning notice reads only old key presence: ${key}`, () => {
  const h = dom(), storage = memoryStorage(); storage.setItem(key, "original bytes"); const get = storage.getItem;
  storage.getItem = read => {if (read !== marker) throw new Error("old values must not be inspected"); return get(read);};
  mountReturningNotice(h.window.document, () => storage);
  const notice = h.window.document.querySelector("aside")!;
  assert.equal(notice.getAttribute("aria-label"), "mdbase update");
  assert(notice.textContent!.includes("mdbase was upgraded. Approve Journal once to continue. Your collections and notes are unchanged."));
  assert(notice.textContent!.includes("Private collections need your desktop online.")); assert.equal(get(key), "original bytes");
  const link = notice.querySelector("a")!; assert.equal(link.href, "https://mdbase.dev/"); assert.equal(link.rel, "noopener noreferrer");
  assert.equal(h.window.document.activeElement, h.window.document.body); h.window.close();
});
test("returning notice appears on only the first visit, even without dismissing", () => {
  const storage = memoryStorage(); storage.setItem("journal.collection", '"old"');
  const first = dom(); mountReturningNotice(first.window.document, () => storage); assert(first.window.document.querySelector("aside"));
  assert.equal(storage.getItem(marker), "seen"); first.window.close();
  const second = dom(); mountReturningNotice(second.window.document, () => storage); assert.equal(second.window.document.querySelector("aside"), null); second.window.close();
});
test("dismissal persists without clearing or blocking the writing surface", () => {
  const storage = memoryStorage(); storage.setItem("journal.note.old", "old"); const h = dom();
  const page = h.window.document.querySelector("textarea")!; page.value = "My unsaved writing"; page.focus();
  mountReturningNotice(h.window.document, () => storage); assert.equal(h.window.document.activeElement, page);
  h.window.document.querySelector("button")!.click(); assert.equal(h.window.document.querySelector("aside"), null); assert.equal(page.value, "My unsaved writing");
  assert.equal(page.disabled, false); mountReturningNotice(h.window.document, () => storage); assert.equal(h.window.document.querySelector("aside"), null); h.window.close();
});
test("new users never acquire a returning notice on later new-engine visits", () => {
  const storage = memoryStorage(), first = dom(); storage.setItem("another-app.setting", "old");
  mountReturningNotice(first.window.document, () => storage); assert.equal(first.window.document.querySelector("aside"), null); first.window.close();
  storage.setItem("journal.native.note.new", "new engine"); const second = dom();
  mountReturningNotice(second.window.document, () => storage); assert.equal(second.window.document.querySelector("aside"), null); second.window.close();
});
test("quota failure is harmless and dismissal survives remount for this lifetime", () => {
  const storage = memoryStorage(); storage.setItem("journal.prefs.v1", "original"); storage.setItem = () => {throw new Error("quota");};
  const h = dom(); mountReturningNotice(h.window.document, () => storage); h.window.document.querySelector("button")!.click();
  mountReturningNotice(h.window.document, () => storage); assert.equal(h.window.document.querySelector("aside"), null); assert.equal(storage.getItem(marker), null); h.window.close();
});
test("privacy-policy storage getter failure skips the notice without blocking writing", () => {
  const h = dom(); mountReturningNotice(h.window.document, () => {throw new Error("policy");});
  assert.equal(h.window.document.querySelector("aside"), null); assert.equal(h.window.document.querySelector("textarea")!.disabled, false); h.window.close();
});
