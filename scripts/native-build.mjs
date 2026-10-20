// UNPRIVILEGED ONLY. No target/Cloudflare credentials or GitHub environment.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadOriginals, protectedHashes } from './lib/native-originals.mjs';
import { headersPolicy, redirectsPolicy } from './native-hosting.mjs';
import { publicationInventory } from './native-publisher.mjs';
const output=resolve(process.argv[2]),plan=JSON.parse(await readFile(join(output,'plan.json'),'utf8'));
const root=process.cwd();
// ALL installed SDK/UI/protocol members, frozen NPM intake, canonical packet
// bindings BEFORE the first import of any SDK/manifest/build/package code.
const originals=await loadOriginals({target:plan.target,repoRoot:root,hashes:protectedHashes(),installed: true});
if(JSON.stringify(originals)!==JSON.stringify(plan.sdkTrust))throw Error('Original intake changed since guard');
const {buildApplication}=await import('./build-application.mjs');
const {buildOfflineShell}=await import('@mdbase-dev/sdk/offline-shell/build');
const {validateAppManifest}=await import('@mdbase-dev/connect-protocol/manifest');
const publish=join(output,'publish');await mkdir(publish,{recursive:false});
// Start from tracked static sources, not yesterday's ignored build output.
const paths=execFileSync('git',['ls-files','-z','public'],{encoding:'utf8'}).split('\0').filter(Boolean);
for(const path of paths) {
 const dest=join(publish,path.slice('public/'.length));await mkdir(dirname(dest),{recursive:true});await cp(join(root,path),dest,{errorOnExist:true});
}
await buildApplication({output:publish,originals,env:{JOURNAL_ENVIRONMENT:plan.target,JOURNAL_ORIGIN:plan.origin}});
// Retain the unused legacy compatibility loader's transitive asset as well;
// use the exact original browser member, never the LAB compatibility build.
const browser=await readFile(join(publish,'sdk/browser/mdbase-sdk.min.js'));
const asset={sourceCommit:originals.sdkSource,sha256:createHash('sha256').update(browser).digest('hex'),integrity:'sha384-'+createHash('sha384').update(browser).digest('base64'),url:'./browser/mdbase-sdk.min.js'};
await writeFile(join(publish,'sdk/pin.mjs'),'export const SDK_ASSET = Object.freeze('+JSON.stringify(asset)+');\n');
const manifest=JSON.parse(await readFile(join(publish,'.well-known/mdbase-app.json'),'utf8'));
if(!validateAppManifest(manifest,{allowLocal:false}).valid)throw Error('Canonical strict target manifest failed');
await writeFile(join(publish,'_headers'),headersPolicy);await writeFile(join(publish,'_redirects'),redirectsPolicy);
await buildOfflineShell({directory:publish});
// Final inventory is AFTER offline shell, including every dot/underscore byte.
await writeFile(join(output,'inventory.json'),JSON.stringify(await publicationInventory(publish,plan),null,2));
