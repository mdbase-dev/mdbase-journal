// LOCAL SOURCE qualification only: no GitHub event/ref emulation, publication
// envelope, credentials, live API/tool or deployment/admission authority.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_HASHES, loadStagingOriginals } from './staging-originals.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function checkOfflineManifest(worker,inventory) {
 const prefix='\n// mdbase shared offline shell\nimport {installOfflineShell} from "./mdbase-shell-runtime.js";\ninstallOfflineShell(self, ';
 assert(worker.startsWith(prefix) && worker.endsWith(');\n'),'Canonical SDK inline offline manifest framing');
 const manifest=JSON.parse(worker.slice(prefix.length,-3)); // DATA ONLY, no eval/import of Worker
 assert.equal(manifest.base,'/');
 const assets=inventory.filter(a=>a.path!=='mdbase-shell-sw.js' && !a.path.split('/').some(p=>p.startsWith('.')||p.startsWith('_')) && /\.(?:html|js|mjs|css|wasm|woff2?|ttf|svg|png|webp|jpg|jpeg|ico|json|webmanifest)$/.test(a.path)).map(({path,sha256})=>({path,sha256}));
 assert.deepEqual(manifest.assets,assets,'ALL eligible offline paths/digests, not a replacement for full final inventory');
 assert.equal(manifest.version,hash(JSON.stringify({base:'/',assets,existing:''})));
 return manifest;
}
export async function qualifyStaging(output,{root=process.cwd()}={}) {
 root=resolve(root);output=resolve(output);
 const rel=relative(root,output);assert(rel.startsWith('..') && rel!=='..','Local evidence/output must be outside source checkout');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'','Commit and freeze source before local qualification; no override');
 const [sha,tree]=git('rev-parse','HEAD','HEAD^{tree}').split('\n');
 // Independent facts/hash/source bindings + frozen NPM + ALL SDK/UI/protocol
 // installed members before any candidate SDK import/consumer build.
 const sdkTrust=await loadStagingOriginals({repoRoot:root,installed:true});
 await mkdir(output,{recursive:false});const home=join(output,'empty-home');await mkdir(home);
 const plan={kind:'local-staging-qualification-only',sha,tree,target:'staging',origin:sdkTrust.appOrigin,pagesBranch:'staging',pagesProject:'mdbase-journal',sdkTrust};
 await writeFile(join(output,'plan.json'),JSON.stringify(plan,null,2));
 try {
  // Reuse the SAME unprivileged target builder; no protected publisher, fake
  // tag/event, clean override or publishing-envelope guard bypass.
  execFileSync(process.execPath,[join(root,'scripts/native-build.mjs'),output],{cwd:root,env:{PATH:'/usr/bin:/bin',HOME:home,TMPDIR:home,...STAGING_HASHES},stdio:'inherit'});
  const inventory=JSON.parse(await readFile(join(output,'inventory.json')));
  const offline=checkOfflineManifest(await readFile(join(output,'publish/mdbase-shell-sw.js'),'utf8'),inventory);
  const manifest=JSON.parse(await readFile(join(output,'publish/.well-known/mdbase-app.json')));
  assert.equal(manifest.homepage,'https://staging.mdbase-journal.pages.dev/');
  assert.deepEqual(manifest.redirect_uris,['https://staging.mdbase-journal.pages.dev/auth/mdbase/callback']);
  assert.deepEqual(manifest.requirements.files,{required:['list','read','add','replace','move'],scope:{kind:'collection'}});
  assert.equal(manifest.requirements.access,'full_collection');
  assert.deepEqual(manifest.requirements.capabilities,{contract_version:2,required:['collection.read','records.create','records.edit']});
  for(const origin of [plan.origin,sdkTrust.release.cpOrigin,sdkTrust.release.logOrigin,...Object.values(manifest.installation_origins).flatMap(v=>v['app-runtime'])]) {
   const url=new URL(origin);assert.equal(url.protocol,'https:');assert(!['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  }
  const app=await readFile(join(output,'publish/journal.js'),'utf8');
  assert(app.includes('https://staging.mdbase-journal.pages.dev'));assert.match(app,/environment: "staging"/);
  assert(app.includes('./sdk/application/sdk.js') && app.includes('./sdk/application/app-grant.js'),'Public SDK and private-grant callback entry remain separate');
  assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'');assert.equal(git('rev-parse','HEAD'),sha);
  const receipt={kind:plan.kind,status:'local-build-and-static-checks-passed',source:sha,tree,target:'staging',inventorySha256:hash(await readFile(join(output,'inventory.json'))),files:inventory.length,offlineAssets:offline.assets.length,sdk:sdkTrust.archives.sdk,ui:sdkTrust.archives.ui,protocol:sdkTrust.archives.protocol,rawTrustAssetSha256:sdkTrust.release.assetSha256,compiledTrustModuleSha256:sdkTrust.trustModuleSha256,nativeAssets:sdkTrust.nativeAssets};
  await writeFile(join(output,'local-qualification.json'),JSON.stringify(receipt,null,2));return receipt;
 }catch(error){await writeFile(join(output,'local-qualification.json'),JSON.stringify({kind:plan.kind,status:'failed',source:sha,tree,reason:'local-stage-qualification-failed'},null,2));throw error;}
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try{assert(process.argv[2],'Explicit external output directory required');console.log(JSON.stringify(await qualifyStaging(process.argv[2]),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
