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
function transport(bytes,{after=meta,runAfter=run,actualMeta=meta}={}) {
 let metas=0,runs=0;
 return async(url,init)=>{
  url=String(url);
  if(url==='https://blob.fixture/archive.zip'){assert(!init.headers);assert.equal(init.credentials,'omit');return new Response(bytes,{headers:{'content-length':String(bytes.length)}});}
  if(url.endsWith('/zip'))return new Response(null,{status:302,headers:{location:'https://blob.fixture/archive.zip'}});
  if(url.includes('/actions/runs/'))return Response.json(++runs===1?run:runAfter);
  return Response.json(++metas===1?actualMeta:after);
 };
}
test('actual ZIP digest checked before extraction, metadata/run rebound after, safe download succeeds',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'journal-download-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const bytes=zip(Object.entries(await files()).map(([path,body])=>[path,body,0o100644]));
 const digest='sha256:'+hash(bytes),e={...expected,digest},m={...meta,digest};
 await download(e,join(parent,'artifact'),transport(bytes,{actualMeta:m,after:m}));
 const evidence=JSON.parse(await readFile(join(parent,'artifact-metadata.json')));assert.equal(evidence.downloadedSha256,hash(bytes));assert.equal(evidence.after.id,42);
 await assertArtifactDirectory(join(parent,'artifact'),e);
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
 assert.equal(failedAfter.runAfter.run_attempt,3);assert.equal(failedAfter.after.id,42);assert.equal(failedAfter.downloadedSha256,hash(bytes));
});
