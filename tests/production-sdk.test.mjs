import assert from 'node:assert/strict';
import {copyFile, readFile, mkdtemp, rm} from 'node:fs/promises';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {loadOriginals} from '../scripts/lib/native-originals.mjs';
import {buildApplication} from '../scripts/build-application.mjs';

const root=new URL('../',import.meta.url);
test('production dependency binds the original eaa4e697 SDK and beta.141 trust and builds locally',async t=>{
  const pkg=JSON.parse(await readFile(new URL('package.json',root)));
  assert.equal(pkg.dependencies['@mdbase-dev/sdk'],'file:vendor/sdk-eaa4e697-production-beta141.tgz');
  const hashes={NATIVE_TRUST_ASSET_SHA256:'7912e40838213e60b65848350d319a48019021317b112e3326429b250f0133d7'};
  for(const [key,name] of [['SDK','sdk'],['UI','ui'],['PROTOCOL','connect-protocol']])
    hashes['NATIVE_'+key+'_SHA256']=createHash('sha256').update(await readFile(new URL(pkg.dependencies['@mdbase-dev/'+name].slice(5),root))).digest('hex');
  const originals=await loadOriginals({target:'production',repoRoot:root.pathname,hashes,installed:true});
  assert.equal(originals.sdkSource,'eaa4e697fc1198f32fc3714f377342a24c56d985');
  assert.equal(originals.release.source.version,'0.1.0-beta.141');
  assert.equal(originals.release.cpOrigin,'https://connect.mdbase.dev');
  assert.equal(originals.release.logOrigin,'https://log.mdbase.dev');
  const output=await mkdtemp(new URL('.application-build-production-',root).pathname);
  t.after(()=>rm(output,{recursive:true,force:true}));
  // As the publisher does: tracked static files first, so the page's stylesheet links are checked.
  for(const page of ['index.html','journal.css'])await copyFile(new URL('public/'+page,root),output+'/'+page);
  await buildApplication({output,originals,env:{JOURNAL_ENVIRONMENT:'production',JOURNAL_ORIGIN:'https://journal.mdbase.dev'}});
  assert.doesNotMatch(await readFile(output+'/mdbase-collections.css','utf8'),/@import/);
});
