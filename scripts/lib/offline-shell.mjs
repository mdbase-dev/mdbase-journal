// Data-only validation of the ACTUAL eaa4e697 SDK adapter's embedded manifest.
// No eval/import of generated workers, no fictional standalone sidecar, and NO
// substitution of the cache subset for the independent FULL final inventory.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertInventory } from "./native-publish-bytes.mjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
const check = (ok, reason) => {
  if (!ok) throw Error("Journal offline-shell refusal: " + reason);
};
export const offlineShellFiles = Object.freeze({
  worker: "mdbase-shell-sw.js",
  runtime: "mdbase-shell-runtime.js",
  registration: "mdbase-shell-register.js",
});
const marker = "\n// mdbase shared offline shell\n";
const prefix =
  marker +
  'import {installOfflineShell} from "./mdbase-shell-runtime.js";\ninstallOfflineShell(self, ';
const suffix = ");\n";
export function parseEmbeddedOfflineManifest(bytes) {
  check(bytes.length <= 4 * 1024 * 1024, "worker size");
  const text = bytes.toString("utf8");
  check(text.startsWith(prefix) && text.endsWith(suffix), "unknown canonical worker syntax");
  const literal = text.slice(prefix.length, -suffix.length);
  let manifest;
  try {
    manifest = JSON.parse(literal);
  } catch {
    throw Error("Journal offline-shell refusal: invalid embedded JSON");
  }
  check(JSON.stringify(manifest) === literal, "noncanonical/duplicate embedded JSON");
  check(
    Object.keys(manifest).join(",") === "base,version,assets" &&
      manifest.base === "/" &&
      /^[a-f0-9]{64}$/.test(manifest.version ?? "") &&
      Array.isArray(manifest.assets),
    "canonical manifest shape",
  );
  check(manifest.assets.length > 0 && manifest.assets.length <= 10000, "asset count");
  const paths = new Set();
  let prior = "";
  for (const asset of manifest.assets) {
    check(
      asset &&
        Object.keys(asset).join(",") === "path,sha256" &&
        typeof asset.path === "string" &&
        asset.path.length <= 1024 &&
        asset.path
          .split("/")
          .every((p) => /^[A-Za-z0-9._~-]+$/.test(p) && p !== "." && p !== "..") &&
        /^[a-f0-9]{64}$/.test(asset.sha256 ?? ""),
      "unsafe embedded asset",
    );
    check(!paths.has(asset.path) && asset.path > prior, "duplicate/unsorted embedded assets");
    paths.add(asset.path);
    prior = asset.path;
  }
  check(
    manifest.version === hash(JSON.stringify({ base: "/", assets: manifest.assets, existing: "" })),
    "cache version does not bind exact assets/empty Journal worker prefix",
  );
  return manifest;
}
function eligible(path) {
  return (
    path !== offlineShellFiles.worker &&
    !path.split("/").some((p) => p.startsWith(".") || p.startsWith("_")) &&
    /\.(?:html|js|mjs|css|wasm|woff2?|ttf|svg|png|webp|jpg|jpeg|ico|json|webmanifest)$/.test(path)
  );
}
export function checkOfflineManifest(worker,inventory) {
  const manifest=parseEmbeddedOfflineManifest(Buffer.from(worker));
  const assets=inventory.filter(row=>eligible(row.path)).map(({path,sha256})=>({path,sha256})).sort((a,b)=>a.path<b.path?-1:1);
  check(JSON.stringify(manifest.assets)===JSON.stringify(assets),"every full-inventory cacheable path required");
  check(manifest.version===hash(JSON.stringify({base:"/",assets,existing:""})),"original SDK cache version");
  return manifest;
}
export async function assertOfflineShell(root, inventory, original) {
  await assertInventory(root, inventory); // independent ALL-path/all-byte check first
  check(
    original &&
      /^[a-f0-9]{64}$/.test(original.runtime?.sha256 ?? "") &&
      /^[a-f0-9]{64}$/.test(original.registration?.sha256 ?? ""),
    "original SDK offline expectations missing",
  );
  const rows = new Map(inventory.map((r) => [r.path, r]));
  check(rows.size === inventory.length, "duplicate full inventory");
  for (const name of Object.values(offlineShellFiles))
    check(rows.has(name), "missing actual offline-shell output");
  const worker = await readFile(join(root, offlineShellFiles.worker));
  const row = rows.get(offlineShellFiles.worker);
  check(
    worker.length === row.bytes && hash(worker) === row.sha256,
    "worker differs from full final inventory",
  );
  const manifest = checkOfflineManifest(worker,inventory);
  const expected = inventory
    .filter((r) => eligible(r.path))
    .map(({ path, sha256 }) => ({ path, sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  check(
    JSON.stringify(manifest.assets) === JSON.stringify(expected),
    "EVERY cacheable final path/hash must equal embedded manifest; no subset omission",
  );
  for (const path of ["index.html", offlineShellFiles.runtime, offlineShellFiles.registration])
    check(
      manifest.assets.some((a) => a.path === path),
      "required cached shell asset",
    );
  for (const [key, path] of [
    ["runtime", offlineShellFiles.runtime],
    ["registration", offlineShellFiles.registration],
  ]) {
    const r = rows.get(path),
      expected = original[key];
    check(
      r.sha256 === expected.sha256 && r.bytes === expected.bytes,
      "offline output differs from original SDK-derived bytes",
    );
    const bytes = await readFile(join(root, path));
    check(
      bytes.length === r.bytes && hash(bytes) === r.sha256,
      "offline file differs from full inventory",
    );
  }
  return {
    worker: offlineShellFiles.worker,
    version: manifest.version,
    cachedAssets: manifest.assets.length,
    fullInventoryFiles: inventory.length,
    workerSha256: row.sha256,
    proof:
      "embedded JSON + original SDK runtime/registration bytes + independent FULL final inventory; not service-worker execution/admission",
  };
}
