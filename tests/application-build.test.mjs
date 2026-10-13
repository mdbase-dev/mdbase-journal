import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {applicationInputs,buildApplication} from "../scripts/build-application.mjs";
import {buildJournalManifest} from "../scripts/build-manifest.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
test("native build requires environment and exact origin; the ID defaults to the manifest's",()=>{
  assert.throws(()=>applicationInputs({}),/require/);
  const env={JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only",JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:"https://journal.fixture"};
  for(const key of ["JOURNAL_ENVIRONMENT","JOURNAL_ORIGIN"]){const absent={...env};delete absent[key];assert.throws(()=>applicationInputs(absent),/require/);}
  const {JOURNAL_REGISTERED_APPLICATION_ID:_,...withoutId}=env;
  assert.equal(applicationInputs(withoutId).registeredApplicationId,"dev.mdbase.journal-prototype");
  for(const origin of ["https://journal.fixture/path","https://journal.fixture?x=1","http://journal.fixture","https://user@journal.fixture"])
    assert.throws(()=>applicationInputs({...env,JOURNAL_ORIGIN:origin}),/origin/);
  assert.throws(()=>applicationInputs({...env,JOURNAL_ENVIRONMENT:"production",JOURNAL_ORIGIN:"http://localhost:3000"}),/origin/);
  assert.deepEqual(applicationInputs(env),{registeredApplicationId:env.JOURNAL_REGISTERED_APPLICATION_ID,environment:"lab",origin:"https://journal.fixture"});
});
test("manifest homepage follows the build origin and defaults to the pages.dev origin",async()=>{
  const committed=await readFile(resolve(root,"public/.well-known/mdbase-app.json"),"utf8");
  assert.equal(JSON.stringify(await buildJournalManifest(),null,2)+"\n",committed);
  assert.equal(JSON.parse(committed).homepage,"https://mdbase-journal.callum-artifacts.pages.dev/");
  const lab=await buildJournalManifest({origin:"http://127.0.0.1:48224",allowLocal:true});
  assert.equal(lab.homepage,"http://127.0.0.1:48224/");
  assert.deepEqual(lab.redirect_uris,["http://127.0.0.1:48224/auth/mdbase/callback"]);
});
test("consumer build retains original same-artifact Worker/native bytes and no private/test entry",async()=>{
  const output=await mkdtemp(resolve(root,".application-build-"));
  try{
    const result=await buildApplication({writingOnly:true,env:{},output});
    assert.equal(result.inputs,null);assert.equal(result.writingOnly,true);
    assert(Object.keys(result.sdk.inputs).every(path=>!path.includes("/testing/")));
    const inputs=Object.keys(result.application.inputs),bundled=inputs.filter(path=>path.startsWith("node_modules/"));
    assert.deepEqual(inputs.filter(path=>!bundled.includes(path)).sort(),["public/.well-known/mdbase-app.json","src/application.ts","src/draft-opens.ts","src/drafts.ts","src/grant-callback.ts","src/journal-data.ts","src/main.ts","src/returning-notice.ts","src/view.ts"]);
    // Bundled: the shared collection UI with React, and only the SDK's describe (copy) modules.
    assert.deepEqual([...new Set(bundled.map(path=>path.split("/").slice(1,path.startsWith("node_modules/@")?3:2).join("/")))].sort(),["@mdbase-dev/sdk","@mdbase-dev/ui","react","react-dom","scheduler"]);
    assert(bundled.filter(path=>path.startsWith("node_modules/@mdbase-dev/sdk/")).every(path=>!/\/(testing|native)\/|application\/(entry|worker)/.test(path)));
    assert.equal(await readFile(resolve(output,"mdbase-collections.css"),"utf8"),await readFile(resolve(root,"node_modules/@mdbase-dev/ui/css/collections.css"),"utf8"));
    for(const member of ["application/worker.js","native/sqlite3.js","native/runtime-lab.wasm","native/sqlite3.wasm"]){
      const archive=resolve(root,"vendor/mdbase-dev-sdk-fb9691b0.tgz");
      const original=execFileSync("tar",["-xOf",archive,`package/dist/${member}`],{maxBuffer:16*1024*1024});
      assert.deepEqual(await readFile(resolve(output,"sdk",member)),original);
    }
    // Explicit fixture build inputs exercise packaging, not registration or a
    // native browser lifecycle. Missing explicit build inputs still refuses above.
    const native=await buildApplication({output,env:{JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only",JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:"https://journal.fixture"}});
    assert.equal(native.writingOnly,false);
    assert.equal(native.inputs.registeredApplicationId,"build-fixture-only");
    assert.equal(JSON.parse(await readFile(resolve(output,".well-known/mdbase-app.json"),"utf8")).homepage,"https://journal.fixture/");
    const provenance=JSON.parse(await readFile(resolve(output,"sdk/native/provenance.lab.json"),"utf8"));
    assert.equal(provenance.runtime.source.commit,"512a727190a37557183a6e1b7a3bc422053c7114");
    assert.equal(provenance.runtime.sha256,"fe3374ea8102f4ed374139d0ba69f26c0ea8194b7bd93a1ace004f1a118b44bc");
    assert.equal(provenance.verifier.clockOverride,false);
    const html=await readFile(resolve(root,"public/index.html"),"utf8");
    // Root-absolute: the consent window returns to /auth/mdbase/callback.
    assert.match(html,/<script type="module" src="\/journal.js"><\/script>/);
    assert.doesNotMatch(html,/(?:href|src)="\.\//);
    assert.match(await readFile(resolve(output,"sdk/application/app-grant.js"),"utf8"),/deliverAppGrantCallback/);
    assert.doesNotMatch(html,/connect-popup|native-signin-ui|cdn.jsdelivr|callback-note/);
  }finally{await rm(output,{recursive:true,force:true});}
});
