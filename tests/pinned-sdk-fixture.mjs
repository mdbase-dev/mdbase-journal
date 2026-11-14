// Isolate installed-byte tampering tests using the exact current production pin.
// No producer build/install or application dependency mutation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedMembers, originalMembers, productionPin } from '../scripts/publisher/originals.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function pinnedSdkFixture() {
 const dir=await mkdtemp(join(root,'.application-build-pinned-sdk-'));
 try {
  const {pin}=await productionPin(root),archive=join(root,'vendor',pin.artifact),bytes=await readFile(archive);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);
  assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),pin.sri);
  const members=originalMembers(archive); // reject links/unsafe names BEFORE extraction
  const paths=execFileSync('git',['ls-files','-z','public','src','pack','scripts'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  paths.push('package.json','package-lock.json','vendor/'+pin.artifact,...pin.bundledDependencies.map(dependency=>dependency.member.slice('package/'.length)));
  for(const name of await readdir(join(root,'vendor')))if(/^sdk-production-[\w.-]+\.json$/.test(name)) {
   const metadata='vendor/'+name;
   if(JSON.parse(await readFile(join(root,metadata),'utf8')).artifact===pin.artifact)paths.push(metadata);
  }
  for(const path of paths){const dest=join(dir,path);await mkdir(dirname(dest),{recursive:true});await cp(join(root,path),dest);}
  await mkdir(join(dir,'node_modules/@mdbase-dev/sdk'),{recursive:true});
  for(const entry of await readdir(join(root,'node_modules'))){
   if(entry==='@mdbase-dev')continue;
   if(['react','react-dom','scheduler'].includes(entry))await cp(join(root,'node_modules',entry),join(dir,'node_modules',entry),{recursive:true});
   else await symlink(join(root,'node_modules',entry),join(dir,'node_modules',entry));
  }
  for(const entry of await readdir(join(root,'node_modules/@mdbase-dev'))){
   if(entry==='sdk')continue;
   if(entry==='ui')await cp(join(root,'node_modules/@mdbase-dev',entry),join(dir,'node_modules/@mdbase-dev',entry),{recursive:true});
   else await symlink(join(root,'node_modules/@mdbase-dev',entry),join(dir,'node_modules/@mdbase-dev',entry));
  }
  execFileSync('tar',['-xzf',archive,'--strip-components=1','-C',join(dir,'node_modules/@mdbase-dev/sdk')]);
  assert.deepEqual(await installedMembers(join(dir,'node_modules/@mdbase-dev/sdk')),members,'ALL current pinned SDK members before consumer execution');
  return {root:dir,pin,close:()=>rm(dir,{recursive:true,force:true})};
 }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
