import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it} from 'node:test';
import {loadOriginals,productionPin,protectedHashes} from './originals.mjs';
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
