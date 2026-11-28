import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {build} from "esbuild";

const require = createRequire(new URL("../tools/smoke/package.json", import.meta.url));
const {chromium} = require("playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = await readFile(new URL("./browser-fixture.mjs", import.meta.url), "utf8");
async function assetsFor(directory) {
  const bundle = await build({stdin: {contents: fixture, resolveDir: resolve(directory, "benchmarks")},
    bundle: true, write: false, format: "iife", globalName: "JournalFixture", define: {"process.env.NODE_ENV": '"production"'}});
  const packages = createRequire(resolve(directory, "package.json"));
  const styles = await build({entryPoints: [packages.resolve("@mdbase-dev/ui/collections.css")], bundle: true, write: false});
  return new Map([
    ["/", ["text/html", await readFile(resolve(directory, "public/index.html"), "utf8")]],
    ["/journal.js", ["text/javascript", bundle.outputFiles[0].text + "\nglobalThis.JournalFixture = JournalFixture;"]],
    ["/mdbase-shell-register.js", ["text/javascript", ""]],
    ["/journal.css", ["text/css", await readFile(resolve(directory, "public/journal.css"), "utf8")]],
    ["/mdbase-collections.css", ["text/css", styles.outputFiles[0].text]]
  ]);
}
const headAssets = await assetsFor(root);
const browser = await chromium.launch();
async function open(options = {}, assets = headAssets) {
  const page = await browser.newPage({timezoneId: "UTC", reducedMotion: "reduce", ...options});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    const asset = url.origin === "https://journal.test" && assets.get(url.pathname);
    return asset ? route.fulfill({contentType: asset[0], body: asset[1]}) : route.abort();
  });
  await page.goto("https://journal.test/");
  return page;
}
async function benchmark(base) {
  const revisions = [{name: "head", assets: headAssets}];
  if (base) revisions.unshift({name: "base", assets: await assetsFor(base)});
  for (const size of [5000, 10000]) {
    const samples = new Map(revisions.map(({name}) => [name, []]));
    for (let i = 0; i <= 9; i++) {
      for (const revision of i % 2 ? revisions.toReversed() : revisions) {
        const page = await open({}, revision.assets);
        try {
          const row = await page.evaluate(async size => {
            const fixture = await JournalFixture.start(size);
            return {startup: fixture.startup, ...await fixture.sample()};
          }, size);
          if (i) samples.get(revision.name).push(row);
        } finally {await page.close();}
      }
    }
    for (const [name, rows] of samples) for (const key of Object.keys(rows[0])) {
      const values = rows.map(row => row[key]).sort((a, b) => a - b);
      console.log(name, size, key, "median", values[4].toFixed(2), "p95", values[8].toFixed(2), "ms");
    }
  }
}
async function audit() {
  let failures = 0;
  for (const width of [360, 1280]) for (const colorScheme of ["light", "dark"]) {
    const options = {viewport: {width, height: 800}, colorScheme, hasTouch: width === 360};
    const page = await open(options);
    async function scan(name) {
      const result = await page.evaluate(async () => {
        const scopes = [document.documentElement, ...document.querySelectorAll("dialog[open], dialog[open] .sheet")];
        const overflow = scopes.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.id || el.tagName);
        const {violations} = await axe.run(document, {runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]});
        return {overflow, violations: violations.map(v => [v.id, v.nodes.map(n => [n.target, n.failureSummary])])};
      });
      console.log(width, colorScheme, name, JSON.stringify(result));
      if (result.violations.length || result.overflow.length) failures++;
    }
    try {
      await page.evaluate(() => JournalFixture.start(5000).then(() => {}));
      await page.addScriptTag({path: require.resolve("axe-core/axe.min.js")});
      await scan("Today");
      await page.locator("#browse-button").click();
      await page.locator("#entry-range").getByText("1–50 of 5000").waitFor();
      await scan("Picker");
      await page.keyboard.press("Escape");
      // Let the native dialog close event and any app focus handler finish.
      await page.waitForFunction(() => !document.querySelector("#entries").open);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      if (await page.evaluate(() => document.activeElement.id) !== "browse-button") {
        console.error("Picker dismissal lost opener focus", width, colorScheme);
        failures++;
      }
      await page.locator("#browse-button").click();
      await page.locator("#entry-date").fill("2010-01-01");
      await scan("Date search");
      await page.locator("#entry-list button").click();
      await page.waitForFunction(() => document.querySelector("#page").value.length > 50000 && document.activeElement.id === "page");
      await scan("Past entry");
      await page.locator("#page").press("Control+End");
      await page.keyboard.insertText("!");
      if (width === 360) {
        const visible = await page.evaluate(() => ["header", ".context", "#menu-button"].every(selector =>
          Number(getComputedStyle(document.querySelector(selector)).opacity) === 1));
        if (!visible) {console.error("Touch navigation faded while typing", colorScheme); failures++;}
        await scan("Touch typing");
      }
      await page.mouse.move(10, 10);
      await page.locator("#menu-button").click();
      await scan("Settings");
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(() => document.activeElement.id), "menu-button");
      await page.reload();
      await page.evaluate(() => {localStorage.clear(); return JournalFixture.start(5000, true).then(() => {});});
      await page.locator("#draft-conflict").waitFor();
      await page.addScriptTag({path: require.resolve("axe-core/axe.min.js")});
      await scan("Recovery");
    } finally {await page.close();}
  }
  assert.equal(failures, 0, "axe, overflow, focus or touch visibility checks failed");
}
try {
  console.log("Chromium", browser.version());
  if (process.argv[2] === "axe") await audit();
  else if (process.argv[2] === "bench") await benchmark(process.argv[3]);
  else throw Error("Choose bench or axe");
} finally {await browser.close();}
