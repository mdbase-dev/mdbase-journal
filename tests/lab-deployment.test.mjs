import assert from "node:assert/strict";
import {test} from "node:test";
import {journalLabDeploymentFor} from "../scripts/deployment-environment.mjs";
test("Journal deployment requires literal LAB and the fixed approved host",()=>{
  assert.deepEqual(journalLabDeploymentFor({MDBASE_ENV:"lab"}),{origin:"https://lab.mdbase-journal-lab.pages.dev",connectOrigin:"https://connect-lab.mdbase.dev",project:"mdbase-journal-lab",branch:"lab"});
  for(const MDBASE_ENV of [undefined,"staging","production",""])assert.throws(()=>journalLabDeploymentFor({MDBASE_ENV}));
});
