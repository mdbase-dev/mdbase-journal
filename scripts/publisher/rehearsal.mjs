// Source qualification only: no dispatch, tag, deployment or privileged receipt.
import {execFileSync} from 'node:child_process';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadOriginals} from './originals.mjs';
import {prepareInstall} from './install-inputs.mjs';
import {deploymentFor} from './refs.mjs';
const target=process.argv[2];if(!['staging','production'].includes(target))throw Error('Explicit target required');
if(process.env.CLOUDFLARE_API_TOKEN||process.env.CLOUDFLARE_ACCOUNT_ID)throw Error('No deployment credentials permitted');
const policy=JSON.parse(await readFile('config/sdk-publication.json','utf8')).sdkPublication;
const sdkTrust=await loadOriginals({target,repoRoot:process.cwd(),hashes:{JOURNAL_TRUST_ASSET_SHA256:policy.environments[target].sha256}});
const publicFiles=execFileSync('git',['ls-files','-z','public'],{encoding:'utf8'}).split('\0').filter(Boolean);
const d=deploymentFor(target),plan={qualificationOnly:true,sha:'0'.repeat(40),tree:'0'.repeat(40),target,origin:d.origin,pagesBranch:d.branch,publicFiles,sdkTrust};
const base=await mkdtemp(join(tmpdir(),'journal-rehearsal-')),root=join(base,'candidate'),output=join(base,'artifact');
try {
 await mkdir(root);await mkdir(output);
 for(const path of ['src','public','pack','scripts','tools','vendor','config','package.json','package-lock.json','tsconfig.json'])await cp(path,join(root,path),{recursive:true});
 await writeFile(join(output,'plan.json'),JSON.stringify(plan,null,2)+'\n');await prepareInstall(plan,root);
 const env={...process.env,JOURNAL_SOURCE_ROOT:root};
 delete env.GITHUB_TOKEN;delete env.GH_TOKEN; // No reader credentials reach SDK/app execution.
 execFileSync('npm',['ci','--ignore-scripts','--no-bin-links','--no-audit','--no-fund'],{cwd:root,env,stdio:'inherit'});
 execFileSync(process.execPath,[join(root,'scripts/publisher/build.mjs'),output],{cwd:root,env,stdio:'inherit'});
 console.log('Authenticated '+target+' build and complete inventory rehearsal passed; no deployment');
}finally{await rm(base,{recursive:true,force:true});}
