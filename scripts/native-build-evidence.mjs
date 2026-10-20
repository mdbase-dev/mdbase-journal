// PUBLIC, failure-only unprivileged evidence. No SDK/app imports or log capture.
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const stages=new Set(['before-intake','original-hashes','frozen-install','installed-members','installed-plan','typecheck','publisher-tests','app-build','envelope']);
const stepNames=['checkout','node','evidence','intake','build','artifact'];
const outcomeValues=new Set(['success','failure','skipped','cancelled']);
const safe=(value,pattern)=>typeof value==='string' && pattern.test(value)?value:null;
function identity(env,cwd) {
 const target=safe(env.TARGET,/^(staging|production)$/),source=safe(env.SOURCE_SHA,/^[a-f0-9]{40}$/);
 let tree=null;
 try {
  const [head,observedTree]=execFileSync('git',['rev-parse','HEAD','HEAD^{tree}'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim().split('\n');
  if(head===source)tree=safe(observedTree,/^[a-f0-9]{40}$/);
 }catch{/* Unavailable tree is honestly null, never fabricated. */}
 return {target,source,tree,repository:safe(env.GITHUB_REPOSITORY,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  run:safe(env.GITHUB_RUN_ID,/^[1-9][0-9]*$/),attempt:safe(env.GITHUB_RUN_ATTEMPT,/^[1-9][0-9]*$/),
  ref:target && source && env.GITHUB_REF===`refs/tags/native-publish-${target}-${source}`?env.GITHUB_REF:null};
}
async function save(dir,record) {
 await mkdir(dir,{recursive:true});await writeFile(join(dir,'build-failure.json'),JSON.stringify(record,null,2)+'\n');return record;
}
export async function markBuildStage(dir,stage,{env=process.env,cwd=process.cwd()}={}) {
 if(!stages.has(stage))throw Error('Unknown public build evidence stage');
 return save(dir,{kind:'journal-native-build-failure',status:'incomplete',...identity(env,cwd),stage});
}
export async function retainBuildFailure(dir,{env=process.env,cwd=process.cwd()}={}) {
 const steps=Object.fromEntries(stepNames.map(name=>{const v=env[`BUILD_${name.toUpperCase()}_OUTCOME`];return [name,outcomeValues.has(v)?v:'unknown'];}));
 const failedSteps=stepNames.filter(name=>steps[name]==='failure');
 if(!failedSteps.length)throw Error('Failure evidence requires an observed failed step');
 let stage='unavailable';
 let handle;
 try {
  handle=await open(join(dir,'build-failure.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await handle.stat();
  if(stat.isFile() && stat.size<=4096){
   const bytes=Buffer.alloc(4097),{bytesRead}=await handle.read(bytes,0,bytes.length,0);
   if(bytesRead<=4096){const previous=JSON.parse(bytes.subarray(0,bytesRead));if(stages.has(previous.stage))stage=previous.stage;}
  }
 }catch{/* No previous evidence is not proof of an intake/build stage. */}
 finally{await handle?.close();}
 // Reconstruct only whitelisted identity/stage/outcomes. Never copy previous
 // record fields, candidate error text, env, contexts, logs or artifact outputs.
 return save(dir,{kind:'journal-native-build-failure',status:'failed',...identity(env,cwd),stage,steps,
  failure:{reason:'unprivileged-build-refused',failedSteps}});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try {
  const [command,dir,stage]=process.argv.slice(2);
  if(command==='begin')await markBuildStage(dir,'before-intake');
  else if(command==='mark')await markBuildStage(dir,stage);
  else if(command==='failure')await retainBuildFailure(dir);
  else throw Error('Unknown public build evidence command');
 }catch{/* No raw errors: even transport/candidate text must not become evidence. */console.error('Public build failure evidence could not be retained');process.exitCode=1;}
}
