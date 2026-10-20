import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTagEvent, assertCheckout, reviewedNativeBase } from '../scripts/native-tag.mjs';
import { assertCurrentHead } from '../scripts/native-current-head.mjs';
export function tagFixture(target='staging') {
 const sha='a'.repeat(40),repository='fixture/journal',ref=`refs/tags/native-publish-${target}-${sha}`;
 return {env:{TARGET:target,SOURCE_SHA:sha,GITHUB_SHA:sha,GITHUB_WORKFLOW_SHA:sha,GITHUB_REF:ref,GITHUB_EVENT_NAME:'push',GITHUB_REPOSITORY:repository,GITHUB_WORKFLOW_REF:`${repository}/.github/workflows/native-journal.yml@${ref}`},event:{ref,created:true,deleted:false,forced:false,repository:{full_name:repository}}};
}
for(const target of ['staging','production'])test('only full exact new '+target+' native tag/event/workflow commit is admitted',()=>{
 const f=tagFixture(target);assert.equal(assertTagEvent(f.env,f.event).releaseRef,'release/native-'+target);
});
for(const [field,value] of Object.entries({GITHUB_SHA:'b'.repeat(40),GITHUB_WORKFLOW_SHA:'b'.repeat(40),GITHUB_WORKFLOW_REF:'fixture/journal/.github/workflows/native-journal.yml@refs/heads/main',GITHUB_REF:'refs/tags/native-publish-staging-'+'a'.repeat(39),GITHUB_EVENT_NAME:'workflow_dispatch',TARGET:'production',SOURCE_SHA:'b'.repeat(40)}))test('tag refuses mismatched '+field,()=>{
 const f=tagFixture();assert.throws(()=>assertTagEvent({...f.env,[field]:value},f.event),/Refusing/);
});
test('updated/deleted/forced tag, wrong event ref/repository and prefix/suffix/glob variants refuse',()=>{
 const f=tagFixture();
 for(const patch of [{created:false},{deleted:true},{forced:true},{ref:f.event.ref+'-extra'},{repository:{full_name:'candidate/fork'}}])assert.throws(()=>assertTagEvent(f.env,{...f.event,...patch}));
 for(const ref of [f.env.GITHUB_REF+'x',f.env.GITHUB_REF.replace('staging','lab'),f.env.GITHUB_REF.replace('refs/tags','refs/heads'),f.env.GITHUB_REF.toUpperCase()])assert.throws(()=>assertTagEvent({...f.env,GITHUB_REF:ref},{...f.event,ref}));
});
test('clean exact checkout/peeled tag is required, reviewed native base is unchanged',()=>{
 assert.equal(reviewedNativeBase,'2007dc4d7aa65a8dd6871e37532dde7a43eca674');
 assert.throws(()=>assertCheckout(assertTagEvent(tagFixture().env,tagFixture().event),new URL('../',import.meta.url).pathname),/mismatch/);
});
test('current API branch HEAD rechecked last and annotated exact tag peeled to commit',async()=>{
 const {env,event}=tagFixture();let calls=[];
 const transport=async(url,options)=>{assert.equal(options.redirect,'error');calls.push(url);return {ok:true,json:async()=>url.includes('/git/tags/')?{object:{type:'commit',sha:env.SOURCE_SHA}}:url.includes('/ref/tags/')?{ref:env.GITHUB_REF,object:{type:'tag',sha:'b'.repeat(40)}}:{ref:'refs/heads/release/native-staging',object:{type:'commit',sha:env.SOURCE_SHA}}};};
 await assertCurrentHead(env,transport,event);assert(calls.at(-1).endsWith('/git/ref/heads/release/native-staging'));assert.equal(calls.length,4);
});
test('current API refuses moved head/tag, unavailable metadata or last-second head movement',async()=>{
 const {env,event}=tagFixture();
 for(const mode of ['head','tag','unavailable','last','tag-loop']) {
  let branches=0;
  const transport=async url=>({ok:mode!=='unavailable',json:async()=>{
   if(url.includes('/ref/heads/'))return {ref:'refs/heads/release/native-staging',object:{type:'commit',sha:mode==='head'||(mode==='last'&&++branches===2)?'b'.repeat(40):env.SOURCE_SHA}};
   if(url.includes('/git/tags/'))return {object:{type:'tag',sha:'b'.repeat(40)}};
   return {ref:env.GITHUB_REF,object:{type:mode==='tag-loop'?'tag':'commit',sha:mode==='tag'?'b'.repeat(40):env.SOURCE_SHA}};
  }});
  await assert.rejects(assertCurrentHead(env,transport,event));
 }
});
