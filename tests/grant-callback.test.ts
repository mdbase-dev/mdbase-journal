import assert from "node:assert/strict";
import {test} from "node:test";
import {JSDOM} from "jsdom";
import {completeAppGrantCallback, isAppGrantCallback} from "../src/grant-callback.js";
void test("grant callback detection needs state with code or error", () => {
  for (const query of ["?state=s&code=c", "?state=s&error=access_denied"]) assert(isAppGrantCallback(new URL(`https://journal.test/auth/mdbase/callback${query}`)));
  for (const query of ["", "?state=s", "?code=c", "?error=x"]) assert(!isAppGrantCallback(new URL(`https://journal.test/${query}`)));
});
void test("grant callback delivers the full URL, shows the close message and closes", async () => {
  const h = new JSDOM('<main><textarea id="page"></textarea></main>'), delivered: string[] = [];
  const url = new URL("https://journal.test/auth/mdbase/callback?state=s&code=c");
  let closed!: () => void; const closing = new Promise<void>(resolve => {closed = resolve;});
  assert(completeAppGrantCallback(url, {document: h.window.document, load: async () => ({deliverAppGrantCallback: href => {delivered.push(href);}}), close: closed}));
  assert.equal(h.window.document.querySelector("main")!.textContent, "You can close this window.");
  assert.equal(h.window.document.querySelector("textarea"), null);
  await closing; assert.deepEqual(delivered, [url.href]); h.window.close();
});
void test("grant callback still closes when the SDK entry fails to load; other pages are untouched", async () => {
  const h = new JSDOM("<main><textarea></textarea></main>");
  let loads = 0; const load = () => {loads++; return Promise.reject(new Error("offline"));};
  assert(!completeAppGrantCallback(new URL("https://journal.test/"), {document: h.window.document, load, close: () => assert.fail("must not close")}));
  assert.equal(loads, 0); assert(h.window.document.querySelector("textarea"));
  await new Promise<void>(resolve => completeAppGrantCallback(new URL("https://journal.test/?state=s&error=x"), {document: h.window.document, load, close: resolve}));
  h.window.close();
});
