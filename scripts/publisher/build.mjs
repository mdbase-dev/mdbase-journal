// Unprivileged source build, after the ALL-original installed-member gate.
import {cp,lstat,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {compareInstalled} from './originals.mjs';
import {publicationInventory,serializeInventory} from './publisher.mjs';
import {headersPolicy,redirectsPolicy} from './hosting-policy.mjs';
const root=process.cwd(),output=process.argv[2],plan=JSON.parse(await readFile(join(output,'plan.json'),'utf8'));
await compareInstalled(root,plan.sdkTrust.archives);
const {buildApplication}=await import('../build-application.mjs');
const {buildOfflineShell}=await import('@mdbase-dev/sdk/offline-shell/build');
const {validateAppManifest}=await import('@mdbase-dev/connect-protocol/manifest');
const publish=join(output,'publish');await mkdir(publish);
for(const path of plan.publicFiles) {
 if(!path.startsWith('public/')||path.split('/').includes('..'))throw Error('Unsafe static source');
 const from=join(root,path);if(!(await lstat(from)).isFile()||await realpath(from)!==from)throw Error('Nonregular static source');
 const to=join(publish,path.slice(7));await mkdir(dirname(to),{recursive:true});await cp(from,to,{errorOnExist:true,force:false});
}
await buildApplication({output:publish,originals:plan.sdkTrust,env:{JOURNAL_ENVIRONMENT:plan.target,JOURNAL_ORIGIN:plan.origin,JOURNAL_BUILD_COMMIT:plan.sha}});
const browser=await readFile(join(publish,'sdk/browser/mdbase-sdk.min.js'));
const asset={sourceCommit:plan.sdkTrust.sdkSource,sha256:createHash('sha256').update(browser).digest('hex'),integrity:'sha384-'+createHash('sha384').update(browser).digest('base64'),url:'./browser/mdbase-sdk.min.js'};
await writeFile(join(publish,'sdk/pin.mjs'),'export const SDK_ASSET = Object.freeze('+JSON.stringify(asset)+');\n');
const manifest=JSON.parse(await readFile(join(publish,'.well-known/mdbase-app.json'),'utf8'));
if(!validateAppManifest(manifest,{allowLocal:false}).valid)throw Error('Canonical target manifest refused');
await writeFile(join(publish,'_headers'),headersPolicy);await writeFile(join(publish,'_redirects'),redirectsPolicy);
await buildOfflineShell({directory:publish});
await writeFile(join(output,'inventory.json'),serializeInventory(await publicationInventory(publish,plan)));
