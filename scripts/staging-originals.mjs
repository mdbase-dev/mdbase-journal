// Source-owned LOCAL intake expectations from Co/TNAPP/NXtrust custody.
// Not CI authentication, environment configuration, deployment or production GO.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadOriginals } from './lib/native-originals.mjs';
export const STAGING_HASHES=Object.freeze({
 NATIVE_SDK_SHA256:'c0bc377606df159d03c668923b7626f31459a1750ae0db033bb42789532c7296',
 NATIVE_UI_SHA256:'5e388db28365cf6a966017851ece1c32223ea8b55bc6015d2f1b4113d86a3206',
 NATIVE_PROTOCOL_SHA256:'cd1e15236ab7e25c511a4ba13af6a9df23f4b41715161479bba97b0445e1c138',
 NATIVE_TRUST_ASSET_SHA256:'67e117646c9c26927f0d5a44cbd26f057c318975032e9cd24f24b020150cdbc7'
});
export const STAGING_FACTS_SHA256='d313bb9dc2e291f957a77fa0c05fdff533a4cb79afa8973d63bca75c7897b44c';
export async function loadStagingOriginals({repoRoot=process.cwd(),installed=true}={}) {
 const bytes=await readFile(join(repoRoot,'vendor/native-release/staging/artifact-facts.json'));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),STAGING_FACTS_SHA256,'Independent owner facts digest BEFORE candidate execution');
 const originals=await loadOriginals({target:'staging',repoRoot,hashes:STAGING_HASHES,installed});
 assert.equal(originals.sdkSource,'a3023aee3731dcbf9de19a41918a84cfb3ae7193');
 assert.equal(originals.sdkSourceTree,'c50479b5641c11a2750ec8b9cefdb433e5285d10');
 assert.equal(originals.archives.sdk.bytes,4460029);assert.equal(originals.archives.sdk.members,896);
 assert.equal(originals.archives.ui.bytes,85693);
 assert.deepEqual(originals.release.source,{repository:'mdbase-dev/mdbase-connect',commit:'f45df4598a5bff891de68eec3431ec7744885067',version:'0.1.0-beta.134'});
 assert.equal(originals.release.cpOrigin,'https://connect-staging.mdbase.dev');assert.equal(originals.release.logOrigin,'https://log-staging.mdbase.dev');
 assert.equal(originals.provenance.runtime.source.commit,'725d72b2e43b2b744062e055e43feaeb41838399');
 assert.deepEqual(originals.nativeAssets['runtime.wasm'],{sha256:'6984f87d98e29d9f99c6b07f7728f716d1f7b2e3585a74bcc2046ba259a8afab',bytes:3676583});
 assert.equal(originals.provenance.runtime.maxBytes,3676583);
 assert.equal(originals.provenance.verifier.source,'0e44e1e100c2bba9608c5ac3145d6cdee30fa4e2');
 assert.equal(originals.provenance.verifier.sha256,'4c72bcc8c2ee9c95663ad4e2edfcf7a52aa2743ed7308b5031570a35982af6e4');
 return originals;
}
