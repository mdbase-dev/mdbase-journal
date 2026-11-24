import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it} from 'node:test';
import {loadOriginals,offlineShellRegistration,productionPin,protectedHashes} from './originals.mjs';
import {prepareInstall} from './install-inputs.mjs';
const root=new URL('../../',import.meta.url).pathname;
const policy=JSON.parse(await readFile(join(root,'config/sdk-publication.json'),'utf8')).sdkPublication;
const hashes=target=>({JOURNAL_TRUST_ASSET_SHA256:policy.environments[target].sha256});
it('authenticates production npm provenance and every installed SDK, direct bundled protocol and UI original',async()=>{
 const plan=await loadOriginals({target:'production',repoRoot:root,hashes:hashes('production'),installed:true});
 const {pin}=await productionPin(root);assert.equal(plan.authentication.source,pin.sourceCommit);assert.equal(plan.authentication.kind,'npm-provenance');
 assert.equal(plan.release.assetSha256,hashes('production').JOURNAL_TRUST_ASSET_SHA256);assert.throws(()=>protectedHashes({}));
 await assert.rejects(loadOriginals({target:'production',repoRoot:root,hashes:{JOURNAL_TRUST_ASSET_SHA256:'0'.repeat(64)}}),/protected trust hash/);
});
it('derives only the ephemeral SDK install and preserves every other frozen dependency',async()=>{
 const {pin,spec}=await productionPin(root),lock=await readFile(join(root,'package-lock.json'));
 const bytes=Buffer.from('authenticated staging archive fixture');
 const {createHash}=await import('node:crypto');
 const sdkTrust={production:{path:spec.slice(5),version:pin.version,sri:pin.sri},lockSha256:createHash('sha256').update(lock).digest('hex'),stagingUrl:'https://example.invalid/staging',archives:{sdk:{path:'vendor/sdk-staging.tgz',sha256:createHash('sha256').update(bytes).digest('hex'),sri:'sha512-'+createHash('sha512').update(bytes).digest('base64')}}};
 const temp=await mkdtemp(join(tmpdir(),'journal-stage-install-'));
 try {
  await mkdir(join(temp,'vendor'));for(const path of ['package.json','package-lock.json'])await cp(join(root,path),join(temp,path));
  const before=JSON.parse(lock),pkgBefore=JSON.parse(await readFile(join(temp,'package.json'),'utf8'));
  await prepareInstall({target:'staging',sdkTrust},temp,async()=>new Response(bytes));
  const after=JSON.parse(await readFile(join(temp,'package-lock.json'),'utf8')),pkg=JSON.parse(await readFile(join(temp,'package.json'),'utf8'));
  assert.equal(pkg.dependencies['@mdbase-dev/sdk'],'file:vendor/sdk-staging.tgz');
  pkg.dependencies['@mdbase-dev/sdk']=pkgBefore.dependencies['@mdbase-dev/sdk'];assert.deepEqual(pkg,pkgBefore);
  after.packages[''].dependencies['@mdbase-dev/sdk']=before.packages[''].dependencies['@mdbase-dev/sdk'];
  after.packages['node_modules/@mdbase-dev/sdk']=before.packages['node_modules/@mdbase-dev/sdk'];assert.deepEqual(after,before);
  await assert.rejects(prepareInstall({target:'staging',sdkTrust},temp,async()=>new Response('wrong bytes')),/Staging original changed/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
it('accepts an exact published UI pin only when the registry tarball matches the lock, then gates installed members',async()=>{
 const {execFileSync}=await import('node:child_process'),{createHash}=await import('node:crypto'),{writeFile}=await import('node:fs/promises');
 const {compareInstalled,directOriginal,originalMembers}=await import('./originals.mjs');
 const temp=await mkdtemp(join(tmpdir(),'journal-registry-original-'));
 try {
  const name='@mdbase-dev/ui',source=join(temp,'source/package');await mkdir(source,{recursive:true});
  await writeFile(join(source,'package.json'),JSON.stringify({name,version:'9.9.9'}));await writeFile(join(source,'index.js'),'export {};\n');
  const bytes=execFileSync('tar',['-czf','-','-C',join(temp,'source'),'package']),sri='sha512-'+createHash('sha512').update(bytes).digest('base64');
  const resolved='https://registry.npmjs.org/@mdbase-dev/ui/-/ui-9.9.9.tgz',lock={packages:{['node_modules/'+name]:{version:'9.9.9',resolved,integrity:sri}}};
  const fetchImpl=async url=>{assert.equal(url,resolved);return new Response(bytes);};
  const {original,path}=await directOriginal(temp,{dependencies:{[name]:'9.9.9'}},lock,name,{registry:true,fetchImpl});
  assert.deepEqual(original,bytes);assert.equal(path,undefined);
  await assert.rejects(directOriginal(temp,{dependencies:{[name]:'9.9.9'}},lock,name,{registry:true,fetchImpl:async()=>new Response('other bytes')}),/does not match the lock/);
  await assert.rejects(directOriginal(temp,{dependencies:{[name]:'^9.9.9'}},lock,name,{registry:true,fetchImpl}),/exact published version/);
  await assert.rejects(directOriginal(temp,{dependencies:{[name]:'9.9.9'}},lock,name,{registry:false,fetchImpl}),/committed original required/);
  const installed=join(temp,'node_modules',name);await cp(source,installed,{recursive:true});
  const archives={ui:{name,resolved,sri,members:originalMembers(bytes)}};
  await compareInstalled(temp,archives);
  await writeFile(join(installed,'index.js'),'changed installed member');
  await assert.rejects(compareInstalled(temp,archives),/ALL installed original/);
  await assert.rejects(compareInstalled(temp,{ui:{name,resolved,sri}}),/registry original members required/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
it('derives the exact offline-shell registration bytes from either known SDK generator and refuses anything else',()=>{
 const legacy='const base = "/";\n        await writeFile(join(directory, registrationFile), `if ("serviceWorker" in navigator) navigator.serviceWorker.register(${JSON.stringify(base + workerFile)}, {scope:${JSON.stringify(base)},type:"module"}).catch(() => console.warn("Offline app support could not start."));\\n`);\n';
 assert.equal(offlineShellRegistration(Buffer.from(legacy)),'if ("serviceWorker" in navigator) navigator.serviceWorker.register("/mdbase-shell-sw.js", {scope:"/",type:"module"}).catch(() => console.warn("Offline app support could not start."));\n');
 const activating='/** doc */\nfunction offlineShellRegistration(worker, scope) {\n    return `if ("serviceWorker" in navigator) {\n  navigator.serviceWorker.register(${JSON.stringify(worker)}, {scope:${JSON.stringify(scope)},type:"module"}).then(r => r.waiting?.postMessage({type:"mdbase-shell:activate"}));\n}\n`;\n}\n';
 assert.equal(offlineShellRegistration(Buffer.from(activating)),'if ("serviceWorker" in navigator) {\n  navigator.serviceWorker.register("/mdbase-shell-sw.js", {scope:"/",type:"module"}).then(r => r.waiting?.postMessage({type:"mdbase-shell:activate"}));\n}\n');
 for(const refused of ['',legacy+activating,activating.replace('${JSON.stringify(scope)}','${scope}'),activating.replace('${JSON.stringify(worker)}','"/sw.js"')])
  assert.throws(()=>offlineShellRegistration(Buffer.from(refused)),/registration/);
});
