import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import { buildSdk } from "../scripts/build-sdk.mjs";

await buildSdk();
const { SDK_ASSET } = await import("../public/sdk/pin.mjs");
const { loadNativeSdk } = await import("../public/load-native-sdk.mjs");
const browser = await readFile(new URL("../public/sdk/mdbase-sdk.min.js", import.meta.url));

function harness() {
  const global = vm.createContext({ TextEncoder, TextDecoder, URL, crypto: webcrypto, setTimeout, clearTimeout });
  let script;
  const document = {
    createElement() { return { remove() { this.removed = true; } }; },
    head: { append(element) { script = element; } },
  };
  return {
    global, document,
    get script() { return script; },
    load() { vm.runInContext(browser.toString(), global); script.onload(); },
  };
}

test("local compatibility build copies the original dev archive browser asset and derives SRI", () => {
  assert.equal(createHash("sha256").update(browser).digest("hex"), SDK_ASSET.sha256);
  assert.equal(SDK_ASSET.integrity, `sha384-${createHash("sha384").update(browser).digest("base64")}`);
  assert.equal(SDK_ASSET.sourceCommit, "3f417b6d941a42444f17568d7489071d23fcb141");
});

test("classic-script loader returns the actual SDK public namespaces without opening a client", async () => {
  const h = harness();
  const pending = loadNativeSdk(h);
  assert.equal(h.script.integrity, SDK_ASSET.integrity);
  assert.equal(h.script.crossOrigin, "anonymous");
  assert.ok(h.script.src.endsWith("/public/sdk/mdbase-sdk.min.js"));
  h.load();
  const sdk = await pending;
  assert.equal(sdk, h.global.MdbaseSDK);
  assert.equal(typeof sdk.Client.MdbaseClient.prototype.create, "function");
  assert.equal(typeof sdk.AppHost.AppWebSignInSession, "function");
  assert.equal(typeof sdk.AppHost.selectAppEnvironment, "function");
  assert.equal(typeof sdk.AppHost.createAppWebCollectionAdapter, "function");
  assert.equal(typeof sdk.AppHost.openAppWebCollectionClient, "function");
  assert.equal(h.script.removed, true);
});

test("original cancellation before load injects no script", () => {
  const h = harness();
  const controller = new AbortController();
  const reason = new Error("original owner cancelled");
  controller.abort(reason);
  assert.throws(() => loadNativeSdk({ ...h, signal: controller.signal }), (error) => error === reason);
  assert.equal(h.script, undefined);
});

test("original cancellation during load never delivers the SDK", async () => {
  const h = harness();
  const controller = new AbortController();
  const pending = loadNativeSdk({ ...h, signal: controller.signal });
  const reason = new Error("cancelled while loading");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(h.script.removed, true);
  assert.equal(h.script.onload, null);
});

test("asset failure refuses instead of falling back to old Connect or a CDN", async () => {
  const h = harness();
  const pending = loadNativeSdk(h);
  h.script.onerror();
  await assert.rejects(pending, /failed to load/);
  assert.equal(h.global.MdbaseSDK, undefined);
  assert.equal(h.script.removed, true);
});

test("an unknown pre-existing SDK global is not accepted as the qualified asset", () => {
  const h = harness();
  h.global.MdbaseSDK = {};
  assert.throws(() => loadNativeSdk(h), /already exists/);
  assert.equal(h.script, undefined);
});
