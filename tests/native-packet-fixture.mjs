// In-memory UNIT fixture only. No SDK/archive build, tgz, signature or auth claim.
import { createHash } from 'node:crypto';
export const digest=(b,alg='sha256')=>createHash(alg).update(b).digest(alg==='sha512'?'base64':'hex');
export function packetFixture(target='staging') {
 const source={repository:'mdbase-dev/mdbase-connect',commit:'a'.repeat(40),version:'fixture-only'};
 const cp=target==='staging'?'https://connect-staging.mdbase.dev':'https://connect.mdbase.dev';
 const packetFiles={},sdkFiles={};
 const put=(name,value)=>packetFiles[name]=Buffer.from(typeof value==='string'?value:JSON.stringify(value));
 const asset=put(`next-trust/${target}.json`,'{"signed":"UNIT fixture, NOT authenticated"}'),assetHash=digest(asset);
 const image={...source,publication:{runId:1,runAttempt:1}},imageBytes=JSON.stringify(image);
 const inventory={schemaVersion:1,kind:'mdbase-release-trust-bundle',...source,trustAssets:[{path:`next-trust/${target}.json`,length:asset.length,sha256:assetHash,environment:target,controlPlaneOrigin:cp,logOrigin:'https://log.fixture',source}],imageBundle:{path:'image-release-bundle.json',length:Buffer.byteLength(imageBytes),sha256:digest(imageBytes),publicationRunId:1,publicationRunAttempt:1},publication:{runId:2,runAttempt:1,publisherCommit:source.commit},qualification:{runId:3,runAttempt:1}};
 const handoff={asset_path:`next-trust/${target}.json`,asset_length:asset.length,proof_sha256:{},image_publication:{run_id:1,run_attempt:1},trust_publication:{run_id:2,run_attempt:1,publisher_commit:source.commit},publisher_qualification:{run_id:3,run_attempt:1}};
 for(const [name,body] of Object.entries({'release-trust-bundle.json':inventory,'release-trust-bundle.sigstore.json':'{}','image-release-bundle.json':imageBytes,'image-release-bundle.sigstore.json':'{}'}))handoff.proof_sha256[name]=digest(put(name,body));
 const context={schema_version:1,kind:'mdbase-next-build-trust-context',context:{sha256:assetHash,environment:target,control_plane_origin:cp,log_origin:'https://log.fixture',source},provenance:handoff};
 const contextSha256=digest(put(`next-trust/${target}-context.json`,context));
 const verifierSha256='b'.repeat(64),receipt={schema:'mdbn-sdk/application-build/1',contextSha256,verifierSha256,verifierSourceCommit:source.commit};
 const receiptSha256=digest(put('build-receipt.json',receipt));
 const assets={};
 for(const name of ['runtime.wasm','sqlite3.wasm','sqlite3.js']) {
  const bytes=Buffer.from('UNIT '+name);sdkFiles['dist/native/'+name]=bytes;assets[name]={sha256:digest(bytes),bytes:bytes.length};
 }
 const provenance={schema:'mdbn-sdk/application-assets/1',environment:target,trust:{environment:target,cpOrigin:cp,logOrigin:'https://log.fixture',sha256:assetHash,sourceCommit:source.commit,sourceVersion:source.version},handoff:{...handoff,contextSha256,receiptSha256},verifier:{source:source.commit,sha256:verifierSha256,clockOverride:false},runtime:{...assets['runtime.wasm'],maxBytes:99,source:{repository:'mdbase-dev/mdbase-next',commit:source.commit},qualification:'UNIT fixture only'},sqlite:{...assets['sqlite3.wasm'],maxBytes:99,initializer:assets['sqlite3.js'],package:'@sqlite.org/sqlite-wasm',version:'fixture',qualification:'UNIT fixture only'}};
 sdkFiles['dist/native/provenance.json']=put('provenance.json',provenance);
 const release={schema:'mdbn-app-trust/release/1',environment:target,cpOrigin:cp,logOrigin:'https://log.fixture',assetSha256:assetHash,source};
 sdkFiles['dist/application/packaged-trust.js']=Buffer.from('const metadata = '+JSON.stringify(release)+';\n');
 const members=Object.entries(sdkFiles).map(([path,bytes])=>({path,bytes:bytes.length,sha256:digest(bytes)})).sort((a,b)=>a.path<b.path?-1:1);
 const archives=Object.fromEntries(['sdk','ui','protocol'].map((key,i)=>[key,{path:`vendor/${key}.tgz`,bytes:123,sha256:String(i).repeat(64),sri:'sha512-fixture',members:key==='sdk'?members.length:2}]));
 const protocol=archives.protocol;
 put('artifact-facts.json',{environment:target,trust:provenance.trust,handoff:provenance.handoff,verifier:provenance.verifier,packagedTrustModuleSha256:digest(sdkFiles['dist/application/packaged-trust.js']),source:source.commit,sourceTree:source.commit,archive:'sdk.tgz',bytes:123,sha256:archives.sdk.sha256,sri:archives.sdk.sri,members:members.length,nativeSource:source.commit,nativeSha256:provenance.runtime.sha256,nativeBytes:provenance.runtime.bytes,dependencies:[{name:'@mdbase-dev/connect-protocol',file:'vendor/protocol.tgz',bytes:protocol.bytes,sha256:protocol.sha256,sri:protocol.sri}]});
 put('members.json',members);
 const hashes={NATIVE_SDK_SHA256:archives.sdk.sha256,NATIVE_UI_SHA256:archives.ui.sha256,NATIVE_PROTOCOL_SHA256:protocol.sha256,NATIVE_TRUST_ASSET_SHA256:assetHash};
 return {target,hashes,archives,members,packetFiles,sdkFiles,lockSha256:'d'.repeat(64)};
}
