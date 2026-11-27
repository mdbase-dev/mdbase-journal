import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtemp,mkdir,readFile,rm,writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {applicationInputs,assertStylesheetsShipped} from "../scripts/build-application.mjs";
import {pinnedSdkFixture} from "./pinned-sdk-fixture.mjs";
import {buildJournalManifest} from "../scripts/build-manifest.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
test("native build requires environment and exact origin; the ID defaults to the manifest's",()=>{
  assert.throws(()=>applicationInputs({}),/require/);
  const env={JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only",JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:"https://journal.fixture"};
  for(const key of ["JOURNAL_ENVIRONMENT","JOURNAL_ORIGIN"]){const absent={...env};delete absent[key];assert.throws(()=>applicationInputs(absent),/require/);}
  const {JOURNAL_REGISTERED_APPLICATION_ID:_,...withoutId}=env;
  assert.equal(applicationInputs(withoutId).registeredApplicationId,"dev.mdbase.journal");
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
  const fixture=await pinnedSdkFixture();
  const {buildApplication}=await import(pathToFileURL(resolve(fixture.root,"scripts/build-application.mjs")).href);
  try{
    const result=await buildApplication({writingOnly:true,env:{},output});
    assert.equal(result.inputs,null);assert.equal(result.writingOnly,true);
    assert(Object.keys(result.sdk.inputs).every(path=>!path.includes("/testing/")));
    // The fixture symlinks most dependencies to this checkout, so esbuild reports
    // them by real path (../node_modules/...); they are the same locked packages.
    const inputs=Object.keys(result.application.inputs).map(path=>path.replace(/^\.\.\/(?=node_modules\/)/,"")),bundled=inputs.filter(path=>path.startsWith("node_modules/"));
    assert.deepEqual(inputs.filter(path=>!bundled.includes(path)).sort(),["public/.well-known/mdbase-app.json","src/application.ts","src/connection-notice.ts","src/draft-opens.ts","src/drafts.ts","src/grant-callback.ts","src/journal-data.ts","src/main.ts","src/returning-notice.ts","src/setup-conflicts.ts","src/view.ts"]);
    // Bundled packages follow the published pins: each is a locked runtime (non-dev)
    // package, and the bundle carries the SDK, the shared collection UI and React.
    const lock=JSON.parse(await readFile(resolve(root,"package-lock.json"),"utf8"));
    const lockKey=path=>{const parts=path.split("/");let key=[];for(let i=0;i<parts.length-1;i++)if(parts[i]==="node_modules"){const end=i+(parts[i+1].startsWith("@")?3:2);key=parts.slice(0,end);i=end-1;}return key.join("/");};
    const packages=[...new Set(bundled.map(lockKey))].sort();
    for(const key of packages)assert(lock.packages[key]&&!lock.packages[key].dev&&!lock.packages[key].devOptional,`bundled ${key} is not a locked runtime dependency`);
    for(const name of ["@mdbase-dev/sdk","@mdbase-dev/ui","react","react-dom"])assert(packages.includes(`node_modules/${name}`),`bundle lacks ${name}`);
    assert(bundled.filter(path=>path.startsWith("node_modules/@mdbase-dev/sdk/")).every(path=>!/\/(testing|native)\/|application\/(entry|worker)/.test(path)));
    // collections.css @imports brand, motion and screens; they ship inlined.
    const collections=await readFile(resolve(output,"mdbase-collections.css"),"utf8");
    assert.doesNotMatch(collections,/@import/);
    for(const name of ["brand","motion","screens","collections"])
      assert(collections.includes(`node_modules/@mdbase-dev/ui/css/${name}.css */`),name);
    for(const member of ["application/worker.js","native/sqlite3.js","native/runtime.wasm","native/sqlite3.wasm"]){
      const archive=resolve(root,`vendor/${fixture.pin.artifact}`);
      const original=execFileSync("tar",["-xOf",archive,`package/dist/${member}`],{maxBuffer:16*1024*1024});
      assert.deepEqual(await readFile(resolve(output,"sdk",member)),original);
    }
    // Explicit fixture build inputs exercise packaging, not registration or a
    // native browser lifecycle. Missing explicit build inputs still refuses above.
    const native=await buildApplication({output,env:{JOURNAL_REGISTERED_APPLICATION_ID:"build-fixture-only",JOURNAL_ENVIRONMENT:"production",JOURNAL_ORIGIN:"https://journal.mdbase.dev"}});
    assert.equal(native.writingOnly,false);
    assert.equal(native.inputs.registeredApplicationId,"build-fixture-only");
    assert.equal(JSON.parse(await readFile(resolve(output,".well-known/mdbase-app.json"),"utf8")).homepage,"https://journal.mdbase.dev/");
    const provenance=JSON.parse(await readFile(resolve(output,"sdk/native/provenance.json"),"utf8"));
    assert.equal(provenance.runtime.source.commit,fixture.pin.runtime.source.commit);
    assert.equal(provenance.runtime.sha256,fixture.pin.runtime.sha256);
    const html=await readFile(resolve(root,"public/index.html"),"utf8");
    // Root-absolute: the consent window returns to /auth/mdbase/callback.
    assert.match(html,/<script type="module" src="\/journal.js"><\/script>/);
    assert.doesNotMatch(html,/(?:href|src)="\.\//);
    assert.match(await readFile(resolve(output,"sdk/application/app-grant.js"),"utf8"),/deliverAppGrantCallback/);
    assert.doesNotMatch(html,/connect-popup|native-signin-ui|cdn.jsdelivr|callback-note/);
    await assert.rejects(()=>buildApplication({output,env:{JOURNAL_ENVIRONMENT:"lab",JOURNAL_ORIGIN:"https://journal.fixture"}}),/carries "production" release trust, not lab trust/);
    // The old drift failure must still reject changed installed bytes under the current pin.
    await writeFile(resolve(fixture.root,"node_modules/@mdbase-dev/sdk/dist/app-host/app-environment.js"),"// installed tampering\n");
    await assert.rejects(()=>buildApplication({writingOnly:true,env:{},output}),/Installed SDK drift: app-host\/app-environment\.js/);
    const protocol=resolve(fixture.root,fixture.pin.bundledDependencies[0].member.slice("package/".length));
    await writeFile(protocol,"changed protocol original");
    await assert.rejects(()=>buildApplication({writingOnly:true,env:{},output}),{code:"ERR_ASSERTION"});
  }finally{await fixture.close();await rm(output,{recursive:true,force:true});}
});
test("the build refuses output that links or imports a stylesheet it does not contain",async()=>{
  const output=await mkdtemp(resolve(root,".application-build-"));
  try{
    await mkdir(resolve(output,"nested"));
    await writeFile(resolve(output,"index.html"),'<link rel="stylesheet" href="https://fonts.example/css"><link rel="stylesheet" href="/a.css"><link rel="icon" href="/missing.svg">');
    await writeFile(resolve(output,"a.css"),'@import "./nested/b.css";');
    await writeFile(resolve(output,"nested/b.css"),"p{}");
    await assertStylesheetsShipped(output);
    await writeFile(resolve(output,"a.css"),'@import "./nested/b.css";\n@import url("brand.css");');
    await assert.rejects(()=>assertStylesheetsShipped(output),/a\.css: brand\.css/);
    await writeFile(resolve(output,"a.css"),"");
    await writeFile(resolve(output,"404.html"),"<link href='/screens.css' rel=stylesheet>");
    await assert.rejects(()=>assertStylesheetsShipped(output),/404\.html: \/screens\.css/);
  }finally{await rm(output,{recursive:true,force:true});}
});
