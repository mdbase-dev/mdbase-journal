import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {applicationInputs,buildApplication} from "../scripts/build-application.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
test("native build requires explicit registration/environment/exact origin, never historical defaults",()=>{
  assert.throws(()=>applicationInputs({}),/require/);
  const env={JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only",JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:"https://journal.fixture"};
  for(const key of Object.keys(env)){const absent={...env};delete absent[key];assert.throws(()=>applicationInputs(absent),/require/);}
  for(const origin of ["https://journal.fixture/path","https://journal.fixture?x=1","http://journal.fixture","https://user@journal.fixture"])
    assert.throws(()=>applicationInputs({...env,JOURNAL_ORIGIN:origin}),/origin/);
  assert.throws(()=>applicationInputs({...env,JOURNAL_ENVIRONMENT:"production",JOURNAL_ORIGIN:"http://localhost:3000"}),/origin/);
  assert.deepEqual(applicationInputs(env),{registeredApplicationId:env.JOURNAL_REGISTERED_APPLICATION_ID,environment:"lab",origin:"https://journal.fixture"});
});
test("consumer build retains original same-artifact Worker/native bytes and no private/test entry",async()=>{
  const output=await mkdtemp(resolve(root,".application-build-"));
  try{
    const result=await buildApplication({writingOnly:true,env:{},output});
    assert.equal(result.inputs,null);assert.equal(result.writingOnly,true);
    assert(Object.keys(result.sdk.inputs).every(path=>!path.includes("/testing/")));
    assert.deepEqual(Object.keys(result.application.inputs).sort(),["public/.well-known/mdbase-app.json","src/application.ts","src/drafts.ts","src/journal-data.ts","src/main.ts","src/view.ts"]);
    for(const member of ["application/worker.js","native/sqlite3.js"]){
      const archive=resolve(root,"vendor/mdbase-dev-sdk-563dc868.tgz");
      const original=execFileSync("tar",["-xOf",archive,`package/dist/${member}`],{maxBuffer:16*1024*1024});
      assert.deepEqual(await readFile(resolve(output,"sdk",member)),original);
    }
    await assert.rejects(buildApplication({output,env:{JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only",JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:"https://journal.fixture"}}),/lacks packaged native assets/);
    const html=await readFile(resolve(root,"public/index.html"),"utf8");
    assert.match(html,/<script type="module" src="\.\/journal.js"><\/script>/);
    assert.doesNotMatch(html,/connect-popup|native-signin-ui|cdn.jsdelivr|callback-note/);
  }finally{await rm(output,{recursive:true,force:true});}
});
