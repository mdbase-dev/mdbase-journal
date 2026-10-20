// Retained LAB-profile consumer tests must use the actual original LAB SDK,
// not pretend the newly installed STAGING SDK is LAB. No producer build/install.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedMembers, originalMembers } from '../scripts/lib/native-originals.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function legacyLabFixture() {
 const dir=await mkdtemp(join(root,'.application-build-legacy-lab-'));
 try {
  const pin=JSON.parse(await readFile(join(root,'vendor/mdbase-sdk-dev-0ecbef41.json'))),archive=join(root,'vendor',pin.artifact),bytes=await readFile(archive);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);
  assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),pin.integrity);
  const members=originalMembers(archive); // reject links/unsafe names BEFORE extraction
  const paths=execFileSync('git',['ls-files','-z','public','src','pack','scripts/build-application.mjs','scripts/build-sdk.mjs','scripts/build-manifest.mjs','scripts/deployment-environment.mjs','vendor/mdbase-sdk-dev-0ecbef41.json',pin.protocol.file,'vendor/'+pin.artifact],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const path of paths){const dest=join(dir,path);await mkdir(dirname(dest),{recursive:true});await cp(join(root,path),dest);}
  await writeFile(join(dir,'package.json'),JSON.stringify({type:'module'}));
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
  assert.deepEqual(await installedMembers(join(dir,'node_modules/@mdbase-dev/sdk')),members,'ALL original retained LAB SDK members before legacy consumer execution');
  return {root:dir,close:()=>rm(dir,{recursive:true,force:true})};
 }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
}
