// Last network guard immediately before the sole upload; no approval APIs.
import { fileURLToPath } from 'node:url';
import { assertTagEvent, eventBinding } from './native-tag.mjs';
export async function assertCurrentHead(env=process.env, transport=fetch, event) {
 const binding=event ? assertTagEvent(env,event) : await eventBinding(env);
 const base=`https://api.github.com/repos/${env.GITHUB_REPOSITORY}`;
 const get=async path=>{
  const response=await transport(base+path,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'}});
  if(!response.ok)throw Error('Current protected native HEAD/tag unavailable; refusing upload');
  return response.json();
 };
 const branch=await get(`/git/ref/heads/${binding.releaseRef}`);
 if(branch.ref!==`refs/heads/${binding.releaseRef}` || branch.object?.type!=='commit' || branch.object.sha!==binding.sha)
  throw Error('Current native HEAD moved; refusing upload');
 const tag=await get(`/git/ref/tags/${binding.ref.slice('refs/tags/'.length)}`);
 if(tag.ref!==binding.ref)throw Error('Current exact tag moved; refusing upload');
 let object=tag.object;
 for(let i=0;object?.type==='tag' && i<4;i++) {
  if(!/^[a-f0-9]{40}$/.test(object.sha??''))throw Error('Invalid tag object');
  object=(await get(`/git/tags/${object.sha}`)).object;
 }
 if(object?.type!=='commit' || object.sha!==binding.sha)throw Error('Current peeled tag moved; refusing upload');
 // Re-read branch last: tag lookup must not turn an earlier HEAD into permission.
 const last=await get(`/git/ref/heads/${binding.releaseRef}`);
 if(last.ref!==branch.ref || last.object?.type!=='commit' || last.object.sha!==binding.sha)throw Error('Current native HEAD moved; refusing upload');
 return binding;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) await assertCurrentHead();
