import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineTypePack,
  formatValidationIssues,
  validateAppManifest
} from "@mdbase-dev/connect-dev";

/**
 * Builds `public/.well-known/mdbase-app.json` from the readable sources in `pack/`.
 * The contract is managed by Journal; the starter type is a seed that belongs
 * to the collection once installed. Run after editing anything in `pack/`.
 * `JOURNAL_ORIGIN` sets the homepage; without it, the pages.dev origin is used.
 */

export const JOURNAL_MANIFEST_ID = "dev.mdbase.journal-prototype";
export const DEFAULT_JOURNAL_ORIGIN = "https://mdbase-journal.callum-artifacts.pages.dev";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, "pack", path), "utf8");

export async function buildJournalManifest({ origin = DEFAULT_JOURNAL_ORIGIN, allowLocal = false } = {}) {
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

  // Sign-in uses the ordinary web flow, so the manifest names the one origin this build runs on.
  const homepage = new URL("/", origin).href;

  const manifest = {
    manifest_version: 1,
    id: JOURNAL_MANIFEST_ID,
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
      },
      // Next accounts approve each record capability together with its file
      // actions: reading needs list and read, creating needs add, editing
      // needs replace and move.
      files: {
        required: ["list", "read", "add", "replace", "move"],
        scope: { kind: "collection" }
      }
    },
    provisions: { type_packs: [pack] }
  };

  const result = validateAppManifest(manifest, { allowLocal });
  if (!result.valid) throw new Error(formatValidationIssues(result.issues));
  return manifest;
}

export async function writeJournalManifest(manifest, output = resolve(root, "public")) {
  await mkdir(resolve(output, ".well-known"), { recursive: true });
  await writeFile(resolve(output, ".well-known/mdbase-app.json"), JSON.stringify(manifest, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await buildJournalManifest({ origin: process.env.JOURNAL_ORIGIN ?? DEFAULT_JOURNAL_ORIGIN });
  await writeJournalManifest(manifest);
  const pack = manifest.provisions.type_packs[0];
  console.log(`Wrote public/.well-known/mdbase-app.json (${pack.provides.map((c) => `${c.id}@${c.version}`).join(", ")})`);
}
