import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {build} from "esbuild";
import {JOURNAL_MANIFEST_ID,buildJournalManifest,writeJournalManifest} from "./build-manifest.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
const hash=(bytes,algorithm,encoding="hex")=>createHash(algorithm).update(bytes).digest(encoding);
export function applicationInputs(env){
  // The ID defaults to the manifest's own; sign-in self-registration supplies the registered one.
  const id=env.JOURNAL_REGISTERED_APPLICATION_ID??JOURNAL_MANIFEST_ID,environment=env.JOURNAL_ENVIRONMENT,origin=env.JOURNAL_ORIGIN;
  if(!id.trim()||!['lab','production'].includes(environment)||!origin)throw new Error("Journal native builds require JOURNAL_ENVIRONMENT and JOURNAL_ORIGIN; use build:local for writing only.");
  const url=new URL(origin);
  if(url.origin!==origin||url.username||url.password||url.pathname!=="/"||url.search||url.hash||
    (url.protocol!=="https:"&&!(environment==="lab"&&url.protocol==="http:"&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error("Journal requires an exact approved application origin.");
  return Object.freeze({registeredApplicationId:id,environment,origin});
}
export async function buildApplication({writingOnly=false,env=process.env,output=resolve(root,"public")}={}){
  const inputs=writingOnly?null:applicationInputs(env);
  // Native builds declare their own origin as the manifest homepage, as SDK registration requires.
  const manifest=inputs&&await buildJournalManifest({origin:inputs.origin,allowLocal:inputs.environment==="lab"});
  const pin=JSON.parse(await readFile(resolve(root,"vendor/mdbase-sdk-dev-0aeaada6.json"),"utf8"));
  const archive=resolve(root,"vendor",pin.artifact),bytes=await readFile(archive);
  assert.equal(bytes.length,pin.bytes);assert.equal(hash(bytes,"sha256"),pin.sha256);assert.equal(`sha512-${hash(bytes,"sha512","base64")}`,pin.integrity);
  const protocol=await readFile(resolve(root,pin.protocol.file));
  assert.equal(hash(protocol,"sha256"),pin.protocol.sha256);assert.equal(`sha512-${hash(protocol,"sha512","base64")}`,pin.protocol.sri);
  const installed=dirname(fileURLToPath(import.meta.resolve("@mdbase-dev/sdk")));
  const members=execFileSync("tar",["-tf",archive],{encoding:"utf8"}).split("\n").filter(name=>name.startsWith("package/dist/")&&!name.endsWith("/"));
  const nativeMembers=["runtime-lab.wasm","sqlite3.wasm","sqlite3.js"].map(name=>`package/dist/native/${name}`);
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
  const app=await build({absWorkingDir:root,entryPoints:["src/main.ts"],bundle:true,platform:"browser",format:"esm",target:"es2022",
    outfile:resolve(output,"journal.js"),metafile:true,define:{JOURNAL_APPLICATION_INPUTS:JSON.stringify(inputs),"process.env.NODE_ENV":JSON.stringify("production")},
    plugins:[{name:"public-sdk-entry",setup(builder){builder.onResolve({filter:/^@mdbase-dev\/sdk$/},()=>({path:"./sdk/application/sdk.js",external:true}));
      if(manifest)builder.onLoad({filter:/[\\/]public[\\/]\.well-known[\\/]mdbase-app\.json$/},()=>({contents:JSON.stringify(manifest),loader:"json"}));}}]});
  if(manifest)await writeJournalManifest(manifest,output);
  // The shared collection UI's stylesheet, served beside journal.css (which maps its tokens).
  await writeFile(resolve(output,"mdbase-collections.css"),await readFile(fileURLToPath(import.meta.resolve("@mdbase-dev/ui/collections.css"))));
  const imports=Object.values(app.metafile.outputs)[0].imports;
  assert(imports.length>0);
  assert.deepEqual([...new Set(imports.map(x=>x.path))],["./sdk/application/sdk.js"]);
  return {sourceCommit:pin.sourceCommit,writingOnly,inputs,sdk: sdk.metafile,application:app.metafile};
}
if(process.argv[1]===fileURLToPath(import.meta.url))await buildApplication({writingOnly:process.argv.includes("--writing-only")});
