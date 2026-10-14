import assert from "node:assert/strict";
import {test} from "node:test";
import {JSDOM} from "jsdom";
import {completeAppGrantCallback, isAppGrantCallback} from "../src/grant-callback.js";
void test("grant callback detection needs state with code or error", () => {
  for (const query of ["?state=s&code=c", "?state=s&error=access_denied"]) assert(isAppGrantCallback(new URL(`https://journal.test/auth/mdbase/callback${query}`)));
  for (const query of ["", "?state=s", "?code=c", "?error=x"]) assert(!isAppGrantCallback(new URL(`https://journal.test/${query}`)));
});
void test("grant callback delivers without preempting original SDK finish and custody ACK", async () => {
  const h = new JSDOM('<main><textarea id="page"></textarea></main>'), delivered: string[] = [];
  const url = new URL("https://journal.test/auth/mdbase/callback?state=s&code=c");
  let closed = 0;const originalClose=h.window.close.bind(h.window);h.window.close=()=>{closed++;};
  assert(completeAppGrantCallback(url, {document: h.window.document, load: async () => ({deliverAppGrantCallback: href => {delivered.push(href);}})}));
  assert.equal(h.window.document.querySelector("main")!.textContent, "You can close this window.");
  assert.equal(h.window.document.querySelector("textarea"), null);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,0);assert.deepEqual(delivered, [url.href]); originalClose();
});
void test("grant callback does not self-close on failed delivery; other pages are untouched", async () => {
  const h = new JSDOM("<main><textarea></textarea></main>");
  let loads = 0; const load = () => {loads++; return Promise.reject(new Error("offline"));};
  assert(!completeAppGrantCallback(new URL("https://journal.test/"), {document: h.window.document, load}));
  assert.equal(loads, 0); assert(h.window.document.querySelector("textarea"));
  let closed=0;const originalClose=h.window.close.bind(h.window);h.window.close=()=>{closed++;};completeAppGrantCallback(new URL("https://journal.test/?state=s&error=x"), {document: h.window.document, load});
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(closed,0);
  originalClose();
});
