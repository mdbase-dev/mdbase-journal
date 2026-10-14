import {spawn,execFileSync} from "node:child_process";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {journalLabDeploymentFor} from "./deployment-environment.mjs";
const root=resolve(import.meta.dirname,".."),target=journalLabDeploymentFor(process.env);
const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
if(git("status","--porcelain","--untracked-files=all"))throw new Error("Journal LAB deploy requires a clean committed worktree.");
const commit=git("rev-parse","HEAD");
const paths=git("ls-files","public").split("\n").filter(Boolean);
const original=await Promise.all(paths.map(path=>readFile(resolve(root,path))));
const env={...process.env,JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:target.origin};
try {
  await run("npm",["run","build"],env);
  const manifest=JSON.parse(await readFile(resolve(root,"public/.well-known/mdbase-app.json"),"utf8"));
  if(manifest.homepage!==target.origin+"/" || manifest.redirect_uris?.[0]!==target.origin+"/auth/mdbase/callback")throw new Error("Journal LAB manifest origin mismatch.");
  const sdk=await readFile(resolve(root,"public/sdk/application/sdk.js"),"utf8");
  if(!sdk.includes(target.connectOrigin))throw new Error("Journal LAB SDK does not include its approved Connect origin.");
  await run("npx",["--yes","wrangler@4.120.0","pages","deploy","public","--project-name",target.project,"--branch",target.branch,"--commit-hash",commit,"--commit-dirty=true"],env);
  const get=async path=>{const r=await fetch(target.origin+path,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`Journal LAB smoke HTTP ${r.status}`);return r.text();};
  const remote=JSON.parse(await get("/.well-known/mdbase-app.json"));
  if(JSON.stringify(remote)!==JSON.stringify(manifest))throw new Error("Journal LAB remote manifest differs from this build.");
  await get("/");
  const local=await readFile(resolve(root,"public/journal.js"),"utf8");
  if(await get("/journal.js")!==local)throw new Error("Journal LAB remote main bundle differs from this build.");
  if(await get("/sdk/application/sdk.js")!==sdk)throw new Error("Journal LAB remote SDK differs from this build.");
  console.log(`Journal LAB smoke 4/4 passed: ${target.origin}`);
} finally {
  await Promise.all(paths.map((path,i)=>writeFile(resolve(root,path),original[i])));
}
function run(command,args,env){return new Promise((yes,no)=>{const child=spawn(command,args,{cwd:root,env,stdio:"inherit"});child.once("error",no);child.once("exit",code=>code===0?yes():no(new Error(`Journal LAB ${command} failed with status ${code}`)));});}
