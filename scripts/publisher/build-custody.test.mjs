import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {it} from 'node:test';
it('candidate imports resolve after the original gate, not from the dependency-free publisher',async()=>{
 const build=await readFile(new URL('./build.mjs',import.meta.url),'utf8');
 const candidate=await readFile(new URL('./candidate-build.mjs',import.meta.url),'utf8');
 assert.ok(build.indexOf('await compareInstalled(')<build.indexOf('await import(pathToFileURL('));
 assert.ok(build.includes("join(root,'scripts/publisher/candidate-build.mjs')"));
 assert.ok(!build.includes("await import('@mdbase-dev/"));
 assert.ok(candidate.includes("from '@mdbase-dev/sdk/offline-shell/build'"));
 const rehearsal=await readFile(new URL('./rehearsal.mjs',import.meta.url),'utf8');
 assert.ok(rehearsal.includes("join(publisher,'scripts/publisher/build.mjs')"));
 assert.ok(!rehearsal.includes("await cp('node_modules'"));
});
