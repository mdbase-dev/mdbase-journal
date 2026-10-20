// GitHub immutable same-run artifact transport, no project dependencies/hooks.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertInventory, inventoryDirectory } from './native-publish-bytes.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const requireValue = (ok, reason) => { if (!ok) throw Error(`Artifact refusal: ${reason}`); };
export function assertArtifactMetadata(meta, expected) {
  requireValue(/^[1-9][0-9]*$/.test(expected.id??'') && /^[1-9][0-9]*$/.test(expected.run??'') && /^[1-9][0-9]*$/.test(expected.attempt??'') && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository??'') && expected.event==='push' && expected.ref===`refs/tags/native-publish-${expected.target}-${expected.source}`, 'expected transport identity');
  requireValue(meta.id === Number(expected.id) && meta.expired === false && meta.digest === expected.digest && /^sha256:[a-f0-9]{64}$/.test(meta.digest), 'immutable ID/digest');
  requireValue(meta.name === `journal-native-build-${expected.target}-${expected.run}-${expected.attempt}`, 'attempt-bound name');
  requireValue(meta.workflow_run?.id === Number(expected.run) && meta.workflow_run?.head_sha === expected.source && meta.workflow_run?.head_repository_id === Number(expected.repositoryId), 'repository/run/source');
}
export function assertArtifactRun(run, expected) {
  requireValue(run.id===Number(expected.run) && run.repository?.full_name===expected.repository && run.repository?.id===Number(expected.repositoryId) && run.head_sha===expected.source && run.run_attempt===Number(expected.attempt) && run.event==='push' && run.head_branch===expected.ref.slice('refs/tags/'.length) && run.path==='.github/workflows/native-journal.yml', 'run attempt/event/ref/workflow/repository');
}
export async function assertArtifactDirectory(root, expected) {
  const envelope = JSON.parse(await readFile(join(root,'envelope.json'),'utf8'));
  for (const key of ['repository','run','attempt','event','ref','source','tree','target']) requireValue(envelope[key] === expected[key], `envelope ${key}`);
  const inventoryBytes = await readFile(join(root,'inventory.json'));
  const planBytes = await readFile(join(root,'plan.json'));
  requireValue(envelope.inventorySha256 === sha(inventoryBytes) && envelope.planSha256 === sha(planBytes), 'full inventory/plan binding');
  const plan = JSON.parse(planBytes), inventory = JSON.parse(inventoryBytes);
  requireValue(plan.sha === expected.source && plan.tree === expected.tree && plan.sdkTrust.environment === expected.target, 'plan source/tree/target');
  await assertInventory(join(root,'publish'), inventory);
  const all = await inventoryDirectory(root);
  requireValue(all.length === inventory.length + 3 && all.every(a => ['envelope.json','inventory.json','plan.json'].includes(a.path) || a.path.startsWith('publish/')), 'unexpected artifact paths');
  return {plan,inventory,envelope};
}
export async function download(expected, root, transport = fetch) {
  const token = process.env.GITHUB_TOKEN;
  const base = `https://api.github.com/repos/${expected.repository}`;
  const get = async path => {
    const response = await transport(base+path, {headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
    requireValue(response.ok, 'GitHub metadata unavailable'); return response.json();
  };
  await mkdir(join(root,'..'),{recursive:true});
  const evidence = join(root,'../artifact-metadata.json');
  const before = await get(`/actions/artifacts/${expected.id}`);
  await writeFile(evidence,JSON.stringify({before,expected},null,2));
  assertArtifactMetadata(before,expected);
  const run = await get(`/actions/runs/${expected.run}`);
  assertArtifactRun(run,expected);
  const response = await transport(`${base}/actions/artifacts/${expected.id}/zip`, {headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
  requireValue(response.status === 302, 'archive redirect');
  const location = new URL(response.headers.get('location'));
  requireValue(location.protocol === 'https:' && !location.username && !location.password, 'archive HTTPS');
  // Never forward GitHub credentials to the blob endpoint.
  const blob = await transport(location,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60000)});
  requireValue(blob.ok && Number(blob.headers.get('content-length')) <= 512*1024*1024,'archive size/status');
  const chunks=[]; let size=0;
  for await (const chunk of blob.body) { size+=chunk.length; requireValue(size<=512*1024*1024,'archive size'); chunks.push(chunk); }
  const bytes=Buffer.concat(chunks),downloadedSha256=sha(bytes);
  await writeFile(evidence,JSON.stringify({before,run,expected,downloadedSha256},null,2));
  requireValue(`sha256:${downloadedSha256}` === expected.digest,'download digest');
  await mkdir(root,{recursive:true});
  const zip=join(root,'../journal-native.zip'); await writeFile(zip,bytes,{flag:'wx'});
  // Validate ALL names/modes before extracting; no archive scripts or links.
  execFileSync('python3',['-B',fileURLToPath(new URL('./artifact-zip.py',import.meta.url)),zip,root]);
  const after = await get(`/actions/artifacts/${expected.id}`);
  const runAfter = await get(`/actions/runs/${expected.run}`);
  // Preserve the failing after-read too; validation must not erase evidence.
  await writeFile(evidence,JSON.stringify({before,after,run,runAfter,expected,downloadedSha256},null,2));
  assertArtifactRun(runAfter,expected);
  assertArtifactMetadata(after,expected);
  requireValue(sha(await readFile(zip)) === expected.digest.slice(7), 'post-download archive digest');
  await assertArtifactDirectory(root,expected);
  // Metadata and actual ZIP digest remain outside the immutable upload tree.
}
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const expected={id:process.env.ARTIFACT_ID,digest:`sha256:${(process.env.ARTIFACT_DIGEST ?? '').replace(/^sha256:/,'')}`,repository:process.env.GITHUB_REPOSITORY,repositoryId:process.env.GITHUB_REPOSITORY_ID,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,source:process.env.SOURCE_SHA,event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),target:process.env.TARGET};
    await download(expected,process.argv[2]);
  } catch(error) {console.error(error.message); process.exitCode=1;}
}
