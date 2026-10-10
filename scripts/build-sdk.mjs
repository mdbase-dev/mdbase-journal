import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const hash = (bytes, algorithm, encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding);

// Copy the already-qualified classic browser asset. Do not rebuild/repack the SDK.
export async function buildSdk(output = new URL("public/sdk/", root)) {
  const pin = JSON.parse(await readFile(new URL("vendor/mdbase-next-sdk.json", root), "utf8"));
  const archive = await readFile(new URL(`vendor/${pin.artifact}`, root));
  if (hash(archive, "sha256") !== pin.sha256 || `sha512-${hash(archive, "sha512", "base64")}` !== pin.integrity) {
    throw new Error("Journal SDK archive does not match its qualified pin");
  }
  const entry = import.meta.resolve("@mdbase-dev/sdk");
  const browser = await readFile(new URL("./browser/mdbase-sdk.min.js", entry));
  if (hash(browser, "sha256") !== pin.browserSha256) {
    throw new Error("Installed SDK browser bytes do not match the qualified archive");
  }
  const asset = {
    sourceCommit: pin.sourceCommit,
    sha256: pin.browserSha256,
    integrity: `sha384-${hash(browser, "sha384", "base64")}`,
    // Relative to the generated module, usable beneath any static base path.
    url: "./mdbase-sdk.min.js",
  };
  await mkdir(output, { recursive: true });
  await writeFile(new URL("mdbase-sdk.min.js", output), browser);
  await writeFile(new URL("pin.mjs", output), `export const SDK_ASSET = Object.freeze(${JSON.stringify(asset, null, 2)});\n`);
  return asset;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildSdk();
}
