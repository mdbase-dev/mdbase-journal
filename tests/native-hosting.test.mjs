import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { headersPolicy, redirectsPolicy, verifyHosting } from '../scripts/native-hosting.mjs';
import { assertCoverage, assertBuiltManifest, captureDeployment, assertExistingProject, createReceipt, deploymentPrefix } from '../scripts/native-publisher.mjs';
const origin='https://staging.mdbase-journal.pages.dev',sha='a'.repeat(40),uuid='12345678-1234-1234-1234-123456789abc';
const hash=b=>createHash('sha256').update(b).digest('hex');
const deployment={id:uuid,sourceSha:sha,pagesBranch:'staging'};
function fixture() {
 const files={'index.html':'<p>Journal</p>','404.html':'<p>Missing</p>','journal.js':'app','sdk/application/sdk.js':'sdk','sdk/application/worker.js':'sdk worker','sdk/application/packaged-trust.js':'original trust module','sdk/native/runtime.wasm':'wasm','sdk/native/sqlite3.wasm':'sqlite','sdk/native/sqlite3.js':'sqlite js','mdbase-shell-sw.js':'static service worker','mdbase-shell-runtime.js':'runtime','mdbase-shell-register.js':'register','.well-known/mdbase-app.json':'{}','.dotfile':'dot','_static-asset':'underscore','_headers':headersPolicy,'_redirects':redirectsPolicy};
 const inventory=Object.entries(files).map(([path,body])=>({path,bytes:Buffer.byteLength(body),sha256:hash(body)}));
 const plan={sha,target:'staging',tree:'b'.repeat(40),origin,pagesBranch:'staging',sdkTrust:{nativeAssets:Object.fromEntries(['runtime.wasm','sqlite3.wasm','sqlite3.js'].map(name=>{const i=inventory.find(a=>a.path==='sdk/native/'+name);return [name,{bytes:i.bytes,sha256:i.sha256}];})),trustModuleSha256:hash(files['sdk/application/packaged-trust.js'])}};
 const calls=[];
 const transport=async(url,init)=>{
  calls.push(url);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');assert.equal(new URL(url).origin,origin);
  const path=new URL(url).pathname.slice(1);
  let body,status=200;
  if(path===''||path==='auth/mdbase/callback')body=files['index.html'];
  else if(path==='404')body=files['404.html'];
  else if(path==='404.html')return new Response(null,{status:301,headers:{location:origin+'/404'}});
  else if(path in files && !['_headers','_redirects'].includes(path))body=files[path];
  else{body=files['404.html'];status=404;}
  const type=path.endsWith('.wasm')?'application/wasm':path.endsWith('.js')?'application/javascript':path.endsWith('.json')?'application/json':'text/html';
  return new Response(body,{status,headers:{'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store','content-type':status===404?'text/html':type}});
 };
 return {files,inventory,plan,transport,calls};
}
function receiptFixture(plan) {
 const env={GITHUB_REPOSITORY:'fixture/journal',GITHUB_REPOSITORY_ID:'17',GITHUB_RUN_ID:'23',GITHUB_RUN_ATTEMPT:'2',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/tags/native-publish-staging-'+sha,ARTIFACT_ID:'42',ARTIFACT_DIGEST:'c'.repeat(64)};
 const expected={id:'42',digest:'sha256:'+env.ARTIFACT_DIGEST,repository:env.GITHUB_REPOSITORY,repositoryId:'17',run:'23',attempt:'2',event:'push',ref:env.GITHUB_REF,source:sha,tree:plan.tree,target:'staging'};
 const meta={id:42,digest:expected.digest,expired:false,name:'journal-native-build-staging-23-2',workflow_run:{id:23,head_sha:sha,head_repository_id:17}};
 const run={id:23,repository:{id:17,full_name:env.GITHUB_REPOSITORY},head_sha:sha,run_attempt:2,event:'push',head_branch:env.GITHUB_REF.slice(10),path:'.github/workflows/native-journal.yml'};
 return {env,project:{id:'b44ca562-d51c-4768-b3df-3b9e47b478f7',name:'mdbase-journal',productionBranch:'main'},artifact:{expected,before:meta,after:meta,run,runAfter:run,downloadedSha256:env.ARTIFACT_DIGEST}};
}
test('all static bytes incl dot/underscore/SW/native/SQLite/trust plus trusted live controls pass',async()=>{
 const f=fixture();assertCoverage(f.inventory,f.plan);
 const result=await verifyHosting({origin,inventory:f.inventory,deployment,fetchImpl:f.transport,attempts:1});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.unverified.length,0);assert.equal(result.controls.length,2);assert.equal(result.verified.length+result.controls.length,f.inventory.length);
 assert(result.probes.some(p=>p.path==='/auth/mdbase/callback' && p.sha256===hash(f.files['index.html'])));
 assert(result.verified.some(p=>p.path==='mdbase-shell-sw.js'));assert(result.verified.some(p=>p.path==='sdk/application/worker.js'));
 const bound=receiptFixture(f.plan);
 const input={plan:f.plan,inventory:f.inventory,deployment,verification:result,...bound};
 assert.equal(createReceipt(input).status,'verified');
 for(const patch of [{artifact:{...bound.artifact,downloadedSha256:'f'.repeat(64)}},{artifact:{...bound.artifact,after:{...bound.artifact.after,id:43}}},{env:{...bound.env,GITHUB_RUN_ATTEMPT:'3'}},{project:{...bound.project,id:'other'}},{deployment:{...deployment,id:'12345678'}}])assert.equal(createReceipt({...input,...patch}).status,'failed-or-incomplete');
});
for(const mode of ['header','mime','callback','unknown-route','control-exposure','asset-tamper','asset-redirect','http200-marker'])test('live '+mode+' never passes',async()=>{
 const f=fixture();
 const transport=async(url,init)=>{
  const response=await f.transport(url,init),path=new URL(url).pathname;
  if(mode==='header')response.headers.delete('x-content-type-options');
  if(mode==='mime' && path.endsWith('.wasm'))response.headers.set('content-type','text/html');
  if(mode==='callback' && path==='/auth/mdbase/callback')return new Response('wrong',{headers:response.headers});
  if(mode==='unknown-route' && path==='/__journal_native_policy_missing__')return new Response(f.files['index.html'],{headers:response.headers});
  if(mode==='control-exposure' && path==='/_headers')return new Response(headersPolicy,{headers:response.headers});
  if(['asset-tamper','http200-marker'].includes(mode) && path==='/journal.js')return new Response('bad',{headers:response.headers});
  if(mode==='asset-redirect' && path==='/journal.js')return new Response(null,{status:302,headers:{...Object.fromEntries(response.headers),location:'https://untrusted.fixture/login'}});
  return response;
 };
 const result=await verifyHosting({origin,inventory:f.inventory,deployment,fetchImpl:transport,attempts:1});
 assert.equal(result.ok,false);assert(result.failures.length>0);assert(result.unverified.length>0);
 assert.equal(createReceipt({plan:f.plan,inventory:f.inventory,deployment,verification:result,artifact:{after:{}}}).status,'failed-or-incomplete');
});
test('unreviewed control bytes, nested controls and executing Pages Worker refuse (static SW is not one)',async()=>{
 const f=fixture();
 for(const path of ['_routes.json','_worker.js','_worker.js/index.js','nested/_headers','functions/index.js']) {
  await assert.rejects(verifyHosting({origin,inventory:[...f.inventory,{path,bytes:2,sha256:hash('{}')}],deployment,fetchImpl:f.transport}),/Unreviewed/);
 }
 const wrong=f.inventory.map(a=>a.path==='_headers'?{...a,sha256:'f'.repeat(64)}:a);
 await assert.rejects(verifyHosting({origin,inventory:wrong,deployment,fetchImpl:f.transport}),/Unreviewed/);
});
test('missing actual UUID or untrusted origin refuse BEFORE any network checks',async()=>{
 const f=fixture();
 for(const dep of [null,{id:'url-prefix'}])await assert.rejects(verifyHosting({origin,inventory:f.inventory,deployment:dep,fetchImpl:f.transport}),/UUID/);
 await assert.rejects(verifyHosting({origin:'https://lab.fixture',inventory:f.inventory,deployment,fetchImpl:f.transport}),/Nonapproved/);assert.equal(f.calls.length,0);
});
test('whole hosting+byte publication is bounded even for a transport ignoring AbortSignal',async()=>{
 const f=fixture(),start=performance.now();
 const result=await verifyHosting({origin,inventory:f.inventory,deployment,fetchImpl:()=>new Promise(()=>{}),totalTimeoutMs:25,attempts:1});
 assert.equal(result.ok,false);assert(performance.now()-start<500);
});
test('full coverage binds exact native filenames, trust module and final offline shell',()=>{
 const f=fixture();assertCoverage(f.inventory,f.plan);
 for(const path of ['sdk/native/runtime.wasm','sdk/native/sqlite3.wasm','sdk/native/sqlite3.js','sdk/application/packaged-trust.js','mdbase-shell-sw.js','.well-known/mdbase-app.json'])assert.throws(()=>assertCoverage(f.inventory.filter(a=>a.path!==path),f.plan),/refusal/);
 const relocated=f.inventory.map(a=>a.path==='sdk/native/runtime.wasm'?{...a,path:'runtime.wasm'}:a);assert.throws(()=>assertCoverage(relocated,f.plan),/exact native/);
});
test('manifest retains exact app/grant target callback; no loopback or wrong environment',()=>{
 const f=fixture(),manifest={manifest_version:1,id:'dev.mdbase.journal-prototype',homepage:origin+'/',redirect_uris:[origin+'/auth/mdbase/callback'],installation_origins:{staging:{'app-runtime':[origin]}}};
 assertBuiltManifest(manifest,f.plan);
 for(const patch of [{homepage:'https://journal.mdbase.dev/'},{id:'other'},{redirect_uris:[origin+'/']},{installation_origins:{staging:{'app-runtime':['http://localhost:8765']}}}])assert.throws(()=>assertBuiltManifest({...manifest,...patch},f.plan),/refusal/);
});
test('existing Ops project ID is NOT an account ID; lookup checks exact UUID/name/main channel',async()=>{
 const valid={success:true,result:{id:'b44ca562-d51c-4768-b3df-3b9e47b478f7',name:'mdbase-journal',production_branch:'main'}};
 const options={accountId:'a'.repeat(32),apiToken:'UNIT mock, never sent',fetchImpl:async()=>Response.json(valid)};
 await assertExistingProject(options);
 for(const patch of [{id:'other'},{name:'mdbase-journal-lab'},{production_branch:'staging'}])await assert.rejects(assertExistingProject({...options,fetchImpl:async()=>Response.json({...valid,result:{...valid.result,...patch}})}),/project identity/);
 await assert.rejects(assertExistingProject({...options,accountId:valid.result.id}),/account credentials/);
});
test('capture resolves real UUID against uploaded URL/source/exact Pages channel, not URL prefix',async()=>{
 const output='https://12345678.mdbase-journal.pages.dev',valid={success:true,result:[{id:uuid,url:output,deployment_trigger:{metadata:{commit_hash:sha,branch:'staging'}}}]};
 const options={output,target:'staging',sha,accountId:'a'.repeat(32),apiToken:'UNIT mock',fetchImpl:async url=>{assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/pages/projects/mdbase-journal/deployments?per_page=20`);return Response.json(valid);}};
 assert.equal(deploymentPrefix(output),'12345678');assert.deepEqual(await captureDeployment(options),{id:uuid,url:output,sourceSha:sha,pagesBranch:'staging'});
 assert.throws(()=>deploymentPrefix(output+' https://87654321.mdbase-journal.pages.dev'),/unambiguous/);
 for(const patch of [{id:'12345678'},{url:'https://87654321.mdbase-journal.pages.dev'},{deployment_trigger:{metadata:{commit_hash:'b'.repeat(40),branch:'staging'}}},{deployment_trigger:{metadata:{commit_hash:sha,branch:'main'}}}])await assert.rejects(captureDeployment({...options,fetchImpl:async()=>Response.json({success:true,result:[{...valid.result[0],...patch}]})}),/actual deployment UUID/);
});
test('failed receipts retain source/tree/run/artifact/inventory/digests/UUID and never infer admission',()=>{
 const f=fixture();
 const receipt=createReceipt({plan:f.plan,inventory:f.inventory,deployment,verification:{ok:true,failures:[],unverified:[],verified:[]},artifact:{before:{id:42}},env:{GITHUB_RUN_ID:'23',GITHUB_RUN_ATTEMPT:'2',ARTIFACT_ID:'42'}});
 assert.equal(receipt.status,'failed-or-incomplete');assert.equal(receipt.source.tree,f.plan.tree);assert.equal(receipt.deployment.id,uuid);assert.equal(receipt.artifact.before.id,42);assert.equal(receipt.assets.length,f.inventory.length);assert.equal(receipt.admission,'not assessed');
});
test('actual SDK inline offline manifest is parsed as DATA, without invented sidecars or dropping full inventory',async()=>{
 const {checkOfflineManifest}=await import('../scripts/qualify-staging.mjs');
 const inventory=fixture().inventory.sort((a,b)=>a.path<b.path?-1:1);
 const assets=inventory.filter(a=>!a.path.split('/').some(p=>/^[._]/.test(p)) && a.path!=='mdbase-shell-sw.js').map(({path,sha256})=>({path,sha256}));
 const manifest={base:'/',version:hash(JSON.stringify({base:'/',assets,existing:''})),assets};
 const frame=json=>'\n// mdbase shared offline shell\nimport {installOfflineShell} from "./mdbase-shell-runtime.js";\ninstallOfflineShell(self, '+json+');\n';
 assert.deepEqual(checkOfflineManifest(frame(JSON.stringify(manifest)),inventory),manifest);
 for(const patch of [{assets:assets.slice(1)},{assets:[...assets,{path:'.well-known/mdbase-app.json',sha256:hash('{}')}]},{version:'f'.repeat(64)},{base:'http://localhost/'}])assert.throws(()=>checkOfflineManifest(frame(JSON.stringify({...manifest,...patch})),inventory));
 assert.throws(()=>checkOfflineManifest(frame('(()=>{globalThis.__journalOfflineExecuted=true;return {}})()'),inventory));assert.equal(globalThis.__journalOfflineExecuted,undefined);
 assert(inventory.length>assets.length);assertCoverage(inventory,fixture().plan);
});
