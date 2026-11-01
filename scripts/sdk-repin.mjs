import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { verifiedArchive, verifiedPackage, verifyLockIntegrities } from "./lib/npm-provenance.mjs";
import { loadOriginals, protectedHashes } from "./lib/native-originals.mjs";

export function productionIdentity(record, release, tag) {
  if (!/^v0\.1\.0-beta\.[1-9][0-9]*$/.test(release)) {
    throw new Error("connect_release must be v0.1.0-beta.N");
  }
  const recordedRelease = record.match(/^MDBASE_CONNECT_RELEASE=(.+)$/m)?.[1];
  const commit = record.match(/^MDBASE_CONNECT_COMMIT=([0-9a-f]{40})$/m)?.[1];
  if (recordedRelease !== release || !commit || tag !== commit) {
    throw new Error("Connect tag does not match ops main's production record");
  }
  return commit;
}

export function repinPlan(manifests, version) {
  const packages = new Set();
  const changes = [];
  for (const { path, text } of manifests) {
    const manifest = JSON.parse(text);
    let changed = false;
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [name, pin] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith("@mdbase-dev/")) continue;
        if (/^(file:|workspace:|link:)/.test(pin)) continue;
        if (/^@mdbase-dev\/sdk-/.test(name)) continue;
        if (/^(npm:|git|https?:)/.test(pin)) {
          throw new Error(`Unsupported runtime pin: ${path}: ${name}`);
        }
        packages.add(name);
        if (pin !== version) {
          manifest[section][name] = version;
          changed = true;
        }
      }
    }
    if (changed) {
      changes.push({ path, text: JSON.stringify(manifest, null, 2) + "\n" });
    }
  }
  return { packages: [...packages].sort(), changes };
}

function execute(...args) {
  return execFileSync(args[0], args.slice(1), {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export async function qualifySdkArchive(archive, { root = process.cwd(), env = process.env } = {}) {
  const facts = JSON.parse(readFileSync(`${root}/vendor/native-release/production/artifact-facts.json`, "utf8"));
  const sha256 = createHash("sha256").update(archive.bytes).digest("hex");
  const requirements = "Need an owner-qualified production delivery packet for these exact unchanged registry bytes, matching bundled protocol original and UI, and independently supplied NATIVE_SDK_SHA256/NATIVE_UI_SHA256/NATIVE_PROTOCOL_SHA256/NATIVE_TRUST_ASSET_SHA256. Do not reuse beta.141 facts, synthesize a packet, or change a file: pin to npm.";
  if (sha256 !== facts.sha256 || archive.integrity !== facts.sri) {
    throw new Error(`Native SDK intake blocked: provenance-verified ${archive.name}@${archive.version} SHA256 ${sha256} does not match the qualified production original ${facts.sha256}. ${requirements}`);
  }
  const manifest = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  const pin = manifest.dependencies?.["@mdbase-dev/sdk"];
  if (pin !== `file:vendor/${facts.archive}` || !readFileSync(`${root}/${pin.slice(5)}`).equals(archive.bytes)) {
    throw new Error(`Native SDK intake blocked: registry archive has not been admitted as the exact file-pinned original. ${requirements}`);
  }
  try {
    await loadOriginals({ target: "production", repoRoot: root, hashes: protectedHashes(env), installed: true });
  } catch (error) {
    throw new Error(`Native SDK intake blocked: ${error.message}. ${requirements}`);
  }
}

export async function repin(verifyPackage = verifiedPackage, intake = qualifySdkArchive, fetchArchive = verifiedArchive) {
  const release = process.env.CONNECT_RELEASE ?? "";
  if (!/^v0\.1\.0-beta\.[1-9][0-9]*$/.test(release)) {
    throw new Error("connect_release must be v0.1.0-beta.N");
  }
  const record = JSON.parse(
    execute("gh", "api", "repos/mdbase-dev/mdbase-cloud-ops/contents/render/release.env?ref=main"),
  );
  const tag = execute(
    "git",
    "ls-remote",
    "https://github.com/mdbase-dev/mdbase-connect.git",
    `refs/tags/${release}^{}`,
  ).split(/\s/)[0];
  const commit = productionIdentity(
    Buffer.from(record.content, "base64").toString("utf8"),
    release,
    tag,
  );
  await intake(await fetchArchive("@mdbase-dev/sdk", release.slice(1), release, commit));
  const manifests = execute("git", "ls-files", "-z", "*package.json")
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
  const plan = repinPlan(manifests, release.slice(1));
  const verified = [];
  for (const name of plan.packages) {
    verified.push(await verifyPackage(name, release.slice(1), release, commit));
  }
  writeFileSync(process.env.REPIN_INTEGRITIES, JSON.stringify(verified));
  for (const change of plan.changes) writeFileSync(change.path, change.text);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `changed=${plan.changes.length > 0}\ncommit=${commit}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv[2] === "verify-lock") {
    verifyLockIntegrities(
      JSON.parse(readFileSync("package-lock.json", "utf8")),
      JSON.parse(readFileSync(process.env.REPIN_INTEGRITIES, "utf8")),
    );
  } else {
    await repin();
  }
}
