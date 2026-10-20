import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertFrozenNpm, assertBundledProtocol, installedMembers, protectedHashes, loadOriginals, originalMembers, bindCanonicalPacket, assertNativeOriginalFacts, assertProtocolFacts } from '../scripts/lib/native-originals.mjs';
import { digest, packetFixture } from './native-packet-fixture.mjs';
const name='@mdbase-dev/sdk',pin='file:vendor/sdk.tgz',sri='sha512-fixture';
function frozen() {
 const pkg={dependencies:{[name]:pin},devDependencies:{tool:'1.0.0'}};
 const original={name,version:'1.0.0',dependencies:{protocol:'file:vendor/protocol.tgz'}};
 return {pkg,original,name,pin,sri,lock:{lockfileVersion:3,packages:{'':structuredClone(pkg),['node_modules/'+name]:{version:'1.0.0',resolved:pin,integrity:sri,dependencies:original.dependencies}}}};
}
test('NPM frozen file resolution, full root/dev pins and original version/deps are exact',()=>{
 assert.doesNotThrow(()=>assertFrozenNpm(frozen()));
 for(const mutate of [f=>f.lock.lockfileVersion=2,f=>f.lock.packages[''].dependencies[name]='*',f=>f.lock.packages[''].devDependencies.tool='2',f=>f.lock.packages['node_modules/'+name].integrity='bad',f=>f.lock.packages['node_modules/'+name].resolved='https://registry.invalid/sdk.tgz',f=>f.lock.packages['node_modules/'+name].link=true,f=>f.original.version='2',f=>f.original.name='sdk',f=>f.original.dependencies={}]) {
  const f=frozen();mutate(f);assert.throws(()=>assertFrozenNpm(f),/Refusing/);
 }
});
test('SDK nested bundled protocol must equal ALL pinned original members and exact NPM lock',()=>{
 const member={path:'index.js',bytes:4,sha256:'a'.repeat(64)},protocol={path:'vendor/protocol.tgz'};
 const fixture=()=>({members:[{...member,path:'node_modules/@mdbase-dev/connect-protocol/index.js'}],protocolMembers:[member],protocolPackage:{version:'129',dependencies:{yaml:'2'}},sdkPackage:{dependencies:{'@mdbase-dev/connect-protocol':'file:vendor/protocol.tgz'}},protocol,lock:{packages:{'node_modules/@mdbase-dev/sdk':{dependencies:{'@mdbase-dev/connect-protocol':'file:vendor/protocol.tgz'}},'node_modules/@mdbase-dev/sdk/node_modules/@mdbase-dev/connect-protocol':{version:'129',inBundle:true,dependencies:{yaml:'2'}}}}});
 assert.doesNotThrow(()=>assertBundledProtocol(fixture()));
 for(const mutate of [f=>f.members[0].sha256='b'.repeat(64),f=>f.members.push({...f.members[0],path:'node_modules/@mdbase-dev/connect-protocol/extra.js'}),f=>f.members=[],f=>f.lock.packages['node_modules/@mdbase-dev/sdk/node_modules/@mdbase-dev/connect-protocol'].version='123',f=>f.lock.packages['node_modules/@mdbase-dev/sdk/node_modules/@mdbase-dev/connect-protocol'].inBundle=false,f=>f.lock.packages['node_modules/@mdbase-dev/sdk/node_modules/@mdbase-dev/connect-protocol'].resolved='registry',f=>f.sdkPackage.dependencies['@mdbase-dev/connect-protocol']='129']) {
  const f=fixture();mutate(f);assert.throws(()=>assertBundledProtocol(f),/Refusing/);
 }
});
test('installed inventory includes dotfiles and nested members, refuses links',async t=>{
 const root=await mkdtemp(join(tmpdir(),'journal-installed-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'nested'));await writeFile(join(root,'.hidden'),'x');await writeFile(join(root,'nested/index.js'),'original');
 const members=await installedMembers(root);assert.deepEqual(members.map(a=>a.path),['.hidden','nested/index.js']);
 await writeFile(join(root,'nested/index.js'),'changed');assert.notDeepEqual(await installedMembers(root),members);
 await symlink(join(root,'.hidden'),join(root,'linked'));await assert.rejects(installedMembers(root),/symlink/);
});
for(const target of ['staging','production'])test('canonical '+target+' packet byte bindings are valid WITHOUT authentication claim',async()=>{
 const f=packetFixture(target),result=await bindCanonicalPacket(f);
 assert.equal(result.release.assetSha256,f.hashes.NATIVE_TRUST_ASSET_SHA256);assert.equal(result.environment,target);
 assert.notEqual(result.trustModuleSha256,result.release.assetSha256);assert.notEqual(result.packet.contextSha256,result.release.assetSha256);
});
test('producer member ordering is not archive identity; all exact path/length/hash tuples still required',async()=>{
 const f=packetFixture();f.packetFiles['members.json']=Buffer.from(JSON.stringify([...f.members].reverse()));
 await bindCanonicalPacket(f);
 for(const change of [a=>a.push(a[0]),a=>a[0].sha256='f'.repeat(64),a=>a[0].bytes++,a=>a[0].path='substitute',a=>a[0].unexpected=true]){
  const bad=packetFixture(),members=structuredClone(bad.members);change(members);bad.packetFiles['members.json']=Buffer.from(JSON.stringify(members));await assert.rejects(bindCanonicalPacket(bad),/inventory mismatch/);
 }
});
test('actual TNAPP canonical native source is mdbase-next, distinct from Connect trust source',()=>{
 const f=packetFixture(),facts=JSON.parse(f.packetFiles['artifact-facts.json']),provenance=JSON.parse(f.packetFiles['provenance.json']);
 assert.doesNotThrow(()=>assertNativeOriginalFacts(facts,provenance));
 const wrong=structuredClone(provenance);wrong.runtime.source.repository='mdbase-dev/mdbase-connect';assert.throws(()=>assertNativeOriginalFacts(facts,wrong));
});
test('actual TNAPP canonical protocol facts file is full vendor path, not an invented basename alias',()=>{
 const f=packetFixture(),facts=JSON.parse(f.packetFiles['artifact-facts.json']);
 assert.doesNotThrow(()=>assertProtocolFacts(facts,f.archives.protocol));
 const wrong=structuredClone(facts);wrong.dependencies[0].file='protocol.tgz';assert.throws(()=>assertProtocolFacts(wrong,f.archives.protocol));
});
const alter=(f,name,change)=>{const obj=JSON.parse(f.packetFiles[name]);change(obj);f.packetFiles[name]=Buffer.from(JSON.stringify(obj));};
for(const [label,mutate] of Object.entries({
 'wrong signed asset':f=>f.packetFiles['next-trust/staging.json']=Buffer.from('wrong'),
 'module hash not asset hash':f=>f.hashes.NATIVE_TRUST_ASSET_SHA256=digest(f.sdkFiles['dist/application/packaged-trust.js']),
 'context hash not asset hash':f=>f.hashes.NATIVE_TRUST_ASSET_SHA256=digest(f.packetFiles['next-trust/staging-context.json']),
 'receipt hash not asset hash':f=>f.hashes.NATIVE_TRUST_ASSET_SHA256=digest(f.packetFiles['build-receipt.json']),
 'missing original':f=>delete f.packetFiles['image-release-bundle.sigstore.json'],
 'source facts':f=>alter(f,'artifact-facts.json',o=>o.source='short'),
 'facts environment':f=>alter(f,'artifact-facts.json',o=>o.environment='lab'),
 'facts trust':f=>alter(f,'artifact-facts.json',o=>o.trust.sha256='f'.repeat(64)),
 'facts handoff':f=>alter(f,'artifact-facts.json',o=>o.handoff.receiptSha256='f'.repeat(64)),
 'facts verifier':f=>alter(f,'artifact-facts.json',o=>o.verifier.source='f'.repeat(40)),
 'facts module digest':f=>alter(f,'artifact-facts.json',o=>o.packagedTrustModuleSha256='f'.repeat(64)),
 'archive facts':f=>alter(f,'artifact-facts.json',o=>o.sha256='f'.repeat(64)),
 'complete member set':f=>alter(f,'members.json',o=>o.pop()),
 'provenance copy':f=>alter(f,'provenance.json',o=>o.environment='lab'),
 'wrong context CP':f=>alter(f,'next-trust/staging-context.json',o=>o.context.control_plane_origin='https://connect-lab.mdbase.dev'),
 'wrong context repo':f=>alter(f,'next-trust/staging-context.json',o=>o.context.source.repository='candidate/fork'),
 'changed proof':f=>f.packetFiles['release-trust-bundle.sigstore.json']=Buffer.from('changed'),
 'receipt verifier':f=>alter(f,'build-receipt.json',o=>o.verifierSha256='c'.repeat(64)),
 'receipt context':f=>alter(f,'build-receipt.json',o=>o.contextSha256='c'.repeat(64)),
 'compiled trust':f=>f.sdkFiles['dist/application/packaged-trust.js']=Buffer.from(f.sdkFiles['dist/application/packaged-trust.js'].toString().replace('staging','production')),
 'native original':f=>f.sdkFiles['dist/native/runtime.wasm']=Buffer.from('substitute'),
 'protocol original custody':f=>alter(f,'artifact-facts.json',o=>o.dependencies[0].sha256='f'.repeat(64)),
}))test('canonical binding refuses '+label,async()=>{const f=packetFixture();mutate(f);await assert.rejects(bindCanonicalPacket(f));});
test('actual approved STAGING NPM intake binds independent owner facts and ALL installed originals before SDK execution',async()=>{
 const {loadStagingOriginals,STAGING_FACTS_SHA256}=await import('../scripts/staging-originals.mjs');
 const originals=await loadStagingOriginals({repoRoot:new URL('../',import.meta.url).pathname,installed:true});
 assert.equal(originals.packet.factsSha256,STAGING_FACTS_SHA256);assert.equal(originals.environment,'staging');
 assert.deepEqual(Object.fromEntries(Object.entries(originals.archives).map(([name,a])=>[name,a.members])),{sdk:896,ui:78,protocol:67});
 assert.equal(originals.release.assetSha256,'67e117646c9c26927f0d5a44cbd26f057c318975032e9cd24f24b020150cdbc7');
 assert.notEqual(originals.release.assetSha256,originals.trustModuleSha256);
});
test('protected hash set is exactly four canonical byte expectations; missing never defaults to candidate',()=>{
 const f=packetFixture();assert.equal(Object.keys(protectedHashes(f.hashes)).length,4);
 for(const name of Object.keys(f.hashes)){const h={...f.hashes};delete h[name];assert.throws(()=>protectedHashes(h),/four protected/);}
});
test('unchanged actual LAB original remains actual runtime-lab.wasm; no target packet is invented',async()=>{
 const root=new URL('../',import.meta.url),archive=new URL('vendor/mdbase-dev-sdk-0ecbef41.tgz',root);
 const members=originalMembers(archive.pathname);assert(members.some(m=>m.path==='dist/native/runtime-lab.wasm'));
 assert(!members.some(m=>m.path==='dist/native/runtime.wasm'));
 await assert.rejects(loadOriginals({target:'lab',repoRoot:root.pathname,hashes:packetFixture().hashes}),/no LAB retarget/);
 const pkg=JSON.parse(await readFile(new URL('package.json',root)));
 const hashes={NATIVE_TRUST_ASSET_SHA256:'a'.repeat(64)};
 for(const [key,name] of [['SDK','sdk'],['UI','ui'],['PROTOCOL','connect-protocol']])hashes['NATIVE_'+key+'_SHA256']=digest(await readFile(new URL(pkg.dependencies['@mdbase-dev/'+name].slice(5),root)));
 hashes.NATIVE_SDK_SHA256='f'.repeat(64);
 await assert.rejects(loadOriginals({target:'staging',repoRoot:root.pathname,hashes,installed:true}),/protected archive hash mismatch/);
});
