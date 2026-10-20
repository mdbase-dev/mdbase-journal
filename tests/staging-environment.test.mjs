import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {applicationInputs,nativeAssetNames} from "../scripts/build-application.mjs";
import {legacyLabFixture} from './legacy-lab-fixture.mjs';
import {buildJournalManifest} from "../scripts/build-manifest.mjs";
import {JOURNAL_DEPLOYMENT_TARGETS,journalDeploymentFor,journalLabDeploymentFor} from "../scripts/deployment-environment.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
// Hosting targets approved by Callum; production publication still requires
// a separate GO and the protected publisher. These are not served receipts.
const LAB="https://lab.mdbase-journal-lab.pages.dev";
const STAGING="https://staging.mdbase-journal.pages.dev";
const PRODUCTION="https://journal.mdbase.dev";
test("approved hosting targets resolve exactly; unconfigured and unknown targets still refuse",()=>{
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.staging.origin,STAGING);
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.staging.project,"mdbase-journal");
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.staging.connectOrigin,"https://connect-staging.mdbase.dev");
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.staging.configured,true);
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.production.origin,PRODUCTION);
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.production.project,"mdbase-journal");
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.production.connectOrigin,"https://connect.mdbase.dev");
  assert.equal(JOURNAL_DEPLOYMENT_TARGETS.production.configured,true);
  for(const MDBASE_ENV of [undefined,"","qa","LAB"])assert.throws(()=>journalDeploymentFor({MDBASE_ENV}));
  const lab={origin:LAB,connectOrigin:"https://connect-lab.mdbase.dev",project:"mdbase-journal-lab",branch:"lab"};
  assert.deepEqual(journalDeploymentFor({MDBASE_ENV:"lab"}),lab);
  assert.deepEqual(journalLabDeploymentFor({MDBASE_ENV:"lab"}),lab);
  assert.deepEqual(journalDeploymentFor({MDBASE_ENV:"staging"}),
    {origin:STAGING,connectOrigin:"https://connect-staging.mdbase.dev",project:"mdbase-journal",branch:"staging"});
  // "main" selects Pages' production channel, never the Git source ref.
  assert.deepEqual(journalDeploymentFor({MDBASE_ENV:"production"}),
    {origin:PRODUCTION,connectOrigin:"https://connect.mdbase.dev",project:"mdbase-journal",branch:"main"});
  const unconfigured={...JOURNAL_DEPLOYMENT_TARGETS,
    staging:{...JOURNAL_DEPLOYMENT_TARGETS.staging,configured:false},
    production:{...JOURNAL_DEPLOYMENT_TARGETS.production,configured:false}};
  for(const MDBASE_ENV of ["staging","production"])
    assert.throws(()=>journalDeploymentFor({MDBASE_ENV},unconfigured),/not configured/);
  assert.deepEqual(journalDeploymentFor({MDBASE_ENV:"lab"},unconfigured),lab);
});
test("native build inputs admit explicit staging/production, refuse unknown and non-LAB loopback",()=>{
  const base={JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only"};
  assert.deepEqual(applicationInputs({...base,JOURNAL_ENVIRONMENT:"staging",JOURNAL_ORIGIN:STAGING}),
    {registeredApplicationId:"build-fixture-only",environment:"staging",origin:STAGING});
  assert.deepEqual(applicationInputs({...base,JOURNAL_ENVIRONMENT:"production",JOURNAL_ORIGIN:PRODUCTION}),
    {registeredApplicationId:"build-fixture-only",environment:"production",origin:PRODUCTION});
  assert.equal(applicationInputs({...base,JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:LAB}).environment,"lab");
  assert.throws(()=>applicationInputs({...base,JOURNAL_ENVIRONMENT:"qa",JOURNAL_ORIGIN:STAGING}),/require/);
  assert.throws(()=>applicationInputs({...base,JOURNAL_ENVIRONMENT:"staging",JOURNAL_ORIGIN:"http://localhost:3000"}),/origin/);
  assert.throws(()=>applicationInputs({...base,JOURNAL_ENVIRONMENT:"staging",JOURNAL_ORIGIN:"http://127.0.0.1:48224"}),/origin/);
  assert.throws(()=>applicationInputs({...base,JOURNAL_ENVIRONMENT:"production",JOURNAL_ORIGIN:"http://journal.mdbase.dev"}),/origin/);
});
test("manifest builder emits exact staging/production installation origins and refuses mismatches",async()=>{
  const expected={lab:{"app-runtime":[LAB]},staging:{"app-runtime":[STAGING]},production:{"app-runtime":[PRODUCTION]}};
  const fallback=await buildJournalManifest();
  const staging=await buildJournalManifest({origin:STAGING,environment:"staging"});
  assert.equal(staging.homepage,STAGING+"/");
  assert.deepEqual(staging.installation_origins,expected);
  // Same app/grant identity and capability scopes in every environment.
  assert.equal(staging.id,fallback.id);
  assert.deepEqual(staging.requirements,fallback.requirements);
  const production=await buildJournalManifest({origin:PRODUCTION,environment:"production"});
  assert.equal(production.homepage,PRODUCTION+"/");
  assert.deepEqual(production.installation_origins,expected);
  // An origin that is not the environment's own target origin refuses.
  await assert.rejects(()=>buildJournalManifest({origin:PRODUCTION,environment:"staging"}),/staging/);
  await assert.rejects(()=>buildJournalManifest({origin:"https://journal.fixture",environment:"staging"}),/staging/);
  await assert.rejects(()=>buildJournalManifest({origin:STAGING,environment:"production"}),/production/);
  await assert.rejects(()=>buildJournalManifest({origin:STAGING,environment:"qa"}),/environment/);
  // LAB and the default committed manifest keep today's exact shape.
  assert.equal("installation_origins" in fallback,false);
  const lab=await buildJournalManifest({origin:LAB,environment:"lab"});
  assert.equal("installation_origins" in lab,false);
  assert.equal(lab.homepage,LAB+"/");
});
test("native asset names come from the packaged SDK declaration, not a hardcoded LAB filename",()=>{
  const future='const a=new URL("../native/runtime.wasm",import.meta.url);const b=new URL("../native/sqlite3.wasm",import.meta.url);const c=new URL("../native/sqlite3.js",import.meta.url);';
  assert.deepEqual([...nativeAssetNames(future)].sort(),["runtime.wasm","sqlite3.js","sqlite3.wasm"]);
  const current='const a=new URL("../native/runtime-lab.wasm",import.meta.url);const b=new URL("../native/sqlite3.wasm",import.meta.url);const c=new URL("../native/sqlite3.js",import.meta.url);';
  assert.deepEqual([...nativeAssetNames(current)].sort(),["runtime-lab.wasm","sqlite3.js","sqlite3.wasm"]);
  assert.throws(()=>nativeAssetNames("export {}"),/native/);
});
test("retained actual LAB profile refuses staging/production; new STAGING SDK is never relabelled LAB",async()=>{
  const output=await mkdtemp(resolve(root,".application-build-"));
  const fixture=await legacyLabFixture();
  const {buildApplication}=await import(pathToFileURL(resolve(fixture.root,'scripts/build-application.mjs')).href);
  try{
    for(const [environment,origin] of [["staging",STAGING],["production",PRODUCTION]])
      await assert.rejects(()=>buildApplication({output,env:{JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only",JOURNAL_ENVIRONMENT:environment,JOURNAL_ORIGIN:origin}}),/trust/);
  }finally{await fixture.close();await rm(output,{recursive:true,force:true});}
});
