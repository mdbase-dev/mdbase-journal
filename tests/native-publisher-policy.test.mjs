import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 const pkg=JSON.parse(await source('package.json'));
 assert.equal(pkg.scripts.typecheck,'node node_modules/typescript/bin/tsc --noEmit','--no-bin-links must never fall through to a global compiler');
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
test('unprivileged hash/member/build refusal retains distinct failure-only evidence even when publish artifact skips',async()=>{
 const s=await source('.github/workflows/native-journal.yml'),build=s.split('\n  native-build:')[1].split('\n  native-upload:')[0];
 const failure=build.split('      - id: failure-receipt')[1];
 assert(failure,'failed unprivileged build currently has no receipt-producing step');
 assert.match(failure,/if: failure\(\)/);assert.match(failure,/native-build-evidence\.mjs failure/);
 assert.match(failure,/name: journal-native-build-failure-/);
 assert.match(failure,/path: \$\{\{ runner.temp \}\}\/journal-build-failure\//);
 assert(build.indexOf('native-build-evidence.mjs begin')<build.indexOf('node scripts/native-publisher.mjs guard'));
 for(const stage of ['original-hashes','installed-members','app-build'])assert(build.includes('" '+stage)||build.includes(' '+stage+'\n'));
});
test('failure retention cannot qualify a publish artifact or make failed native-build reach protected upload',async()=>{
 const s=await source('.github/workflows/native-journal.yml'),build=s.split('\n  native-build:')[1].split('\n  native-upload:')[0],upload=s.split('\n  native-upload:')[1];
 assert.match(build,/artifact-id: \$\{\{ steps.artifact.outputs.artifact-id \}\}/);
 assert.match(build,/artifact-digest: \$\{\{ steps.artifact.outputs.artifact-digest \}\}/);
 const publish=build.split('      - id: artifact\n')[1].split('      - id: failure-receipt')[0];
 assert(!/if:|continue-on-error:/.test(publish));assert(!publish.includes('journal-build-failure'));
 assert.match(upload,/needs: \[native-tag, native-inputs, native-build\]/);
 assert(!/^    if:/m.test(upload));assert(!/continue-on-error:/.test(s));
 // Thus the implicit success() job dependency stays intact. This is workflow
 // structure proof, not a claim that a GitHub run/approval was exercised.
});
for(const [stage,failedStep] of [['original-hashes','intake'],['installed-members','intake'],['app-build','build']])test('safe failure helper retains '+stage+' refusal without qualifying a publish artifact',async t=>{
 const {markBuildStage,retainBuildFailure}=await import('../scripts/native-build-evidence.mjs');
 const dir=await mkdtemp(join(tmpdir(),'journal-build-failure-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const [sha,tree]=execFileSync('git',['rev-parse','HEAD','HEAD^{tree}'],{encoding:'utf8'}).trim().split('\n');
 const env={TARGET:'staging',SOURCE_SHA:sha,GITHUB_REPOSITORY:'fixture/journal',GITHUB_RUN_ID:'23',GITHUB_RUN_ATTEMPT:'2',GITHUB_REF:`refs/tags/native-publish-staging-${sha}`,
  GITHUB_TOKEN:'UNIT-private-token',CLOUDFLARE_API_TOKEN:'UNIT-private-cf',WHOLE_CONTEXT:'UNIT-private-context',BUILD_CHECKOUT_OUTCOME:'success',BUILD_NODE_OUTCOME:'success',BUILD_EVIDENCE_OUTCOME:'success',BUILD_INTAKE_OUTCOME:failedStep==='intake'?'failure':'success',BUILD_BUILD_OUTCOME:failedStep==='build'?'failure':'skipped',BUILD_ARTIFACT_OUTCOME:'skipped'};
 await markBuildStage(dir,'before-intake',{env});
 const initial=JSON.parse(await readFile(join(dir,'build-failure.json')));
 assert.equal(initial.source,sha);assert.equal(initial.tree,tree);assert.equal(initial.stage,'before-intake');assert.equal(initial.status,'incomplete');
 await markBuildStage(dir,stage,{env});
 // Prior file can contain arbitrary candidate fields; none are copied out.
 const prior=JSON.parse(await readFile(join(dir,'build-failure.json')));await writeFile(join(dir,'build-failure.json'),JSON.stringify({...prior,artifactId:42,qualified:true,context:'UNIT-private-context'}));
 await retainBuildFailure(dir,{env});
 const text=await readFile(join(dir,'build-failure.json'),'utf8'),receipt=JSON.parse(text);
 assert.equal(receipt.status,'failed');assert.equal(receipt.stage,stage);assert.deepEqual(receipt.failure.failedSteps,[failedStep]);
 assert.equal(receipt.steps.artifact,'skipped');assert.equal(receipt.repository,'fixture/journal');assert.equal(receipt.run,'23');assert.equal(receipt.attempt,'2');assert.equal(receipt.ref,env.GITHUB_REF);
 for(const unsafe of ['UNIT-private','GITHUB_TOKEN','CLOUDFLARE','qualified','artifactId','artifact-id','inventory','plan'])assert(!text.includes(unsafe));
});
test('minimal failure helper does not invent missing tree/identity/stage or claim a successful run failed',async t=>{
 const {retainBuildFailure,markBuildStage}=await import('../scripts/native-build-evidence.mjs');
 const dir=await mkdtemp(join(tmpdir(),'journal-build-unknown-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={TARGET:'staging',SOURCE_SHA:'a'.repeat(40),GITHUB_REPOSITORY:'unsafe context UNIT-private',BUILD_INTAKE_OUTCOME:'failure'};
 const receipt=await retainBuildFailure(dir,{env,cwd:dir});assert.equal(receipt.tree,null);assert.equal(receipt.repository,null);assert.equal(receipt.run,null);assert.equal(receipt.ref,null);assert.equal(receipt.stage,'unavailable');
 await assert.rejects(retainBuildFailure(dir,{env:{},cwd:dir}),/observed failed step/);
 await assert.rejects(markBuildStage(dir,'UNIT-private',{env,cwd:dir}),/Unknown public/);
 assert(!(await readFile(join(dir,'build-failure.json'),'utf8')).includes('UNIT-private'));
});
