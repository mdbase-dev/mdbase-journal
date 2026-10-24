import {buildOfflineShell} from "@mdbase-dev/sdk/offline-shell/build";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile,readdir,writeFile,mkdir,access} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import {dirname,resolve} from "node:path";
import {build} from "esbuild";
import {JOURNAL_MANIFEST_ID,buildJournalManifest,writeJournalManifest} from "./build-manifest.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
const hash=(bytes,algorithm,encoding="hex")=>createHash(algorithm).update(bytes).digest(encoding);
export function applicationInputs(env){
  // The ID defaults to the manifest's own; sign-in self-registration supplies the registered one.
  const id=env.JOURNAL_REGISTERED_APPLICATION_ID??JOURNAL_MANIFEST_ID,environment=env.JOURNAL_ENVIRONMENT,origin=env.JOURNAL_ORIGIN;
  if(!id.trim()||!['lab','staging','production'].includes(environment)||!origin)throw new Error("Journal native builds require JOURNAL_ENVIRONMENT and JOURNAL_ORIGIN; use build:local for writing only.");
  const url=new URL(origin);
  if(url.origin!==origin||url.username||url.password||url.pathname!=="/"||url.search||url.hash||
    (url.protocol!=="https:"&&!(environment==="lab"&&url.protocol==="http:"&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error("Journal requires an exact approved application origin.");
  return Object.freeze({registeredApplicationId:id,environment,origin});
}
/** Native asset filenames the packaged SDK itself loads, read from its own
 * packaged-assets declaration instead of an app-side filename assumption.
 * The pinned 0ecbef41 packet loads native/runtime-lab.wasm; the canonical
 * per-environment packets (mdbase-next PR #941) load native/runtime.wasm.
 * Deriving the names here means a repin needs no app-side rename, and the
 * app never substitutes or copies bytes under a name the SDK won't load. */
export function nativeAssetNames(packagedAssetsSource){
  const names=new Set([...packagedAssetsSource.matchAll(/new URL\("\.\.\/native\/([^"]+)",\s*import\.meta\.url\)/g)].map(match=>match[1]));
  if(!names.size||![...names].some(name=>name.endsWith(".wasm")))throw new Error("Installed SDK packaged-assets declaration names no native assets.");
  return names;
}
/** Every same-origin stylesheet that a page or stylesheet in the output links
 * or imports must itself be in the output; otherwise the served app 404s it. */
export async function assertStylesheetsShipped(output){
  const missing=[];
  for(const file of (await readdir(output,{recursive:true})).filter(name=>/\.(html|css)$/.test(name))){
    const text=await readFile(resolve(output,file),"utf8");
    const references=file.endsWith(".html")
      ?[...text.matchAll(/<link\b[^>]*>/gi)].filter(([tag])=>/\brel=["']?stylesheet["'\s>]/i.test(tag)).map(([tag])=>tag.match(/\bhref=["']?([^"'\s>]+)/i)?.[1])
      :[...text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/g)].map(match=>match[1]);
    for(const reference of references){
      if(!reference){missing.push(`${file}: stylesheet link without href`);continue;}
      if(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference))continue; // another origin
      const path=decodeURIComponent(reference.split(/[?#]/)[0]);
      await access(path.startsWith("/")?resolve(output,"."+path):resolve(output,dirname(file),path)).catch(()=>missing.push(`${file}: ${reference}`));
    }
  }
  if(missing.length)throw new Error(`Build output lacks referenced stylesheets: ${missing.join(", ")}`);
}
export async function buildApplication({writingOnly=false,env=process.env,output=resolve(root,"public"),originals}={}){
  const inputs=writingOnly?null:applicationInputs(env);
  // Native builds declare their own origin as the manifest homepage, as SDK registration requires.
  const manifest=inputs&&await buildJournalManifest({origin:inputs.origin,allowLocal:inputs.environment==="lab",environment:inputs.environment});
  // Protected publisher calls this only AFTER full frozen original/installed intake.
  // Ordinary local/LAB builds retain the exact existing pin and behavior.
  if(originals && (!inputs || inputs.environment!==originals.environment || !['staging','production'].includes(inputs.environment)))throw new Error("Native originals target mismatch");
  const pin=originals ? {artifact:originals.archives.sdk.path.slice('vendor/'.length),bytes:originals.archives.sdk.bytes,
    sha256:originals.archives.sdk.sha256,integrity:originals.archives.sdk.sri,sourceCommit:originals.sdkSource,
    protocol:{file:originals.archives.protocol.path,sha256:originals.archives.protocol.sha256,sri:originals.archives.protocol.sri}}
    : JSON.parse(await readFile(resolve(root,"vendor/mdbase-sdk-dev-0ecbef41.json"),"utf8"));
  const archive=resolve(root,"vendor",pin.artifact),bytes=await readFile(archive);
  assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes,"sha256"),pin.sha256);assert.equal(`sha512-${hash(bytes,"sha512","base64")}`,pin.integrity);
  const protocol=await readFile(resolve(root,pin.protocol.file));
  assert.equal(hash(protocol,"sha256"),pin.protocol.sha256);assert.equal(`sha512-${hash(protocol,"sha512","base64")}`,pin.protocol.sri);
  const installed=dirname(fileURLToPath(import.meta.resolve("@mdbase-dev/sdk")));
  // CP/log origins come only from the pinned packet's authenticated release
  // trust, which is minted for one exact environment. A packet qualified
  // for another environment can never be retargeted by build inputs: refuse
  // here, before any bytes are copied, until the per-environment repin.
  if(inputs){
    const {appReleaseTrust}=await import(pathToFileURL(resolve(installed,"application/packaged-trust.js")).href);
    if(originals)for(const [key,value] of Object.entries(originals.release))assert.deepEqual(appReleaseTrust()[key],value,`Compiled release trust ${key} differs from frozen originals`);
    const trustEnvironment=appReleaseTrust().environment;
    if(trustEnvironment!==inputs.environment)throw new Error(`Journal ${inputs.environment} native build refused: the pinned SDK packet carries ${JSON.stringify(trustEnvironment)} release trust, not ${inputs.environment} trust. Repin the ${inputs.environment} SDK packet first.`);
  }
  const members=execFileSync("tar",["-tf",archive],{encoding:"utf8"}).split("\n").filter(name=>name.startsWith("package/dist/")&&!name.endsWith("/"));
  const nativeMembers=[...nativeAssetNames(await readFile(resolve(installed,"application/packaged-assets.js"),"utf8"))].map(name=>`package/dist/native/${name}`);
  if(!writingOnly&&nativeMembers.some(name=>!members.includes(name)))throw new Error("This SDK dev packet lacks packaged native assets. Use build:local; native builds need an original SDK packet containing its canonical trust and assets, not app-side substitutes.");
  for(const name of members){
    const relative=name.slice("package/dist/".length);
    if(relative.split("/").some(part=>part===".."))throw new Error("Invalid SDK archive member");
    const expected=execFileSync("tar",["-xOf",archive,name],{maxBuffer:16*1024*1024});
    const current=await readFile(resolve(installed,relative));assert.deepEqual(current,expected,`Installed SDK drift: ${relative}`);
    const target=resolve(output,"sdk",relative);await mkdir(dirname(target),{recursive:true});await writeFile(target,current);
  }
  // Consumer bundle from already-built PUBLIC SDK exports. The module anchor is
  // application/, beside the original Worker; ../native remains same-artifact.
  const sdk=await build({entryPoints:[resolve(installed,"index.js")],bundle:true,platform:"browser",format:"esm",target:"es2022",
    outfile:resolve(output,"sdk/application/sdk.js"),metafile:true});
  for(const value of Object.values(sdk.metafile.outputs))assert.deepEqual(value.imports,[]);
  // The consent window's return (Private collections) loads only this, only there.
  const grant=await build({stdin:{contents:'export {deliverAppGrantCallback} from "@mdbase-dev/sdk/app-grant";',resolveDir:root,loader:"js"},bundle:true,platform:"browser",format:"esm",target:"es2022",
    outfile:resolve(output,"sdk/application/app-grant.js"),metafile:true});
  for(const value of Object.values(grant.metafile.outputs))assert.deepEqual(value.imports,[]);
  const app=await build({absWorkingDir:root,entryPoints:["src/main.ts"],bundle:true,platform:"browser",format:"esm",target:"es2022",
    outfile:resolve(output,"journal.js"),metafile:true,define:{JOURNAL_APPLICATION_INPUTS:JSON.stringify(inputs),"process.env.NODE_ENV":JSON.stringify("production")},
    plugins:[{name:"public-sdk-entry",setup(builder){builder.onResolve({filter:/^@mdbase-dev\/sdk$/},()=>({path:"./sdk/application/sdk.js",external:true}));
      builder.onResolve({filter:/^@mdbase-dev\/sdk\/app-grant$/},()=>({path:"./sdk/application/app-grant.js",external:true}));
      if(manifest)builder.onLoad({filter:/[\\/]public[\\/]\.well-known[\\/]mdbase-app\.json$/},()=>({contents:JSON.stringify(manifest),loader:"json"}));}}]});
  if(manifest)await writeJournalManifest(manifest,output);
  // The shared collection UI's stylesheet, served beside journal.css (which maps its tokens).
  // Bundled, because it @imports sibling stylesheets the output does not otherwise contain.
  await build({entryPoints:[fileURLToPath(import.meta.resolve("@mdbase-dev/ui/collections.css"))],bundle:true,
    outfile:resolve(output,"mdbase-collections.css"),logLevel:"warning"});
  await assertStylesheetsShipped(output);
  const imports=Object.values(app.metafile.outputs)[0].imports;
  assert(imports.length>0);
  assert.deepEqual([...new Set(imports.filter(x=>x.kind!=="dynamic-import").map(x=>x.path))],["./sdk/application/sdk.js"]);
  assert.deepEqual(imports.filter(x=>x.kind==="dynamic-import").map(x=>x.path),["./sdk/application/app-grant.js"]);
  return {sourceCommit:pin.sourceCommit,writingOnly,inputs,sdk: sdk.metafile,application:app.metafile};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  await buildApplication({writingOnly:process.argv.includes("--writing-only")});
  await buildOfflineShell({directory:resolve(root,"public")});
}
