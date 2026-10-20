// Dependency-free reviewed source. No candidate SDK modules in the protected job.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadOriginals, protectedHashes } from './lib/native-originals.mjs';
import { assertInventory, inventoryDirectory } from './lib/native-publish-bytes.mjs';
import { assertCheckout, eventBinding } from './native-tag.mjs';
import { journalDeploymentFor } from './deployment-environment.mjs';
import { assertHostingSource } from './native-hosting.mjs';
import { assertArtifactMetadata, assertArtifactRun } from './lib/native-artifact.mjs';
const need=(ok,message)=>{if(!ok)throw Error(`Journal publisher refusal: ${message}`);};
export async function sourcePlan({env=process.env,cwd=process.cwd(),installed=false}={}) {
 const binding=await eventBinding(env),source=assertCheckout(binding,cwd);
 const sdkTrust=await loadOriginals({target:binding.target,repoRoot:cwd,hashes:protectedHashes(env),installed});
 const target=journalDeploymentFor({MDBASE_ENV:binding.target});
 need(target.origin===sdkTrust.appOrigin && target.connectOrigin===sdkTrust.release.cpOrigin,'target origin/CP mismatch');
 return {...source,origin:target.origin,pagesBranch:target.branch,pagesProject:target.project,sdkTrust};
}
export function assertBuiltManifest(manifest,plan) {
 need(manifest.manifest_version===1 && manifest.id==='dev.mdbase.journal-prototype' && manifest.homepage===plan.origin+'/' &&
   isDeepStrictEqual(manifest.redirect_uris,[plan.origin+'/auth/mdbase/callback']) &&
   isDeepStrictEqual(manifest.installation_origins?.[plan.target]?.['app-runtime'],[plan.origin]),'manifest exact app/target/callback binding');
}
export function assertCoverage(inventory,plan) {
 need(inventory.length>0,'empty inventory');
 const paths=new Map(inventory.map(a=>[a.path,a]));
 for(const p of ['index.html','404.html','.well-known/mdbase-app.json','journal.js','sdk/application/sdk.js','sdk/application/worker.js','sdk/application/packaged-trust.js','mdbase-shell-sw.js','mdbase-shell-runtime.js','mdbase-shell-register.js','_headers','_redirects'])need(paths.has(p),`missing ${p}`);
 for(const [name,pin] of Object.entries(plan.sdkTrust.nativeAssets)) {
  const item=paths.get('sdk/native/'+name);
  need(item?.sha256===pin.sha256 && item.bytes===pin.bytes,`exact native/SQLite path ${name}`);
 }
 need(paths.get('sdk/application/packaged-trust.js')?.sha256===plan.sdkTrust.trustModuleSha256,'original compiled trust module');
 need(inventory.every(a=>a.bytes<=25*1024*1024),'Pages 25 MiB file limit');
}
// Canonical artifact inventory bytes: UTF-8, two-space JSON, NO trailing LF.
// Shared by the build writer and protected CLI; plans keep their existing LF.
export function serializeInventory(inventory) { return JSON.stringify(inventory,null,2); }
export async function publicationInventory(directory,plan) {
 const inventory=await inventoryDirectory(directory,{maxFileBytes:25*1024*1024});
 assertBuiltManifest(JSON.parse(await readFile(join(directory,'.well-known/mdbase-app.json'),'utf8')),plan);
 assertCoverage(inventory,plan);
 await assertHostingSource(directory,inventory);
 return inventory;
}
export function deploymentPrefix(output) {
 const urls=[...new Set([...output.matchAll(/https:\/\/([a-f0-9]{8,32})\.mdbase-journal\.pages\.dev\b/g)].map(m=>m[1]))];
 need(urls.length===1,'no unambiguous deployment URL');return urls[0];
}
export async function assertExistingProject({accountId,apiToken,fetchImpl=fetch}) {
 need(/^[a-f0-9]{32}$/.test(accountId??'') && apiToken,'existing account credentials required');
 const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/mdbase-journal`,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${apiToken}`}});
 need(response.ok,'existing Pages project lookup failed');
 const body=await response.json();
 need(body.success && body.result?.id==='b44ca562-d51c-4768-b3df-3b9e47b478f7' && body.result.name==='mdbase-journal' && body.result.production_branch==='main','existing approved project identity/channel mismatch');
 return {id:body.result.id,name:body.result.name,productionBranch:body.result.production_branch};
}
export async function captureDeployment({output,target,sha,accountId,apiToken,fetchImpl=fetch}) {
 need(/^[a-f0-9]{32}$/.test(accountId??'') && apiToken,'existing account credentials required');
 const prefix=deploymentPrefix(output),url=`https://${prefix}.mdbase-journal.pages.dev`;
 const branch=journalDeploymentFor({MDBASE_ENV:target}).branch;
 const response=await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/mdbase-journal/deployments?per_page=100`,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${apiToken}`}});
 need(response.ok,'deployment UUID lookup failed');
 const body=await response.json();
 const matches=body.success && Array.isArray(body.result)?body.result.filter(d=>d.url===url && d.deployment_trigger?.metadata?.commit_hash===sha && d.deployment_trigger?.metadata?.branch===branch):[];
 need(matches.length===1 && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(matches[0]?.id??''),'actual deployment UUID/source/channel mismatch');
 return {id:matches[0].id,url,sourceSha:sha,pagesBranch:branch};
}
export function createReceipt({plan,inventory=[],deployment,verification,artifact,project,env=process.env}) {
 let artifactBound=false;
 try {
  const expected={id:env.ARTIFACT_ID,digest:'sha256:'+(env.ARTIFACT_DIGEST??'').replace(/^sha256:/,''),repository:env.GITHUB_REPOSITORY,repositoryId:env.GITHUB_REPOSITORY_ID,run:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,source:plan.sha,tree:plan.tree,target:plan.target};
  need(isDeepStrictEqual(artifact.expected,expected),'receipt artifact identity');
  assertArtifactMetadata(artifact.before,expected);assertArtifactMetadata(artifact.after,expected);
  assertArtifactRun(artifact.run,expected);assertArtifactRun(artifact.runAfter,expected);
  need(artifact.downloadedSha256===expected.digest.slice(7),'receipt actual ZIP digest');artifactBound=true;
 }catch{/* Failed/incomplete evidence is still retained below. */}
 const projectBound=project?.id==='b44ca562-d51c-4768-b3df-3b9e47b478f7' && project.name==='mdbase-journal' && project.productionBranch==='main';
 const verified=verification?.verified??[],controls=verification?.controls??[];
 const all=[...verified,...controls];
 const complete=verification?.ok===true && verification.failures?.length===0 && verification.unverified?.length===0 && all.length===inventory.length &&
   inventory.every(a=>all.filter(b=>a.path===b.path && a.sha256===b.sha256 && a.bytes===b.bytes).length===1);
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(deployment?.id??'') && deployment.sourceSha===plan.sha && deployment.pagesBranch===plan.pagesBranch;
 return {schema:'mdbase-journal/native-publisher-receipt@1',status:complete && uuid && inventory.length && artifactBound && projectBound?'verified':'failed-or-incomplete',
   source:plan,run:{repository:env.GITHUB_REPOSITORY,id:env.GITHUB_RUN_ID,attempt:env.GITHUB_RUN_ATTEMPT,event:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF},
   protectedHashes:Object.fromEntries(['NATIVE_SDK_SHA256','NATIVE_UI_SHA256','NATIVE_PROTOCOL_SHA256','NATIVE_TRUST_ASSET_SHA256'].map(k=>[k,env[k]??null])),
   project:project??null,artifact:artifact??{id:env.ARTIFACT_ID,digest:env.ARTIFACT_DIGEST},assets:inventory,deployment:deployment??null,verification:verification??{ok:false,reason:'not attempted/available'},
   authentication:'OFF-CI owner handoff only; CI original-byte binding, not fresh authentication',admission:'not assessed'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const [command,...args]=process.argv.slice(2);
 const json=async path=>JSON.parse(await readFile(path,'utf8'));
 try {
  if(command==='guard')console.log(JSON.stringify(await sourcePlan({installed:args.includes('--installed')}),null,2));
  else if(command==='inventory')process.stdout.write(serializeInventory(await publicationInventory(args[0],await json(args[1]))));
  else if(command==='assert-inventory')await assertInventory(args[0],await json(args[1]));
  else if(command==='project')console.log(JSON.stringify(await assertExistingProject({accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_API_TOKEN}),null,2));
  else if(command==='capture')console.log(JSON.stringify(await captureDeployment({output:await readFile(args[0],'utf8'),target:process.env.TARGET,sha:process.env.SOURCE_SHA,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_API_TOKEN}),null,2));
  else if(command==='receipt') {
   const optional=async path=>{try{return await json(path);}catch{return null;}};
   const dir=resolve(args[0]);
   const plan=await optional(join(dir,'plan.json'))??{sha:process.env.SOURCE_SHA,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),target:process.env.TARGET};
   const receipt=createReceipt({plan,inventory:await optional(join(dir,'inventory.json'))??[],deployment:await optional(join(dir,'deployment.json')),verification:await optional(join(dir,'verification.json')),artifact:await optional(join(dir,'artifact-metadata.json')),project:await optional(join(dir,'project.json'))});
   console.log(JSON.stringify(receipt,null,2));if(receipt.status!=='verified')process.exitCode=1;
  } else throw Error('Unknown native publisher command');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
