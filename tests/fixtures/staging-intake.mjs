import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Historical staging assertions use their original frozen pins, not today's UI/SDK.
export async function frozenStagingRoot(t) {
  const project = new URL('../../', import.meta.url);
  const root = await realpath(await mkdtemp(new URL('.test-staging-', project).pathname));
  t.after(() => rm(root, {recursive:true, force:true}));
  for (const [file,snapshot] of [['package.json','staging-package.snapshot'],['package-lock.json','staging-lock.snapshot']])
    await writeFile(join(root,file),await readFile(new URL(snapshot,import.meta.url)));
  await mkdir(join(root,'vendor/native-release'),{recursive:true});
  await cp(new URL('vendor/native-release/staging',project),join(root,'vendor/native-release/staging'),{recursive:true});
  const pkg=JSON.parse(await readFile(join(root,'package.json')));
  for (const name of ['sdk','ui','connect-protocol']) {
    const archive=pkg.dependencies['@mdbase-dev/'+name].slice(5);
    await cp(new URL(archive,project),join(root,archive));
    const installed=join(root,'node_modules/@mdbase-dev',name);
    await mkdir(installed,{recursive:true});
    execFileSync('tar',['-xzf',join(root,archive),'--strip-components=1','-C',installed]);
  }
  return root;
}
