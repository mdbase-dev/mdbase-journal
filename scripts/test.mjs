import {readdir,mkdtemp,rm} from "node:fs/promises";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {build} from "esbuild";
const root=fileURLToPath(new URL("../",import.meta.url));
const directory=await mkdtemp(resolve(root,".test-build-"));
let result;
try{
  const sources=(await readdir(resolve(root,"tests"))).filter(name=>name.endsWith(".test.ts"));
  if(!sources.length)throw new Error("Journal typed test suite is missing");
  await build({absWorkingDir:root,entryPoints:sources.map(name=>`tests/${name}`),bundle:true,packages:"external",platform:"node",format:"esm",target:"es2022",outdir:directory,outExtension:{".js":".mjs"}});
  const legacy=(await readdir(resolve(root,"tests"))).filter(name=>name.endsWith(".test.mjs")).map(name=>resolve(root,"tests",name));
  result=spawnSync(process.execPath,["--test",...sources.map(name=>resolve(directory,name.replace(/\.ts$/,".mjs"))),...legacy],{cwd:root,stdio:"inherit"});
}finally{await rm(directory,{recursive:true,force:true});}
if(result.error)throw result.error;
process.exitCode=result.status??1;
