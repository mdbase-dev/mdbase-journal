import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifiedArchive } from '../scripts/lib/npm-provenance.mjs';
import { originalMembers } from '../scripts/lib/native-originals.mjs';
import { productionIdentity, qualifySdkArchive, repin } from '../scripts/sdk-repin.mjs';

test('real production beta.149 authenticates but cannot enter the retained native-original contract', { skip: process.env.JOURNAL_TEST_REAL_SDK !== '1' }, async context => {
  const release = 'v0.1.0-beta.149';
  const execute = (...args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', timeout: 60_000 }).trim();
  const record = JSON.parse(execute('gh', 'api', 'repos/mdbase-dev/mdbase-cloud-ops/contents/render/release.env?ref=main'));
  const commit = productionIdentity(Buffer.from(record.content, 'base64').toString('utf8'), release,
    execute('git', 'ls-remote', 'https://github.com/mdbase-dev/mdbase-connect.git', `refs/tags/${release}^{}`).split(/\s/)[0]);
  const archive = await verifiedArchive('@mdbase-dev/sdk', release.slice(1), release, commit);
  const directory = mkdtempSync(join(tmpdir(), 'journal-real-sdk-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const archivePath = join(directory, 'sdk-0.1.0-beta.149.tgz');
  writeFileSync(archivePath, archive.bytes);
  const members = originalMembers(archivePath);
  assert.ok(members.some(member => member.path === 'dist/native/provenance.json'));
  const provenance = JSON.parse(execute('tar', '-xOzf', archivePath, 'package/dist/native/provenance.json'));
  assert.equal(provenance.schema, 'mdbase-sdk/npm-publication/1');
  assert.equal(provenance.runtime.source.repository, 'mdbase-dev/mdbase-connect');
  const protocol = JSON.parse(execute('tar', '-xOzf', archivePath, 'package/node_modules/@mdbase-dev/connect-protocol/package.json'));
  assert.equal(protocol.version, '0.1.0-beta.145');
  await assert.rejects(qualifySdkArchive(archive), /Native SDK intake blocked:.*does not match the qualified production original/);
  const paths = ['package.json', 'package-lock.json'];
  const before = paths.map(path => readFileSync(path));
  const overrides = { CONNECT_RELEASE: release, GITHUB_OUTPUT: join(directory, 'output'), REPIN_INTEGRITIES: join(directory, 'integrities.json') };
  const saved = Object.fromEntries(Object.keys(overrides).map(name => [name, process.env[name]]));
  context.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  Object.assign(process.env, overrides);
  await assert.rejects(repin(undefined, undefined, async () => archive), /Native SDK intake blocked:/);
  paths.forEach((path, index) => assert.deepEqual(readFileSync(path), before[index]));
  assert.equal(existsSync(process.env.GITHUB_OUTPUT), false);
  assert.equal(existsSync(process.env.REPIN_INTEGRITIES), false);
  context.diagnostic(JSON.stringify({ release, commit, sha256: createHash('sha256').update(archive.bytes).digest('hex'), integrity: archive.integrity,
    provenanceSchema: provenance.schema, runtimeRepository: provenance.runtime.source.repository, bundledProtocol: protocol.version,
    result: 'authenticated registry bytes; native intake refused; no manifest, lock, output or integrity writes' }));
});
