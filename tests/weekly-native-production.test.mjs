import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertAppCommits, assertRepinContent, assertRepinFiles, completedMainRun, handoff, mergedTrainPull } from '../scripts/weekly-native-production.mjs';

const repository = 'mdbase-dev/mdbase-journal';
const sha = 'a'.repeat(40);
const old = 'b'.repeat(40);
const appSlug = 'release-automation';
const version = '0.1.0-beta.149';
const head = 'c'.repeat(40);
const contentFixture = () => {
  const manifest = { dependencies: { '@mdbase-dev/sdk': 'file:vendor/sdk.tgz' }, devDependencies: { '@mdbase-dev/connect-dev': '0.1.0-beta.123' }, scripts: { test: 'node tests.mjs' }, overrides: { react: '19.2.8' } };
  const lock = { lockfileVersion: 3, packages: { '': structuredClone(manifest), 'node_modules/@mdbase-dev/connect-dev': { version: '0.1.0-beta.123', integrity: 'sha512-old', resolved: 'https://registry.npmjs.org/connect-dev-old.tgz' }, 'node_modules/react': {version: '19.2.8'} } };
  const before = {manifest, lock}, after = structuredClone(before);
  after.manifest.devDependencies['@mdbase-dev/connect-dev'] = version;
  after.lock.packages[''].devDependencies['@mdbase-dev/connect-dev'] = version;
  after.lock.packages['node_modules/@mdbase-dev/connect-dev'] = {version, integrity: 'sha512-fixture', resolved: 'https://registry.npmjs.org/connect-dev.tgz'};
  return {before, after};
};
const commitFixture = () => ({sha: head, author: {type: 'Bot', login: appSlug+'[bot]', id: 42}, committer: {type: 'Bot', login: appSlug+'[bot]', id: 42}, commit: {author: {name: appSlug+'[bot]',email: '42+'+appSlug+'[bot]@users.noreply.github.com'}, committer: {name: appSlug+'[bot]',email: '42+'+appSlug+'[bot]@users.noreply.github.com'}}});
const env = { GITHUB_REPOSITORY: repository, APP_SLUG: appSlug, GH_TOKEN: 'fixture-only' };
const eventFixture = () => ({
  action: 'completed', repository: { full_name: repository },
  workflow_run: { name: 'CI', path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main',
    head_repository: { full_name: repository }, head_sha: sha, status: 'completed', conclusion: 'success' },
});
const pullFixture = () => ({
  number: 42, commits: 1, merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: sha,
  title: 'Pin production Connect packages to v0.1.0-beta.149',
  base: { ref: 'main', repo: { full_name: repository } },
  head: { sha: head, ref: 'automation/sdk-repin', repo: { full_name: repository } },
  user: { id: 42, type: 'Bot', login: `${appSlug}[bot]` },
});

function executionFixture({ pull = pullFixture(), main = sha, release = old, existing = '', fail, files = 'package.json\npackage-lock.json', moveMain = false, commits = [commitFixture()], content = contentFixture() } = {}) {
  const calls = [];
  let mainReads = 0;
  const execute = (command, args) => {
    calls.push([command, ...args]);
    const endpoint = args[1];
    if (command === 'gh') {
      if (endpoint.endsWith('/pulls/42/commits?per_page=100')) return JSON.stringify(commits);
      if (endpoint.includes('/commits/')) return JSON.stringify(pull ? [{ number: 42 }] : []);
      if (endpoint.endsWith('/pulls/42')) return JSON.stringify(pull);
      if (endpoint.endsWith('/heads/main')) {
        mainReads++;
        return JSON.stringify({ object: { type: 'commit', sha: moveMain && mainReads > 1 ? old : main } });
      }
      if (endpoint.endsWith('/heads/release/native-production')) return JSON.stringify({ object: { type: 'commit', sha: release } });
    }
    if (command === 'git') {
      if (args[0] === fail) throw new Error('fixture refusal');
      if (args[0] === 'rev-parse') return sha;
      if (args[0] === 'show') return JSON.stringify(content[args[1].includes('^:') ? 'before' : 'after'][args[1].endsWith(':package.json') ? 'manifest' : 'lock']);
      if (args[0] === 'diff') return args[1].startsWith('--diff-filter') || args[1] === '--summary' ? '' : files;
      if (args[0] === 'ls-remote') return args[1].startsWith('https:') ? sha+'\trefs/tags/v'+version+'^{}' : existing;
      if (['status', 'merge-base', 'fetch', 'push'].includes(args[0])) return '';
    }
    throw new Error(`Unexpected fixture command: ${command} ${args.join(' ')}`);
  };
  return { execute, calls, verifyPackage: async (name, version) => ({name, version, integrity: 'sha512-fixture', tarball: 'https://registry.npmjs.org/connect-dev.tgz'}) };
}

test('only successful same-repository main push CI is a publication candidate', () => {
  assert.equal(completedMainRun(eventFixture(), repository), sha);
  for (const [field, value] of Object.entries({ name: 'Other', path: '.github/workflows/fake.yml', event: 'pull_request',
    head_branch: 'feature', head_sha: 'not-a-sha', conclusion: 'failure', status: 'in_progress', head_repository: { full_name: 'fork/journal' } })) {
    const event = eventFixture();
    event.workflow_run[field] = value;
    assert.throws(() => completedMainRun(event, repository));
  }
});

test('merged commit, base, App identity and single train branch all bind the PR', () => {
  assert.equal(mergedTrainPull([pullFixture()], repository, sha, appSlug).number, 42);
  for (const mutate of [pull => { pull.merged_at = null; }, pull => { pull.merge_commit_sha = old; },
    pull => { pull.base.ref = 'other'; }, pull => { pull.head.ref = 'other'; },
    pull => { pull.head.repo.full_name = 'fork/journal'; }, pull => { pull.user.type = 'User'; }]) {
    const pull = pullFixture(); mutate(pull);
    assert.equal(mergedTrainPull([pull], repository, sha, appSlug), null);
  }
  const impostor = pullFixture(); impostor.user.login = 'other[bot]';
  assert.throws(() => mergedTrainPull([impostor], repository, sha, appSlug), /release automation App/);
  assert.throws(() => mergedTrainPull([pullFixture(), pullFixture()], repository, sha, appSlug), /Ambiguous/);
});

test('only npm manifest/lock changes can reach the train handoff', () => {
  assertRepinFiles(['package.json', 'package-lock.json']);
  assert.throws(() => assertRepinFiles(['package.json', 'package-lock.json', 'tools/native-publisher/package.json']));
  for (const files of [['package.json'], ['package-lock.json'], ['package.json', 'package-lock.json', '.github/workflows/native-journal.yml']]) {
    assert.throws(() => assertRepinFiles(files));
  }
});

test('ordinary main changes do not request an App token or mutate refs', async () => {
  const fixture = executionFixture({ pull: null });
  assert.equal(await handoff({ event: eventFixture(), env, ...fixture }), false);
  assert.ok(fixture.calls.every(call => call[0] === 'gh'));
});

test('candidate inspection stays read-only; publication uses one atomic non-forced push', async () => {
  const candidate = executionFixture();
  assert.equal(await handoff({ event: eventFixture(), env, ...candidate }), true);
  assert.ok(!candidate.calls.some(call => ['push', 'fetch'].includes(call[1])));
  const fixture = executionFixture();
  assert.equal(await handoff({ event: eventFixture(), env, ...fixture, publish: true }), true);
  assert.deepEqual(fixture.calls.filter(call => call[1] === 'push'), [['git', 'push', '--atomic', 'origin',
    `${sha}:refs/heads/release/native-production`, `${sha}:refs/tags/native-publish-production-${sha}`]]);
  assert.ok(fixture.calls.filter(call => call[1] === 'merge-base').length === 2);
});

test('stale, dirty, non-descendant and incompatible candidates cannot push', async () => {
  for (const options of [{ main: old }, { moveMain: true }, { fail: 'merge-base' },
    { files: 'package.json\npackage-lock.json\nscripts/native-publisher.mjs' }, { fail: 'fetch' }]) {
    const fixture = executionFixture(options);
    await assert.rejects(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }));
    assert.ok(!fixture.calls.some(call => call[1] === 'push'));
  }
});

test('existing exact tag is observed, never updated or replayed after an unknown publisher result', async () => {
  const fixture = executionFixture({ existing: `${sha}\trefs/tags/native-publish-production-${sha}`, release: sha });
  assert.equal(await handoff({ event: eventFixture(), env, ...fixture, publish: true }), true);
  assert.ok(!fixture.calls.some(call => call[1] === 'push'));
  for (const options of [{ existing: `${old}\trefs/tags/native-publish-production-${sha}` },
    { existing: `${sha}\trefs/tags/native-publish-production-${sha}` }]) {
    const invalid = executionFixture(options);
    await assert.rejects(() => handoff({ event: eventFixture(), env, ...invalid, publish: true }));
    assert.ok(!invalid.calls.some(call => call[1] === 'push'));
  }
});

test('a failed atomic push is not automatically retried', async () => {
  const fixture = executionFixture({ fail: 'push' });
  await assert.rejects(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }), /fixture refusal/);
  assert.equal(fixture.calls.filter(call => call[1] === 'push').length, 1);
});

test('a human commit on the App PR branch cannot reach any ref mutation', async () => {
  for (const role of ['author', 'committer']) {
    const human = commitFixture();
    human[role] = { type: 'User', login: 'human', id: 7 };
    const pull = pullFixture(); pull.commits = 2;
    const appCommit = commitFixture();
    const fixture = executionFixture({ pull, commits: [human, appCommit] });
    await assert.rejects(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }), /not the release App/);
    assert.ok(!fixture.calls.some(call => ['fetch', 'push'].includes(call[1])));
  }
});

test('all PR commit metadata and the complete history must bind to the release App', () => {
  assertAppCommits([commitFixture()], pullFixture());
  const wrongEmail = commitFixture(); wrongEmail.commit.committer.email = 'human@example.test';
  assert.throws(() => assertAppCommits([wrongEmail], pullFixture()), /email mismatch/);
  assert.throws(() => assertAppCommits([], pullFixture()), /Incomplete/);
  const pull = pullFixture(); pull.commits = 101;
  assert.throws(() => assertAppCommits([], pull), /oversized/);
});

test('regenerated repin admits only mdbase pin values and their exact lock scope', () => {
  const fixture = contentFixture();
  assert.deepEqual(assertRepinContent(fixture.before, fixture.after, version), ['@mdbase-dev/connect-dev']);
  for (const mutate of [
    after => { after.manifest.scripts.build = 'curl attacker'; },
    after => { after.manifest.overrides.react = 'npm:attacker'; },
    after => { after.manifest.dependencies['@mdbase-dev/sdk'] = version; },
    after => { after.manifest.dependencies.attacker = '1.0.0'; },
    after => { after.lock.packages['node_modules/react'].version = '0.0.0'; },
    after => { after.lock.packages['node_modules/new-package'] = {version: '1.0.0'}; },
    after => { after.lock.packages[''].scripts = {postinstall: 'attacker'}; },
  ]) {
    const content = contentFixture(); mutate(content.after);
    assert.throws(() => assertRepinContent(content.before, content.after, version));
  }
});

test('script changes, override changes and a new nested package.json fail before token-authorized push', async () => {
  for (const mutate of [after => { after.manifest.scripts.test = 'attacker'; }, after => { after.manifest.overrides.react = '*'; }]) {
    const content = contentFixture(); mutate(content.after);
    const fixture = executionFixture({ content });
    await assert.rejects(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }), /regenerated pin-only repin/);
    assert.ok(!fixture.calls.some(call => ['fetch', 'push'].includes(call[1])));
  }
  const fixture = executionFixture({ files: 'package.json\npackage-lock.json\nnew/package.json' });
  await assert.rejects(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }), /existing root manifest/);
  assert.ok(!fixture.calls.some(call => ['fetch', 'push'].includes(call[1])));
});

test('even allowed npm lock entries must match authenticated archive resolution', async () => {
  const content = contentFixture();
  content.after.lock.packages['node_modules/@mdbase-dev/connect-dev'].integrity = 'sha512-attacker';
  const fixture = executionFixture({ content });
  await assert.rejects(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }), /Lockfile integrity/);
  assert.ok(!fixture.calls.some(call => ['fetch', 'push'].includes(call[1])));
});

test('CI and handoff retain mandatory validation and the protected tag-only publisher', () => {
  const source = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
  const ci = source('ci.yml');
  for (const command of ['typecheck', 'test:publisher', 'build:ci']) assert.ok(ci.includes(`npm run ${command}`));
  assert.ok(ci.includes('npm test'));
  assert.ok(ci.includes('name: Journal CI'));
  assert.ok(ci.includes('pull_request:') && ci.includes('branches: [main]'));
  assert.ok(!/continue-on-error|secrets\.|environment:/.test(ci));
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.scripts['build:ci'], 'node scripts/native-build.mjs --ci');
  assert.equal(manifest.devDependencies.eslint, undefined);
  assert.equal(manifest.devDependencies['typescript-eslint'], undefined);
  assert.ok(manifest.devDependencies.sigstore);
  assert.ok(ci.includes('NATIVE_SDK_SHA256: e64771a90bed2fb3837d4b65df8930fcd124d3059fcb0bcbaf9d64dbfb148205'));
  assert.ok(!ci.includes('npm run lint'));
  const handoffWorkflow = source('weekly-native-production.yml');
  assert.ok(handoffWorkflow.includes('workflow_run:') && handoffWorkflow.includes('conclusion == \'success\''));
  assert.ok(handoffWorkflow.includes('steps.app.outputs.token'));
  assert.ok(!handoffWorkflow.includes('workflow_dispatch:'));
  const repin = source('sdk-repin.yml');
  assert.ok(repin.includes('npm install --package-lock-only --ignore-scripts'));
  assert.ok(repin.includes('node scripts/sdk-repin.mjs verify-lock'));
  assert.ok(repin.includes('gh pr merge "$pull" --auto --squash'));
  assert.ok(!repin.includes('pnpm'));
  const publisher = source('native-journal.yml');
  for (const guard of ['node scripts/native-publisher.mjs guard', 'node scripts/native-current-head.mjs', 'npm run test:publisher', 'node scripts/native-hosting.mjs']) assert.ok(publisher.includes(guard), guard);
  assert.ok(!publisher.includes('workflow_dispatch:'));
});
