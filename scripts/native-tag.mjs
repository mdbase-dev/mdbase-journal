// Journal has no default-registered deploy workflow. Only Co's native tag bootstrap.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export const reviewedNativeBase = '2007dc4d7aa65a8dd6871e37532dde7a43eca674';
export function assertTagEvent(env, event) {
 const match = /^refs\/tags\/native-publish-(staging|production)-([a-f0-9]{40})$/.exec(env.GITHUB_REF ?? '');
 if (!match || env.GITHUB_EVENT_NAME !== 'push' || match[2] !== env.GITHUB_SHA || env.GITHUB_WORKFLOW_SHA !== match[2] ||
     env.GITHUB_WORKFLOW_REF !== `${env.GITHUB_REPOSITORY}/.github/workflows/native-journal.yml@${env.GITHUB_REF}` ||
     event.ref !== env.GITHUB_REF || event.created !== true || event.deleted !== false || event.forced !== false ||
     event.repository?.full_name !== env.GITHUB_REPOSITORY || (env.SOURCE_SHA && env.SOURCE_SHA !== match[2]) || (env.TARGET && env.TARGET !== match[1]))
  throw Error('Refusing nonexact new native tag/event/workflow source');
 return { target:match[1], sha:match[2], ref:env.GITHUB_REF, releaseRef:`release/native-${match[1]}` };
}
export function assertCheckout(binding, cwd, { clean = true } = {}) {
 const git = (...args) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if (git('rev-parse','HEAD') !== binding.sha || git('rev-parse',`${binding.ref}^{commit}`) !== binding.sha ||
     git('rev-parse',`refs/remotes/origin/${binding.releaseRef}^{commit}`) !== binding.sha)
  throw Error('Refusing checkout/peeled tag/current protected head mismatch');
 git('merge-base','--is-ancestor',reviewedNativeBase,binding.sha);
 if (clean && git('status','--porcelain','--untracked-files=all')) throw Error('Refusing dirty native checkout');
 return { ...binding, tree:git('rev-parse','HEAD^{tree}') };
}
export async function eventBinding(env=process.env) {
 return assertTagEvent(env, JSON.parse(await readFile(env.GITHUB_EVENT_PATH,'utf8')));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
 const binding=await eventBinding();assertCheckout(binding,process.cwd());
 console.log(JSON.stringify(binding));
}
