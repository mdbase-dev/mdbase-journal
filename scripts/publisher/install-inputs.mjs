// Derive a data-only, ephemeral npm staging install from the authenticated plan.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicBytes} from './authentication.mjs';
export async function prepareInstall(plan,root=process.cwd(),fetchImpl=fetch) {
 if(plan.target==='production')return;
 if(plan.target!=='staging')throw Error('Unknown install target');
 const original=plan.sdkTrust.archives.sdk,bytes=await publicBytes(plan.sdkTrust.stagingUrl,fetchImpl);
 if(createHash('sha256').update(bytes).digest('hex')!==original.sha256)throw Error('Staging original changed');
 const pkgPath=join(root,'package.json'),lockPath=join(root,'package-lock.json');
 const pkg=JSON.parse(await readFile(pkgPath,'utf8')),lockBytes=await readFile(lockPath),lock=JSON.parse(lockBytes);
 if(createHash('sha256').update(lockBytes).digest('hex')!==plan.sdkTrust.lockSha256)throw Error('Source lock changed');
 if(pkg.dependencies['@mdbase-dev/sdk']!=='file:'+plan.sdkTrust.production.path)throw Error('Production source pin changed');
 await writeFile(join(root,original.path),bytes,{flag:'wx'});
 const spec='file:'+original.path;
 pkg.dependencies['@mdbase-dev/sdk']=spec;lock.packages[''].dependencies['@mdbase-dev/sdk']=spec;
 Object.assign(lock.packages['node_modules/@mdbase-dev/sdk'],{name:'@mdbase-dev/sdk-staging',resolved:spec,integrity:original.sri});
 await writeFile(pkgPath,JSON.stringify(pkg,null,2)+'\n');await writeFile(lockPath,JSON.stringify(lock,null,2)+'\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url))await prepareInstall(JSON.parse(await readFile(process.argv[2],'utf8')));
