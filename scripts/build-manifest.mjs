import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  defineTypePack,
  formatValidationIssues,
  validateAppManifest
} from "@mdbase-dev/connect-dev";

/**
 * Builds `public/.well-known/mdbase-app.json` from the readable sources in `pack/`.
 * The contract is managed by Journal; the starter type is a seed that belongs
 * to the collection once installed. Run after editing anything in `pack/`.
 */

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, "pack", path), "utf8");

const pack = defineTypePack({
  id: "journal.entry",
  version: "0.1.1",
  name: "Journal entries",
  description: "The journal.entry contract and a starter type that implements it.",
  resources: [
    {
      kind: "contract",
      mode: "managed",
      source: "contracts/journal.entry/0.1.0.md",
      target: "_contracts/journal.entry.md",
      document: await read("contracts/journal.entry/0.1.0.md")
    },
    {
      kind: "type",
      mode: "seed",
      source: "types/journal-entry/2.md",
      target: "_types/journal-entry.md",
      document: await read("types/journal-entry/2.md")
    }
  ]
});

// Version 1 of the starter type matched and required a `type` property, which fails in
// collections whose type key is something else (such as `mdbase_type`). A seed belongs to
// the collection once installed, so offer v2 as a reviewed upgrade from the exact v1 bytes.
const starterV1 = await read("types/journal-entry/1.md");
const starter = pack.manifest.resources.find((resource) => resource.kind === "type");
starter.upgrade_from = {
  digest: `sha256:${createHash("sha256").update(starterV1).digest("hex")}`,
  document: starterV1
};

// Sign-in uses the ordinary web flow, so the manifest names the one origin Journal runs on.
const homepage = "https://mdbase-journal.callum-artifacts.pages.dev/";

const manifest = {
  manifest_version: 1,
  id: "dev.mdbase.journal-prototype",
  name: "Journal (prototype)",
  homepage,
  icon: new URL("pwa-512.png", homepage).href,
  redirect_uris: [new URL("auth/mdbase/callback", homepage).href],
  requirements: {
    contracts: pack.provides,
    access: "full_collection",
    capabilities: {
      contract_version: 2,
      required: ["collection.read", "records.create", "records.edit"]
    }
  },
  provisions: { type_packs: [pack] }
};

const result = validateAppManifest(manifest);
if (!result.valid) {
  console.error(formatValidationIssues(result.issues));
  process.exit(1);
}
await mkdir(resolve(root, "public/.well-known"), { recursive: true });
await writeFile(resolve(root, "public/.well-known/mdbase-app.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote public/.well-known/mdbase-app.json (${pack.provides.map((c) => `${c.id}@${c.version}`).join(", ")})`);
