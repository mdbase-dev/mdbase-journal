// Authenticate SDK producer and target, then compare every frozen installed original.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticateProduction,stagingArchive} from './authentication.mjs';
const hash=(bytes,algorithm='sha256')=>createHash(algorithm).update(bytes).digest(algorithm==='sha512'?'base64':'hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));
export const digestNames=['JOURNAL_TRUST_ASSET_SHA256'];
export function protectedHashes(env=process.env) {
 assert.match(env.JOURNAL_TRUST_ASSET_SHA256??'',/^[a-f0-9]{64}$/,'protected JOURNAL_TRUST_ASSET_SHA256 required');
 return {JOURNAL_TRUST_ASSET_SHA256:env.JOURNAL_TRUST_ASSET_SHA256};
}
export function originalMembers(bytes) {
 if(typeof bytes==='string')bytes=readFileSync(bytes);
 return JSON.parse(execFileSync('python3',['-B',fileURLToPath(new URL('./archive-members.py',import.meta.url))],{input:bytes,encoding:'utf8',maxBuffer:16*1024*1024}));
}
function member(bytes,path) {
 assert(originalMembers(bytes).some(m=>m.path===path),'missing SDK original');
 return execFileSync('tar',['-xOzf','-',`package/${path}`],{input:bytes,maxBuffer:128*1024*1024});
}
async function regular(root,path) {
 assert(/^vendor\/[\w.-]+\.tgz$/.test(path)||/^config\/next-trust\/(staging|production)\.json$/.test(path),'unsafe original path');
 const full=join(root,path);assert((await lstat(full)).isFile()&&await realpath(full)===full,'nonregular original');return readFile(full);
}
export async function installedMembers(root,ignored=new Set()) {
 const rows=[];
 async function walk(dir,prefix='') {
  for(const name of await readdir(dir)) {
   const path=join(dir,name),rel=prefix+name,stat=await lstat(path);if(ignored.has(rel))continue;
   assert(!stat.isSymbolicLink(),'installed original symlink');
   if(stat.isDirectory())await walk(path,rel+'/');
   else {assert(stat.isFile()&&stat.size<=128*1024*1024&&rows.length<10000,'installed original bound');const bytes=await readFile(path);rows.push({path:rel,bytes:bytes.length,sha256:hash(bytes)});}
  }
 }
 await walk(root);return rows.sort((a,b)=>a.path<b.path?-1:1);
}
export async function productionPin(root) {
 const pkg=await json(join(root,'package.json')),spec=pkg.dependencies['@mdbase-dev/sdk'];
 assert.match(spec,/^file:vendor\/[\w.-]+\.tgz$/,'committed SDK original required');
 const path=spec.slice(5),pins=[];
 for(const name of await readdir(join(root,'vendor')))if(/^sdk-production-[\w.-]+\.json$/.test(name)) {
  const pin=await json(join(root,'vendor',name));if(pin.artifact===path.slice(7)&&pin.environment==='production')pins.push(pin);
 }
 assert.equal(pins.length,1,'unique production SDK pin required');const pin=pins[0],bytes=await regular(root,path);
 assert.equal(pin.sha256,hash(bytes),'committed SDK archive mismatch');assert.equal(pin.bytes,bytes.length);assert.equal(pin.sri,'sha512-'+hash(bytes,'sha512'));
 assert.equal(pin.publication.repository,'mdbase-dev/mdbase-connect');assert.equal(pin.publication.workflow,'.github/workflows/publish-sdk-npm.yml');
 assert(['refs/heads/main','refs/tags/v'+pin.version].includes(pin.publication.ref));return {pin,bytes,spec};
}
export async function compareInstalled(root,archives) {
 for(const original of Object.values(archives)) {
  const bytes=await regular(root,original.path);assert.equal(hash(bytes),original.sha256,'comparison original changed');
  const members=originalMembers(bytes),owns=path=>members.some(m=>m.path===path||m.path.startsWith(path+'/'));
  const ignored=!owns('node_modules')?new Set(['node_modules']):!owns('node_modules/.bin')?new Set(['node_modules/.bin']):new Set();
  const installed=await realpath(join(root,'node_modules',original.name));assert(!relative(root,installed).startsWith('..'),'originals outside checkout');
  assert.deepEqual(await installedMembers(installed,ignored),members,'ALL installed original members differ: '+original.name);
 }
}
export async function loadOriginals({target,repoRoot,hashes,installed=false,fetchImpl=fetch,authenticate=authenticateProduction,stage=stagingArchive}) {
 assert(['production','staging'].includes(target));protectedHashes(hashes);
 const {pin,bytes:production,spec}=await productionPin(repoRoot),pkg=await json(join(repoRoot,'package.json'));
 const lockBytes=await readFile(join(repoRoot,'package-lock.json')),lock=JSON.parse(lockBytes);
 assert.equal(lock.lockfileVersion,3);assert.deepEqual(lock.packages[''].dependencies,pkg.dependencies);assert.deepEqual(lock.packages[''].devDependencies,pkg.devDependencies);
 const sdkLock=lock.packages['node_modules/@mdbase-dev/sdk'];assert.equal(sdkLock.resolved,spec);assert.equal(sdkLock.integrity,pin.sri);assert.equal(sdkLock.version,pin.version);
 const auth=await authenticate(pin,production,{fetchImpl});let bytes=production,authentication=auth,stagingUrl;
 if(target==='staging') {const verified=await stage(pin,{fetchImpl});bytes=verified.bytes;authentication=verified.authentication;stagingUrl=verified.path;assert.equal(authentication.source,pin.sourceCommit,'staging producer mismatch');}
 const archives={};
 const sdkPath=target==='production'?spec.slice(5):'vendor/sdk-staging.tgz';
 archives.sdk={name:'@mdbase-dev/sdk',path:sdkPath,bytes:bytes.length,sha256:hash(bytes),sri:'sha512-'+hash(bytes,'sha512')};
 for(const [key,name] of [['protocol','@mdbase-dev/connect-protocol'],['ui','@mdbase-dev/ui']]) {
  const spec=pkg.dependencies[name];assert.match(spec,/^file:vendor\/[\w.-]+\.tgz$/);const path=spec.slice(5),original=await regular(repoRoot,path);
  const entry=lock.packages['node_modules/'+name];assert.equal(entry.resolved,spec);assert.equal(entry.integrity,'sha512-'+hash(original,'sha512'));
  const manifest=JSON.parse(member(original,'package.json'));assert.equal(manifest.name,name);assert.equal(manifest.version,entry.version);
  archives[key]={name,path,bytes:original.length,sha256:hash(original),sri:entry.integrity};
  if(key==='protocol')for(const sdk of [production,bytes]) {
   const sdkPackage=JSON.parse(member(sdk,'package.json')),protocolPath=sdkPackage.dependencies[name];assert.match(protocolPath,/^file:vendor\/[\w.-]+\.tgz$/);
   assert(member(sdk,protocolPath.slice(5)).equals(original),'direct protocol must equal authenticated SDK bundled original');
  }
 }
 const publication=(await json(join(repoRoot,'config/sdk-publication.json'))).sdkPublication,trust=publication.environments[target];
 const manifest=JSON.parse(member(bytes,'package.json')),provenance=JSON.parse(member(bytes,'dist/native/provenance.json'));
 assert.equal(manifest.name,trust.package);assert.equal(manifest.version,pin.version);assert.equal(provenance.schema,'mdbase-sdk/npm-publication/1');assert.equal(provenance.commit,pin.sourceCommit);assert.equal(provenance.environment,target);assert.deepEqual(provenance.trust,trust);
 const module=member(bytes,'dist/application/packaged-trust.js'),literal=/^const metadata = (\{.*\});$/m.exec(module.toString());assert(literal,'packaged trust literal');const release=JSON.parse(literal[1]);
 assert.equal(release.environment,target);assert.equal(release.cpOrigin,trust.cpOrigin);assert.equal(release.logOrigin,trust.logOrigin);assert.deepEqual(release.source,{repository:'mdbase-dev/mdbase-connect',commit:trust.sourceCommit,version:trust.sourceVersion});
 for(const digest of [release.assetSha256,trust.sha256,hash(await regular(repoRoot,`config/next-trust/${target}.json`))])assert.equal(digest,hashes.JOURNAL_TRUST_ASSET_SHA256,'protected trust hash mismatch');
 const assetPins=JSON.parse(member(bytes,'dist/application/asset-pins.json')),nativeAssets={};assert.deepEqual(assetPins.runtime,provenance.runtime);
 for(const [name,pin] of [['runtime.wasm',assetPins.runtime],['sqlite3.wasm',assetPins.sqlite],['sqlite3.js',assetPins.sqlite.initializer]]) {const original=member(bytes,'dist/native/'+name);assert.equal(pin.sha256,hash(original));assert.equal(pin.bytes,original.length);nativeAssets[name]={sha256:hash(original),bytes:original.length};}
 const runtime=member(bytes,'dist/offline-shell-worker.js').toString().replace(/\n\/\/# sourceMappingURL=.*$/m,'');
 const registration='if ("serviceWorker" in navigator) navigator.serviceWorker.register("/mdbase-shell-sw.js", {scope:"/",type:"module"}).catch(() => console.warn("Offline app support could not start."));\n';
 const offlineShell={runtime:{bytes:Buffer.byteLength(runtime),sha256:hash(runtime)},registration:{bytes:Buffer.byteLength(registration),sha256:hash(registration)}};
 if(installed)await compareInstalled(repoRoot,archives);
 return {environment:target,sdkSource:pin.sourceCommit,release,trust,nativeAssets,offlineShell,archives,authentication,trustModuleSha256:hash(module),lockSha256:hash(lockBytes),protectedHashes:hashes,stagingUrl,production:{path:spec.slice(5),sri:pin.sri,version:pin.version},appOrigin:target==='production'?'https://journal.mdbase.dev':'https://staging.mdbase-journal.pages.dev'};
}
