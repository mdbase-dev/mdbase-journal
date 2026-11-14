import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {productionPin} from "./publisher/originals.mjs";
const root=new URL("../",import.meta.url);
const hash=(bytes,algorithm,encoding="hex")=>createHash(algorithm).update(bytes).digest(encoding);
// Compatibility asset-intake checks retain the original classic-script loader.
// The Journal application itself consumes the public ESM entry, never this IIFE.
export async function buildSdk(output=new URL("public/sdk/",root)){
  const {pin,spec}=await productionPin(fileURLToPath(root));
  const archiveUrl=new URL(spec.slice(5),root);
  const expected=execFileSync("tar",["-xOf",fileURLToPath(archiveUrl),"package/dist/browser/mdbase-sdk.min.js"],{maxBuffer:16*1024*1024});
  const browser=await readFile(new URL("./browser/mdbase-sdk.min.js",import.meta.resolve("@mdbase-dev/sdk")));
  if(!browser.equals(expected))throw new Error("Installed SDK browser bytes differ from the original pinned archive");
  const asset={sourceCommit:pin.sourceCommit,sha256:hash(browser,"sha256"),integrity:`sha384-${hash(browser,"sha384","base64")}`,url:"./mdbase-sdk.min.js"};
  await mkdir(output,{recursive:true});
  await writeFile(new URL("mdbase-sdk.min.js",output),browser);
  await writeFile(new URL("pin.mjs",output),`export const SDK_ASSET = Object.freeze(${JSON.stringify(asset,null,2)});\n`);
  return asset;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await buildSdk();
