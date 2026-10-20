import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertArtifactMetadata, assertArtifactDirectory, assertArtifactRun, download } from '../scripts/lib/native-artifact.mjs';
import { inventoryDirectory } from '../scripts/lib/native-publish-bytes.mjs';
const source='a'.repeat(40),tree='b'.repeat(40),digest='sha256:'+'c'.repeat(64);
const expected={id:'42',digest,repository:'fixture/journal',repositoryId:'17',run:'23',attempt:'2',event:'push',ref:'refs/tags/native-publish-staging-'+source,source,tree,target:'staging'};
const meta={id:42,digest,expired:false,name:'journal-native-build-staging-23-2',workflow_run:{id:23,head_sha:source,head_repository_id:17}};
const run={id:23,repository:{id:17,full_name:expected.repository},head_sha:source,run_attempt:2,event:'push',head_branch:expected.ref.slice(10),path:'.github/workflows/native-journal.yml'};
const hash=b=>createHash('sha256').update(b).digest('hex');
test('artifact immutable ID/digest/repo/run/attempt/source and exact run tag/workflow required',()=>{
 assert.doesNotThrow(()=>assertArtifactMetadata(meta,expected));assert.doesNotThrow(()=>assertArtifactRun(run,expected));
 for(const patch of [{id:43},{digest:'sha256:'+'d'.repeat(64)},{expired:true},{name:'journal-native-build-staging-23-1'},{workflow_run:{...meta.workflow_run,id:24}},{workflow_run:{...meta.workflow_run,head_sha:'d'.repeat(40)}},{workflow_run:{...meta.workflow_run,head_repository_id:18}}])assert.throws(()=>assertArtifactMetadata({...meta,...patch},expected),/refusal/);
 for(const patch of [{run_attempt:1},{event:'workflow_dispatch'},{head_branch:'release/native-staging'},{head_sha:'d'.repeat(40)},{path:'.github/workflows/other.yml'},{repository:{id:18,full_name:expected.repository}}])assert.throws(()=>assertArtifactRun({...run,...patch},expected),/refusal/);
});
async function files() {
 const contents='journal';
 const inventory=[{path:'index.html',bytes:contents.length,sha256:hash(contents)}];
 const plan={sha:source,tree,sdkTrust:{environment:'staging'}};
 const inventoryBytes=JSON.stringify(inventory),planBytes=JSON.stringify(plan);
 const envelope={...expected,inventorySha256:hash(inventoryBytes),planSha256:hash(planBytes)};
 return {'publish/index.html':contents,'inventory.json':inventoryBytes,'plan.json':planBytes,'envelope.json':JSON.stringify(envelope)};
}
test('full artifact source/tree/target/event/ref inventory refuses missing/extra/tampered bytes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'journal-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [path,body] of Object.entries(await files())){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),body);}
 await assertArtifactDirectory(root,expected);
 for(const key of ['repository','run','attempt','event','ref','source','tree','target'])await assert.rejects(assertArtifactDirectory(root,{...expected,[key]:'wrong'}),/envelope/);
 await writeFile(join(root,'publish/index.html'),'tamper');await assert.rejects(assertArtifactDirectory(root,expected),/inventory-mismatch/);
 await rm(join(root,'publish/index.html'));await assert.rejects(assertArtifactDirectory(root,expected),/inventory-mismatch/);
 await writeFile(join(root,'publish/index.html'),'journal');await writeFile(join(root,'publish/.extra'),'extra');await assert.rejects(assertArtifactDirectory(root,expected),/inventory-mismatch/);
 await rm(join(root,'publish/.extra'));await writeFile(join(root,'project-script.mjs'),'untrusted');await assert.rejects(assertArtifactDirectory(root,expected),/unexpected artifact paths/);
 await rm(join(root,'project-script.mjs'));await writeFile(join(root,'inventory.json'),'[]');await assert.rejects(assertArtifactDirectory(root,expected),/inventory\/plan binding/);
});
// Tiny synthetic ZIP unit fixtures ONLY, not SDK originals/producer archives.
function zip(entries) {
 return execFileSync('python3',['-B','-c',`import io,json,stat,sys,zipfile,warnings
warnings.simplefilter('ignore')
b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 for item in json.loads(sys.argv[1]):
  i=zipfile.ZipInfo(item[0]); i.external_attr=item[2]<<16
  z.writestr(i,item[1])
sys.stdout.buffer.write(b.getvalue())`,JSON.stringify(entries)]);
}
function transport(bytes,{after=meta,runAfter=run,actualMeta=meta,initialRun=run}={}) {
 let metas=0,runs=0;
 return async(url,init)=>{
  url=String(url);
  if(url==='https://blob.fixture/archive.zip'){assert(!init.headers);assert.equal(init.credentials,'omit');return new Response(bytes,{headers:{'content-length':String(bytes.length)}});}
  if(url.endsWith('/zip'))return new Response(null,{status:302,headers:{location:'https://blob.fixture/archive.zip'}});
  if(url.includes('/actions/runs/'))return Response.json(++runs===1?initialRun:runAfter);
  return Response.json(++metas===1?actualMeta:after);
 };
}
// R7: observe the existing transport rather than cloning its API implementation.
// The body is always a tiny UNIT ZIP, never an SDK/product archive.
for(const badDigest of [false,true])test('complete ZIP actual SHA AND actual byte length persist before next lookup '+(badDigest?'even on bad digest':'on success'),async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-zip-identity-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest=badDigest?expected.digest:'sha256:'+hash(bytes),m={...meta,digest,size_in_bytes:999999};
 const mock=transport(bytes,{actualMeta:m,after:m});let metas=0,runs=0,snapshot;
 const observed=async(url,init)=>{
  const u=String(url);
  if(u.includes('/actions/artifacts/') && !u.endsWith('/zip') && ++metas===2)snapshot=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
  if(u.includes('/actions/runs/'))runs++;
  const response=await mock(url,init);if(u==='https://blob.fixture/archive.zip')response.headers.set('content-length','1');return response;
 };
 if(badDigest)await assert.rejects(download({...expected,digest},join(parent,'artifact'),observed),/download digest/);
 else await download({...expected,digest},join(parent,'artifact'),observed);
 const evidence=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
 assert.equal(evidence.downloadedBytes,bytes.length,'actual complete stream length, never metadata/header size');assert.equal(evidence.downloadedSha256,hash(bytes));
 assert.equal(metas,2);assert.equal(runs,2);assert.equal(snapshot.downloadedBytes,bytes.length);assert.equal(snapshot.downloadedSha256,hash(bytes));
 assert.equal(evidence.after.id,42);assert.equal(evidence.runAfter.run_attempt,2);
 if(badDigest){assert.equal(evidence.failure.stage,'zip-digest-validation');await assert.rejects(readFile(join(parent,'journal-native.zip')),{code:'ENOENT'});}
 else assert(!Object.hasOwn(evidence,'failure'));
});
for(const localFailure of ['digest','extraction'])test('primary '+localFailure+' refusal still captures BOTH post-download attempts and safe secondary failures',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-post-refusal-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const entries=localFailure==='extraction'?[['../escape','UNIT-private-body',0o100644]]:Object.entries(await files()).map(([p,b])=>[p,b,0o100644]);
 const bytes=zip(entries),digest=localFailure==='digest'?expected.digest:'sha256:'+hash(bytes),m={...meta,digest};
 const mock=transport(bytes,{actualMeta:m,after:{...m,id:43},runAfter:{...run,run_attempt:3}});let metas=0,runs=0;
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),async(url,init)=>{
  const u=String(url);
  if(u.includes('/actions/artifacts/') && !u.endsWith('/zip') && ++metas===2 && localFailure==='extraction')return Response.json({message:'Forbidden',token:'UNIT-private-token'},{status:403});
  if(u.includes('/actions/runs/') && ++runs===2 && localFailure==='digest')throw Error('UNIT-private-opaque https://blob.fixture/?sig=UNIT-private-SAS');
  return mock(url,init);
 }));
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),e=JSON.parse(text);
 assert.equal(e.failure.stage,localFailure==='digest'?'zip-digest-validation':'zip-extraction');assert.equal(e.failure.reason,localFailure==='digest'?'download digest':'operation-failed');
 assert.deepEqual(e.secondaryFailures,localFailure==='digest'?[{stage:'after-metadata-validation',reason:'immutable ID/digest'},{stage:'after-run-fetch',reason:'operation-failed'}]:[{stage:'after-metadata-fetch',reason:'GitHub metadata unavailable'},{stage:'after-run-validation',reason:'run attempt/event/ref/workflow/repository'}]);
 assert.equal(metas,2);assert.equal(runs,2);assert.equal(e.downloadedSha256,hash(bytes));assert.equal(e.downloadedBytes,bytes.length);
 if(localFailure==='digest'){assert.equal(e.after.id,43);assert(!Object.hasOwn(e,'runAfter'));}
 else {assert.equal(e.afterResponse.status,403);assert.equal(e.runAfter.run_attempt,3);assert.deepEqual(await inventoryDirectory(join(parent,'artifact')),[]);}
 assert(!text.includes('UNIT-private'));assert(!text.includes('sig='));
});
for(const afterFailure of ['identity','http'])test('AFTER '+afterFailure+' refusal still independently fetches and retains runAfter exactly ONCE',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-independent-post-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 const mock=transport(bytes,{actualMeta:m,after:{...m,id:43}});let metas=0,runs=0,snapshot;
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),async(url,init)=>{
  const u=String(url);
  if(u.includes('/actions/artifacts/') && !u.endsWith('/zip') && ++metas===2 && afterFailure==='http')return Response.json({message:'Forbidden'},{status:403});
  if(u.includes('/actions/runs/') && ++runs===2)snapshot=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
  return mock(url,init);
 }));
 const e=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
 assert.equal(metas,2);assert.equal(runs,2);assert.equal(e.runAfter.run_attempt,2);assert.equal(e.runAfterResponse.status,200);
 assert.equal(e.failure.stage,afterFailure==='identity'?'after-metadata-validation':'after-metadata-fetch');assert.deepEqual(snapshot.failure,e.failure);
 assert.equal(snapshot.afterResponse.status,afterFailure==='identity'?200:403);assert.equal(e.downloadedBytes,bytes.length);
 assert(!Object.hasOwn(e,'secondaryFailures'));
});
test('first AFTER failure remains primary when independent runAfter also refuses identity',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-both-post-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),transport(bytes,{actualMeta:m,after:{...m,id:43},runAfter:{...run,run_attempt:3}})),/immutable ID\/digest/);
 const e=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
 assert.equal(e.failure.stage,'after-metadata-validation');assert.equal(e.after.id,43);assert.equal(e.runAfter.run_attempt,3);
 assert.deepEqual(e.secondaryFailures,[{stage:'after-run-validation',reason:'run attempt/event/ref/workflow/repository'}]);
});
test('ZIP exclusive-write failure keeps its primary reason and still retains BOTH post observations',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-zip-write-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 await writeFile(join(parent,'journal-native.zip'),'existing DATA, never overwrite');
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),transport(bytes,{actualMeta:m,after:m})),/zip-write: operation-failed/);
 const e=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));assert.equal(e.after.id,42);assert.equal(e.runAfter.run_attempt,2);assert.equal(e.downloadedBytes,bytes.length);
 assert.equal(await readFile(join(parent,'journal-native.zip'),'utf8'),'existing DATA, never overwrite');
});
test('incomplete ZIP stream never invents full SHA/length or post-download observations',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-partial-zip-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const mock=transport(Buffer.alloc(0));let metas=0,runs=0,pulls=0;
 await assert.rejects(download(expected,join(parent,'artifact'),async(url,init)=>{
  const u=String(url);if(u.includes('/actions/artifacts/') && !u.endsWith('/zip'))metas++;if(u.includes('/actions/runs/'))runs++;
  if(u==='https://blob.fixture/archive.zip')return new Response(new ReadableStream({pull(c){if(++pulls===1)c.enqueue(Buffer.from('UNIT-private-prefix'));else c.error(Error('UNIT-private-stream'));}}),{headers:{'content-length':'100'}});
  return mock(url,init);
 }));
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),e=JSON.parse(text);
 for(const key of ['downloadedSha256','downloadedBytes','after','runAfter','afterResponse','runAfterResponse'])assert(!Object.hasOwn(e,key));
 assert.equal(metas,1);assert.equal(runs,1);assert.equal(e.failure.stage,'zip-read');assert(!text.includes('UNIT-private'));
});
test('actual ZIP digest checked before extraction, metadata/run rebound after, safe download succeeds',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-download-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([path,body])=>[path,body,0o100644]));
 const digest='sha256:'+hash(bytes),e={...expected,digest},m={...meta,digest};
 await download(e,join(parent,'artifact'),transport(bytes,{actualMeta:m,after:m}));
 const evidence=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));assert.equal(evidence.downloadedSha256,hash(bytes));assert.equal(evidence.after.id,42);
 await assertArtifactDirectory(join(parent,'artifact'),e);
});
for(const [label,body,expectedTruncated] of [
 ['oversized',()=>new Response('x'.repeat(256*1024+1),{status:302,headers:{location:'https://blob.fixture/archive.zip'}}),true],
 ['reader-failed',()=>new Response(new ReadableStream({pull(controller){controller.error(Error('UNIT-private-redirect-reader'));}}),{status:302,headers:{location:'https://blob.fixture/archive.zip'}}),false]
])test('incomplete '+label+' ZIP redirect body refuses before any blob request',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-redirect-incomplete-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 const mock=transport(bytes,{actualMeta:m,after:m});let blobCalls=0;
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),async(url,init)=>{
  if(String(url).endsWith('/zip'))return body();
  if(String(url)==='https://blob.fixture/archive.zip')blobCalls++;
  return mock(url,init);
 }),/bounded archive redirect body/);
 assert.equal(blobCalls,0);
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);
 assert.equal(evidence.zipResponse.status,302);assert.equal(evidence.zipResponse.bodyComplete,false);assert.equal(evidence.zipResponse.bodyTruncated,expectedTruncated);
 assert.equal(evidence.failure.stage,'zip-redirect-validation');assert.equal(evidence.failure.reason,'bounded archive redirect body');
 assert(!Object.hasOwn(evidence,'blobResponse'));assert(!Object.hasOwn(evidence,'downloadedSha256'));assert(!Object.hasOwn(evidence,'downloadedBytes'));assert(!text.includes('UNIT-private'));
 await assert.rejects(readFile(join(parent,'journal-native.zip')),{code:'ENOENT'});
});
test('complete non-JSON ZIP redirect body permits the same verified download',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-redirect-complete-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 const mock=transport(bytes,{actualMeta:m,after:m});
 await download({...expected,digest},join(parent,'artifact'),async(url,init)=>String(url).endsWith('/zip')?new Response('Redirecting',{status:302,headers:{location:'https://blob.fixture/archive.zip'}}):mock(url,init));
 const evidence=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
 assert.equal(evidence.zipResponse.bodyComplete,true);assert.equal(evidence.zipResponse.bodyTruncated,false);assert.equal(evidence.zipResponse.bodySha256,hash('Redirecting'));
 assert.equal(evidence.downloadedSha256,hash(bytes));assert(!Object.hasOwn(evidence,'failure'));
});
for(const [label,entries] of Object.entries({traversal:[['../escape','x',0o100644]],link:[['link','target',0o120777]],device:[['device','x',0o020666]],duplicate:[['a','x',0o100644],['a','y',0o100644]],casefold:[['A','x',0o100644],['a','y',0o100644]],parentFile:[['a','x',0o100644],['a/b','y',0o100644]],absolute:[['/a','x',0o100644]],backslash:[['a\\b','x',0o100644]]}))test('safe ZIP refuses '+label+' before extraction',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-unsafe-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(entries),digest='sha256:'+hash(bytes),m={...meta,digest};
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),transport(bytes,{actualMeta:m,after:m})));
 assert.deepEqual(await inventoryDirectory(join(parent,'artifact')),[]);
});
test('bad ZIP digest and changed immutable metadata/run block',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-rebind-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 await assert.rejects(download(expected,join(parent,'bad-digest/artifact'),transport(bytes)),/download digest/);
 const evidence=JSON.parse(await readFile(join(parent,'bad-digest/artifact-metadata.json')));assert.equal(evidence.downloadedSha256,hash(bytes));
 await assert.rejects(download({...expected,digest},join(parent,'moved/artifact'),transport(bytes,{actualMeta:m,after:{...m,digest:expected.digest}})),/immutable ID\/digest/);
 await assert.rejects(download({...expected,digest},join(parent,'attempt/artifact'),transport(bytes,{actualMeta:m,after:m,runAfter:{...run,run_attempt:3}})),/run attempt/);
 const failedAfter=JSON.parse(await readFile(join(parent,'attempt/artifact-metadata.json')));
 assert.equal(failedAfter.failure.stage,'after-run-validation');assert.match(failedAfter.failure.reason,/run attempt/);
 assert.equal(failedAfter.runAfter.run_attempt,3);assert.equal(failedAfter.after.id,42);assert.equal(failedAfter.downloadedSha256,hash(bytes));
});
for(const [status,message] of [[403,'Forbidden'],[404,'Not Found'],[429,'API rate limit exceeded']])test('bounded public GitHub '+status+' body AND numeric status survive HTTP refusal before any next lookup',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-public-http-'));t.after(()=>rm(parent,{recursive:true,force:true}));let calls=0;
 const body={message,status:String(status),documentation_url:'https://docs.github.com/rest/actions/artifacts',token:'UNIT-private-token',headers:{Authorization:'UNIT-private-header'},url:'https://blob.fixture/?UNIT-private-SAS'};
 await assert.rejects(download(expected,join(parent,'artifact'),async()=>{calls++;return Response.json(body,{status});}),/GitHub metadata unavailable/);
 assert.equal(calls,1);
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);
 assert.equal(evidence.beforeResponse.status,status);assert.equal(evidence.beforeResponse.body.message,message);assert.equal(evidence.beforeResponse.body.status,String(status));
 assert.equal(evidence.beforeResponse.bodySha256,hash(JSON.stringify(body)));assert.equal(evidence.beforeResponse.bodyComplete,true);
 assert.equal(evidence.failure.stage,'before-metadata-fetch');assert(!Object.hasOwn(evidence,'run'));assert(!Object.hasOwn(evidence,'downloadedSha256'));assert(!text.includes('UNIT-private'));
});
test('oversized public HTTP body is bounded, retained as incomplete fingerprint and refused before next lookup',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-http-bound-'));t.after(()=>rm(parent,{recursive:true,force:true}));let calls=0;
 await assert.rejects(download(expected,join(parent,'artifact'),async()=>{calls++;return Response.json({message:'UNIT-private-'+ 'x'.repeat(300*1024)});}),/bounded GitHub metadata body/);
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);assert.equal(calls,1);assert.equal(evidence.beforeResponse.status,200);assert.equal(evidence.beforeResponse.bodyBytes,256*1024);assert.equal(evidence.beforeResponse.bodyTruncated,true);assert.equal(evidence.beforeResponse.bodyComplete,false);assert(!text.includes('UNIT-private'));assert(!Object.hasOwn(evidence,'run'));
});
test('HTTP status survives a body-reader exception; opaque exceptions are never retained',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-http-read-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const body=new ReadableStream({pull(controller){controller.error(Error('UNIT-private-reader'));}});
 await assert.rejects(download(expected,join(parent,'artifact'),async()=>new Response(body,{status:404})),/GitHub metadata unavailable/);
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);assert.equal(evidence.beforeResponse.status,404);assert.equal(evidence.beforeResponse.bodyComplete,false);assert(!text.includes('UNIT-private'));assert(!Object.hasOwn(evidence,'run'));
});
test('successful AFTER response evidence survives subsequent runAfter HTTP refusal, including public error body',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-after-http-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 const mock=transport(bytes,{actualMeta:m,after:m});let runs=0;
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),async(url,init)=>String(url).includes('/actions/runs/') && ++runs===2?Response.json({message:'Forbidden'},{status:403}):mock(url,init)),/GitHub metadata unavailable/);
 const evidence=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
 assert.equal(evidence.afterResponse.status,200);assert.equal(evidence.after.id,42);assert.equal(evidence.runAfterResponse.status,403);assert.equal(evidence.runAfterResponse.body.message,'Forbidden');assert.equal(evidence.downloadedSha256,hash(bytes));assert(!Object.hasOwn(evidence,'runAfter'));
});
test('wrong INITIAL attempt is saved before validation and no ZIP is requested',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-initial-attempt-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const mock=transport(Buffer.alloc(0),{initialRun:{...run,run_attempt:3}});let zipCalls=0;
 await assert.rejects(download(expected,join(parent,'artifact'),async(url,init)=>{if(String(url).endsWith('/zip'))zipCalls++;return mock(url,init);}),/run attempt/);
 assert.equal(zipCalls,0);
 const evidence=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
 assert.equal(evidence.run.run_attempt,3);assert.equal(evidence.before.id,42);
 assert.equal(evidence.failure.stage,'initial-run-validation');assert.match(evidence.failure.reason,/run attempt/);
 assert(!Object.hasOwn(evidence,'downloadedSha256'));assert(!Object.hasOwn(evidence,'after'));
});
test('successful AFTER metadata survives failed subsequent runAfter lookup',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-after-lookup-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes),m={...meta,digest};
 const mock=transport(bytes,{actualMeta:m,after:m});let runs=0;
 await assert.rejects(download({...expected,digest},join(parent,'artifact'),async(url,init)=>{
  if(String(url).includes('/actions/runs/') && ++runs===2)throw Error('UNIT-private-token-do-not-retain');
  return mock(url,init);
 }));
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);
 assert.equal(evidence.after.id,42);assert.equal(evidence.run.run_attempt,2);assert.equal(evidence.downloadedSha256,hash(bytes));
 assert(!Object.hasOwn(evidence,'runAfter'));assert.equal(evidence.failure.stage,'after-run-fetch');assert.equal(evidence.failure.reason,'operation-failed');
 assert(!text.includes('UNIT-private-token'));
});
test('first metadata fetch failure retains honest minimal expected identity, no invented responses',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-first-lookup-'));t.after(()=>rm(parent,{recursive:true,force:true}));let calls=0;
 await assert.rejects(download(expected,join(parent,'artifact'),async()=>{calls++;return new Response('UNIT-private-body-do-not-retain',{status:403});}),/GitHub metadata unavailable/);
 assert.equal(calls,1);
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);
 assert.deepEqual(evidence.expected,expected);assert.equal(evidence.failure.stage,'before-metadata-fetch');
 for(const key of ['before','run','after','runAfter','downloadedSha256'])assert(!Object.hasOwn(evidence,key));
 assert(!text.includes('UNIT-private-body'));
});
test('initial run fetch failure retains BEFORE metadata and a safe stage, never raw errors',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-initial-lookup-'));t.after(()=>rm(parent,{recursive:true,force:true}));let calls=0;
 await assert.rejects(download(expected,join(parent,'artifact'),async()=>{if(++calls===1)return Response.json(meta);throw Error('UNIT-private-error');}));
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);
 assert.equal(evidence.before.id,42);assert(!Object.hasOwn(evidence,'run'));assert.equal(evidence.failure.stage,'initial-run-fetch');assert.equal(evidence.failure.reason,'operation-failed');
 assert(!text.includes('UNIT-private-error'));
});
test('each response is on disk before the next lookup; only public validation identity is retained',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-public-metadata-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([p,b])=>[p,b,0o100644])),digest='sha256:'+hash(bytes);
 const m={...meta,digest,headers:{Authorization:'UNIT-private-header'},archive_download_url:'https://fixture/?UNIT-private-url',token:'UNIT-private-token'};
 const mock=transport(bytes,{actualMeta:m,after:m});let runs=0;
 await assert.rejects(download({...expected,digest,token:'UNIT-private-expected'},join(parent,'artifact'),async(url,init)=>{
  url=String(url);
  if(url.includes('/actions/runs/')){
   const evidence=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));
   assert.equal(evidence.before.id,42);
   if(++runs===2){assert.equal(evidence.after.id,42);throw Error('UNIT-private-transport');}
  }
  if(url.endsWith('/zip'))assert.equal(JSON.parse(await readFile(join(parent,'artifact-metadata.json'))).run.run_attempt,2);
  return mock(url,init);
 }));
 assert.equal(runs,2);
 const text=await readFile(join(parent,'artifact-metadata.json'),'utf8'),evidence=JSON.parse(text);assert.equal(evidence.after.id,42);assert.equal(evidence.run.run_attempt,2);assert.equal(evidence.failure.stage,'after-run-fetch');
 assert(!text.includes('UNIT-private'));assert(!text.includes('Authorization'));assert(!text.includes('archive_download_url'));
});
