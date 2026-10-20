import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
const source = path => readFile(new URL('../'+path,import.meta.url),'utf8');
test('shared byte helper remains byte exact',async()=>{
 assert.equal(createHash('sha256').update(await source('scripts/lib/native-publish-bytes.mjs')).digest('hex'),'a4336258cea726285573e9e667bba1c1ad6797fdba331715d0f17ea67ea5c66a');
});
test('target builder verifies installed originals before importing candidate SDK build code',async()=>{
 const s=await source('scripts/native-build.mjs');
 assert(s.indexOf('installed: true') < s.indexOf("await import('./build-application.mjs')"));
 assert(!/^import .*@mdbase/m.test(s));
});
test('new tag workflow separates unprivileged build and action-readable protected uploader',async()=>{
 const s=await source('.github/workflows/native-journal.yml');
 const build=s.split('\n  native-build:')[1]?.split('\n  native-upload:')[0];
 const upload=s.split('\n  native-upload:')[1];
 assert(build && upload);assert(!build.includes('environment:'));assert(!build.includes('secrets.'));assert(!build.includes('actions: read'));
 assert.match(upload,/permissions:\n      contents: read\n      actions: read/);
 assert(!upload.includes('npm run build'));assert(!upload.includes('npm ci'));
 assert.match(upload,/id: capture/);assert.match(upload,/steps\.capture\.outcome == 'success'/);
 assert.match(s,/include-hidden-files: true/);assert(!s.includes('pending_deployments'));
});
test('frozen app install disables generated NPM bin links without relaxing ALL-member checking',async()=>{
 const s=await source('.github/workflows/native-journal.yml');
 assert.match(s,/npm ci --ignore-scripts --no-bin-links --no-audit --no-fund/);
 assert.match(s,/node node_modules\/typescript\/bin\/tsc --noEmit/);
});
test('original intake uses frozen NPM lock, not PNPM or a new authentication authority',async()=>{
 const s=await source('scripts/lib/native-originals.mjs');
 assert.match(s,/package-lock\.json/);assert(!s.includes('pnpm-lock'));assert(!s.includes('authenticated: true'));
 assert.match(s,/ALL installed original members/);assert.match(s,/SDK bundled protocol differs/);
});
test('native hosting implements source-owned live checks rather than permanent unverified',async()=>{
 const s=await source('scripts/native-hosting.mjs');
 assert.match(s,/verifyServedBytes/);assert.match(s,/X-Content-Type-Options/);assert.match(s,/auth\/mdbase\/callback/);
 assert.match(s,/404/);assert(!s.includes('hostingControlsVerified'));
});
