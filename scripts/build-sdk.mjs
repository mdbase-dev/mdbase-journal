import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const root=new URL("../",import.meta.url);
const hash=(bytes,algorithm,encoding="hex")=>createHash(algorithm).update(bytes).digest(encoding);
// Compatibility asset-intake checks retain the original classic-script loader.
// The Journal application itself consumes the public ESM entry, never this IIFE.
export async function buildSdk(output=new URL("public/sdk/",root)){
  const pin=JSON.parse(await readFile(new URL("vendor/mdbase-sdk-dev-41c26ca7.json",root),"utf8"));
  const archiveUrl=new URL(`vendor/${pin.artifact}`,root),archive=await readFile(archiveUrl);
  if(hash(archive,"sha256")!==pin.sha256||`sha512-${hash(archive,"sha512","base64")}`!==pin.integrity)throw new Error("Journal SDK archive does not match its dev-intake pin");
  const expected=execFileSync("tar",["-xOf",fileURLToPath(archiveUrl),"package/dist/browser/mdbase-sdk.min.js"],{maxBuffer:16*1024*1024});
  const browser=await readFile(new URL("./browser/mdbase-sdk.min.js",import.meta.resolve("@mdbase-dev/sdk")));
  if(!browser.equals(expected))throw new Error("Installed SDK browser bytes differ from the original dev archive");
  const asset={sourceCommit:pin.sourceCommit,sha256:hash(browser,"sha256"),integrity:`sha384-${hash(browser,"sha384","base64")}`,url:"./mdbase-sdk.min.js"};
  await mkdir(output,{recursive:true});
  await writeFile(new URL("mdbase-sdk.min.js",output),browser);
  await writeFile(new URL("pin.mjs",output),`export const SDK_ASSET = Object.freeze(${JSON.stringify(asset,null,2)});\n`);
  return asset;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await buildSdk();
