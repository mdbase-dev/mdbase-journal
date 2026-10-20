// OFF-CI NX-TRUST/TNAPP authenticate once. CI binds original bytes only.
// Canonical producer packet: nx-tnapp-public-target-sdk-verification-inputs.md.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest(algorithm === 'sha512' ? 'base64' : 'hex');
const requireValue = (ok, reason) => { if (!ok) throw Error(`Refusing native originals: ${reason}`); };
const equal = (a, b, reason) => requireValue(isDeepStrictEqual(a, b), reason);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const packages = { sdk: '@mdbase-dev/sdk', ui: '@mdbase-dev/ui', protocol: '@mdbase-dev/connect-protocol' };
export const digestNames = ['NATIVE_SDK_SHA256', 'NATIVE_UI_SHA256', 'NATIVE_PROTOCOL_SHA256', 'NATIVE_TRUST_ASSET_SHA256'];
export function protectedHashes(env = process.env) {
  const hashes = Object.fromEntries(digestNames.map(name => [name, env[name]]));
  requireValue(Object.values(hashes).every(value => /^[a-f0-9]{64}$/.test(value ?? '')), 'four protected per-environment original SHA256 values required');
  return hashes;
}
async function regular(root, name) {
  requireValue(typeof name === 'string' && name.split('/').every(p => /^[\w.@~-]+$/.test(p) && p !== '.' && p !== '..'), 'unsafe input path');
  const path = join(root, name);
  requireValue((await lstat(path)).isFile() && await realpath(path) === path, 'input symlink/nonregular file');
  return readFile(path);
}
export function originalMembers(archive) {
  return JSON.parse(execFileSync('python3', ['-B', fileURLToPath(new URL('./archive-members.py', import.meta.url)), archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
}
function memberBytes(archive, members, path) {
  requireValue(members.some(m => m.path === path), `missing original ${path}`);
  return execFileSync('tar', ['-xOzf', archive, `package/${path}`], { maxBuffer: 128 * 1024 * 1024 });
}
export async function installedMembers(root) {
  const out = [];
  async function walk(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      const path = join(directory, name), rel = prefix + name, stat = await lstat(path);
      requireValue(!stat.isSymbolicLink(), `installed member symlink ${rel}`);
      if (stat.isDirectory()) await walk(path, rel + '/');
      else {
        requireValue(stat.isFile(), `nonregular installed member ${rel}`);
        const bytes = await readFile(path);
        out.push({ path: rel, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  await walk(root);
  return out.sort((a,b) => a.path < b.path ? -1 : 1);
}
function resolutionDependencies(lock, name) { return lock.packages?.[`node_modules/${name}`]?.dependencies; }
export function assertFrozenNpm({pkg,lock,name,pin,sri,original}) {
  requireValue(lock.lockfileVersion===3,'frozen npm lock v3 required');
  equal(lock.packages?.['']?.dependencies,pkg.dependencies,'frozen npm root dependency pins');
  equal(lock.packages?.['']?.devDependencies??{},pkg.devDependencies??{},'frozen npm root dev pins');
  const resolution=lock.packages?.[`node_modules/${name}`];
  requireValue(resolution?.integrity===sri && resolution?.resolved===pin && !resolution.link,`${name} frozen archive integrity mismatch`);
  requireValue(original.name===name && original.version===resolution.version,'frozen npm original name/version mismatch');
  equal(resolution.dependencies??{},original.dependencies??{},'frozen npm original dependency pins');
}
export function assertBundledProtocol({members,protocolMembers,lock,protocolPackage,sdkPackage,protocol}) {
  const bundled=members.filter(m=>m.path.startsWith('node_modules/@mdbase-dev/connect-protocol/')).map(m=>({...m,path:m.path.slice('node_modules/@mdbase-dev/connect-protocol/'.length)}));
  equal(bundled,protocolMembers,'SDK bundled protocol differs from pinned original');
  const nested=lock.packages?.['node_modules/@mdbase-dev/sdk/node_modules/@mdbase-dev/connect-protocol'];
  requireValue(nested?.inBundle===true && nested.version===protocolPackage.version && !nested.link && !nested.resolved && !nested.integrity,'frozen npm SDK bundled protocol exact version/inBundle required');
  equal(nested.dependencies??{},protocolPackage.dependencies??{},'frozen npm nested protocol dependencies');
  requireValue(sdkPackage.dependencies?.[packages.protocol]===`file:vendor/${protocol.path.split('/').at(-1)}` && resolutionDependencies(lock,packages.sdk)?.[packages.protocol]===sdkPackage.dependencies[packages.protocol],'SDK protocol dependency original file pin');
}
export function assertNativeOriginalFacts(facts,provenance) {
  requireValue(provenance.runtime.source?.repository === 'mdbase-dev/mdbase-next' && /^[a-f0-9]{40}$/.test(provenance.runtime.source.commit??'') && facts.nativeSource === provenance.runtime.source.commit && facts.nativeSha256 === provenance.runtime.sha256 && facts.nativeBytes === provenance.runtime.bytes && provenance.runtime.bytes <= provenance.runtime.maxBytes && provenance.sqlite.bytes <= provenance.sqlite.maxBytes, 'native source/budget facts');
  requireValue([provenance.runtime.bytes,provenance.runtime.maxBytes,provenance.sqlite.bytes,provenance.sqlite.maxBytes,provenance.sqlite.initializer.bytes].every(n=>Number.isSafeInteger(n)&&n>0) &&
    typeof provenance.runtime.qualification==='string' && provenance.runtime.qualification.length>0 &&
    typeof provenance.sqlite.qualification==='string' && provenance.sqlite.qualification.length>0 &&
    provenance.sqlite.package==='@sqlite.org/sqlite-wasm' && typeof provenance.sqlite.version==='string' && provenance.sqlite.version.length>0,'canonical native/SQLite provenance metadata (not authentication)');
}
export function assertProtocolFacts(facts,protocol) {
  const dependencies=facts.dependencies?.filter(d=>d.name===packages.protocol);
  requireValue(dependencies?.length===1,'unambiguous protocol facts');
  const dep = dependencies[0];
  requireValue(dep && dep.file === protocol.path && dep.bytes === protocol.bytes && dep.sha256 === protocol.sha256 && dep.sri === protocol.sri, 'bundled protocol original custody');
}
export async function loadOriginals({ target, repoRoot, hashes, installed = false }) {
  requireValue(['staging','production'].includes(target), 'unknown target; no LAB retarget');
  protectedHashes(hashes);
  repoRoot = await realpath(repoRoot);
  const app = repoRoot;
  const pkg = await json(join(app, 'package.json'));
  const lockBytes = await regular(repoRoot, 'package-lock.json');
  const lock = JSON.parse(lockBytes);
  requireValue(lock.lockfileVersion === 3, 'frozen npm lock v3 required');
  equal(lock.packages?.['']?.dependencies, pkg.dependencies, 'frozen npm root dependency pins');
  equal(lock.packages?.['']?.devDependencies ?? {}, pkg.devDependencies ?? {}, 'frozen npm root dev pins');
  const archives = {}, originals = {};
  for (const [key, name] of Object.entries(packages)) {
    const pin = pkg.dependencies?.[name];
    requireValue(typeof pin === 'string' && pin.startsWith('file:'), `${name} must remain a file pin`);
    const path = relative(repoRoot, resolve(app, pin.slice(5)));
    requireValue(/^vendor\/[A-Za-z0-9._-]+\.tgz$/.test(path), 'original archive must keep its vendor basename');
    const bytes = await regular(repoRoot, path);
    const sha256 = hash(bytes), sri = `sha512-${hash(bytes, 'sha512')}`;
    equal(sha256, hashes[`NATIVE_${key.toUpperCase()}_SHA256`], `${key} protected archive hash mismatch`);
    // Parse NPM's actual frozen lock, never execute package code to inspect it.
    const resolution = lock.packages?.[`node_modules/${name}`];
    requireValue(resolution?.integrity === sri && resolution?.resolved === pin && !resolution.link, `${name} frozen archive integrity mismatch`);
    const members = originalMembers(join(repoRoot, path));
    assertFrozenNpm({pkg,lock,name,pin,sri,original:JSON.parse(memberBytes(join(repoRoot,path),members,'package.json'))});
    if (installed) {
      const installedRoot = await realpath(join(app, 'node_modules', name));
      requireValue(!relative(repoRoot, installedRoot).startsWith('..'), 'installed package outside checkout');
      equal(await installedMembers(installedRoot), members, `${name} ALL installed original members differ`);
    }
    archives[key] = { path, bytes: bytes.length, sha256, sri, members: members.length };
    originals[key] = members;
  }
  const protocol=archives.protocol,sdk=archives.sdk,members=originals.sdk,sdkPath=join(repoRoot,sdk.path);
  assertBundledProtocol({members,protocolMembers:originals.protocol,lock,
    protocolPackage:JSON.parse(memberBytes(join(repoRoot,protocol.path),originals.protocol,'package.json')),
    sdkPackage:JSON.parse(memberBytes(sdkPath,members,'package.json')),protocol});
  const sdkFiles={};
  for(const path of ['dist/native/provenance.json','dist/application/packaged-trust.js','dist/native/runtime.wasm','dist/native/sqlite3.wasm','dist/native/sqlite3.js'])
    sdkFiles[path]=memberBytes(sdkPath,members,path);
  // Delivery files are source-reviewed exact originals, not an approval descriptor.
  const packetFiles={};
  for(const path of ['artifact-facts.json','members.json','provenance.json',`next-trust/${target}-context.json`,`next-trust/${target}.json`,'build-receipt.json','release-trust-bundle.json','release-trust-bundle.sigstore.json','image-release-bundle.json','image-release-bundle.sigstore.json'])
    packetFiles[path]=await regular(repoRoot,`vendor/native-release/${target}/${path}`);
  return bindCanonicalPacket({target,hashes,archives,members,packetFiles,sdkFiles,lockSha256:hash(lockBytes)});
}
// Pure canonical byte-binding checks; loadOriginals always supplies verified archive
// members/source files above. Not an SDK auth authority or alternate public tool.
export async function bindCanonicalPacket({target,hashes,archives,members,packetFiles,sdkFiles,lockSha256}) {
  requireValue(['staging','production'].includes(target),'unknown target; no LAB retarget');
  protectedHashes(hashes);
  const packet=`vendor/native-release/${target}`;
  const packetFile=async path=>{requireValue(Buffer.isBuffer(packetFiles[path]),'missing original packet '+path);return packetFiles[path];};
  const factsBytes = await packetFile('artifact-facts.json'), facts = JSON.parse(factsBytes);
  const sdk = archives.sdk;
  const membersBytes=await packetFile('members.json');
  equal(JSON.parse(membersBytes), members, 'producer complete SDK inventory mismatch');
  requireValue(facts.archive === sdk.path.split('/').at(-1) && facts.bytes === sdk.bytes && facts.sha256 === sdk.sha256 && facts.sri === sdk.sri && facts.members === sdk.members && /^[a-f0-9]{40}$/.test(facts.source) && /^[a-f0-9]{40}$/.test(facts.sourceTree), 'canonical artifact facts mismatch');
  const provenanceBytes = await packetFile('provenance.json');
  requireValue(provenanceBytes.equals(sdkFiles['dist/native/provenance.json']), 'provenance not byte-identical to original');
  const provenance = JSON.parse(provenanceBytes);
  requireValue(provenance.schema === 'mdbn-sdk/application-assets/1' && provenance.environment === target && provenance.trust?.environment === target, 'provenance target mismatch');
  equal(facts.environment,target,'canonical facts environment');
  for(const key of ['trust','handoff','verifier'])equal(facts[key],provenance[key],`canonical facts ${key} differs from original provenance`);
  const contextBytes = await packetFile(`next-trust/${target}-context.json`), context = JSON.parse(contextBytes);
  const asset = await packetFile(`next-trust/${target}.json`);
  const receiptBytes = await packetFile('build-receipt.json'), receipt = JSON.parse(receiptBytes);
  const cp = target === 'staging' ? 'https://connect-staging.mdbase.dev' : 'https://connect.mdbase.dev';
  const t = provenance.trust, c = context.context, h = provenance.handoff, v = provenance.verifier;
  requireValue(context.schema_version === 1 && context.kind === 'mdbase-next-build-trust-context', 'canonical context schema');
  requireValue(c.environment === target && c.control_plane_origin === cp && c.source?.repository === 'mdbase-dev/mdbase-connect' && /^[a-f0-9]{40}$/.test(c.source.commit) && typeof c.source.version === 'string' && c.source.version.length > 0, 'target CP/source context mismatch');
  const log = new URL(c.log_origin);
  requireValue(log.protocol === 'https:' && log.origin === c.log_origin && !log.username && !log.password, 'exact authenticated log origin');
  equal([hash(asset), t.sha256, c.sha256], Array(3).fill(hashes.NATIVE_TRUST_ASSET_SHA256), 'RAW signed asset hash differs (not module/context/receipt hash)');
  equal([t.cpOrigin,t.logOrigin,t.sourceCommit,t.sourceVersion], [cp,c.log_origin,c.source.commit,c.source.version], 'trust context bindings');
  requireValue(h.contextSha256 === hash(contextBytes) && h.receiptSha256 === hash(receiptBytes) && h.asset_length === asset.length && h.asset_path === `next-trust/${target}.json`, 'handoff original byte binding');
  for (const [key,value] of Object.entries(context.provenance)) equal(h[key], value, `context provenance ${key}`);
  const proofs = {};
  for (const filename of ['release-trust-bundle.json','release-trust-bundle.sigstore.json','image-release-bundle.json','image-release-bundle.sigstore.json']) {
    proofs[filename] = await packetFile(filename);
    equal(hash(proofs[filename]), h.proof_sha256?.[filename], `original proof ${filename}`);
  }
  const inventory = JSON.parse(proofs['release-trust-bundle.json']), image = JSON.parse(proofs['image-release-bundle.json']);
  const a = inventory.trustAssets?.[0], b = inventory.imageBundle;
  const sourceMatches = value => value?.repository === c.source.repository && value?.commit === c.source.commit && value?.version === c.source.version;
  requireValue(inventory.schemaVersion === 1 && inventory.kind === 'mdbase-release-trust-bundle' && sourceMatches(inventory) && sourceMatches(image) && inventory.trustAssets?.length === 1, 'canonical authenticated release inventory identity');
  requireValue(a.path === h.asset_path && a.length === asset.length && a.sha256 === hashes.NATIVE_TRUST_ASSET_SHA256 && a.environment === target && a.controlPlaneOrigin === cp && a.logOrigin === c.log_origin && sourceMatches(a.source), 'release inventory RAW signed trust asset binding');
  requireValue(b?.path === 'image-release-bundle.json' && b.length === proofs[b.path].length && b.sha256 === h.proof_sha256[b.path] && b.publicationRunId === h.image_publication.run_id && b.publicationRunAttempt === h.image_publication.run_attempt, 'image inventory binding');
  equal([image.publication?.runId,image.publication?.runAttempt,inventory.publication?.runId,inventory.publication?.runAttempt,inventory.publication?.publisherCommit,inventory.qualification?.runId,inventory.qualification?.runAttempt], [h.image_publication.run_id,h.image_publication.run_attempt,h.trust_publication.run_id,h.trust_publication.run_attempt,h.trust_publication.publisher_commit,h.publisher_qualification.run_id,h.publisher_qualification.run_attempt], 'original publication/qualification bindings');
  for (const key of ['image_publication','trust_publication','publisher_qualification']) requireValue(Number.isSafeInteger(h[key]?.run_id) && h[key].run_id > 0 && Number.isSafeInteger(h[key]?.run_attempt) && h[key].run_attempt > 0, `canonical ${key} identity`);
  requireValue(/^[a-f0-9]{40}$/.test(h.trust_publication.publisher_commit), 'publisher commit identity');
  requireValue(receipt.schema === 'mdbn-sdk/application-build/1' && receipt.contextSha256 === hash(contextBytes) && receipt.verifierSha256 === v.sha256 && receipt.verifierSourceCommit === v.source && v.clockOverride === false && /^[a-f0-9]{40}$/.test(v.source) && /^[a-f0-9]{64}$/.test(v.sha256), 'frozen receipt/verifier binding');
  const module = sdkFiles['dist/application/packaged-trust.js'];
  equal(hash(module),facts.packagedTrustModuleSha256,'canonical facts original compiled module digest (not asset digest)');
  const literal = /const metadata = (\{[^\n]+\});/.exec(module.toString());
  requireValue(literal, 'unknown canonical packaged trust literal');
  const release = JSON.parse(literal[1]);
  equal([release.schema,release.environment,release.cpOrigin,release.logOrigin,release.assetSha256,release.source], ['mdbn-app-trust/release/1',target,cp,c.log_origin,hash(asset),c.source], 'compiled appReleaseTrust asset/context binding');
  const nativeAssets = {};
  for (const [name,pin] of [['runtime.wasm',provenance.runtime],['sqlite3.wasm',provenance.sqlite],['sqlite3.js',provenance.sqlite.initializer]]) {
    const bytes = sdkFiles[`dist/native/${name}`];
    requireValue(pin.sha256 === hash(bytes) && pin.bytes === bytes.length, `${name} provenance mismatch`);
    nativeAssets[name] = { sha256:hash(bytes), bytes:bytes.length };
  }
  assertNativeOriginalFacts(facts,provenance);
  assertProtocolFacts(facts,archives.protocol);
  return { environment:target, sdkSource:facts.source, sdkSourceTree:facts.sourceTree, release, nativeAssets, archives, lockSha256, protectedHashes:hashes,
    facts,provenance,context,receipt,
    packet: { path:packet, factsSha256:hash(factsBytes), membersSha256:hash(membersBytes), contextSha256:hash(contextBytes), receiptSha256:hash(receiptBytes), provenanceSha256:hash(provenanceBytes), proofSha256:Object.fromEntries(Object.entries(proofs).map(([name,bytes])=>[name,hash(bytes)])) },
    trustModuleSha256:hash(module), appOrigin:target === 'staging' ? 'https://staging.mdbase-journal.pages.dev' : 'https://journal.mdbase.dev',
    connectOrigin:cp, editorOrigin:target === 'staging' ? 'https://editor-staging.mdbase.dev' : 'https://editor.mdbase.dev' };
}
