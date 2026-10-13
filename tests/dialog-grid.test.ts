import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {JSDOM} from "jsdom";

test("every shipped Journal dialog grid has zero-minimum tracks instead of intrinsic-width overflow", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/journal.css", import.meta.url), "utf8");
  const window = new JSDOM(html, {runScripts: "outside-only"}).window;
  try {
    const style = window.document.createElement("style"); style.textContent = css; window.document.head.append(style);
    const dialogs = [...window.document.querySelectorAll("dialog")];
    assert.deepEqual(dialogs.map(dialog => dialog.id), ["menu", "entries"], "all shipped dialogs are inspected; prototype setup dialogs are not shipped");
    const grids = dialogs.flatMap(dialog => [...dialog.querySelectorAll(".sheet, .row, #pending-details")]);
    assert(grids.length >= 9);
    for (const grid of grids) {
      const computed = window.getComputedStyle(grid);
      assert.equal(computed.display, grid.hasAttribute("hidden") ? "none" : "grid");
      assert.match(computed.gridTemplateColumns, /^minmax\(0,\s*1fr\)$/);
      assert.match(computed.minWidth, /^0(?:px)?$/);
      assert.equal(computed.width, "", "no fixed grid width masks the overflow");
    }
  } finally {window.close();}
});
