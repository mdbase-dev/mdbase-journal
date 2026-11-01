import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertRepinFiles, completedMainRun, handoff, mergedTrainPull } from '../scripts/weekly-native-production.mjs';

const repository = 'mdbase-dev/mdbase-journal';
const sha = 'a'.repeat(40);
const old = 'b'.repeat(40);
const appSlug = 'release-automation';
const env = { GITHUB_REPOSITORY: repository, APP_SLUG: appSlug, GH_TOKEN: 'fixture-only' };
const eventFixture = () => ({
  action: 'completed', repository: { full_name: repository },
  workflow_run: { name: 'CI', path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main',
    head_repository: { full_name: repository }, head_sha: sha, status: 'completed', conclusion: 'success' },
});
const pullFixture = () => ({
  number: 42, merged_at: '2026-11-01T00:00:00Z', merge_commit_sha: sha,
  title: 'Pin production Connect packages to v0.1.0-beta.149',
  base: { ref: 'main', repo: { full_name: repository } },
  head: { ref: 'automation/sdk-repin', repo: { full_name: repository } },
  user: { type: 'Bot', login: `${appSlug}[bot]` },
});

function executionFixture({ pull = pullFixture(), main = sha, release = old, existing = '', fail, files = 'package.json\npackage-lock.json', moveMain = false } = {}) {
  const calls = [];
  let mainReads = 0;
  const execute = (command, args) => {
    calls.push([command, ...args]);
    const endpoint = args[1];
    if (command === 'gh') {
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
      if (args[0] === 'diff') return files;
      if (args[0] === 'ls-remote') return existing;
      if (['status', 'merge-base', 'fetch', 'push'].includes(args[0])) return '';
    }
    throw new Error(`Unexpected fixture command: ${command} ${args.join(' ')}`);
  };
  return { execute, calls };
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
  assertRepinFiles(['package.json', 'tools/native-publisher/package.json', 'package-lock.json']);
  for (const files of [['package.json'], ['package-lock.json'], ['package.json', 'package-lock.json', '.github/workflows/native-journal.yml']]) {
    assert.throws(() => assertRepinFiles(files));
  }
});

test('ordinary main changes do not request an App token or mutate refs', () => {
  const fixture = executionFixture({ pull: null });
  assert.equal(handoff({ event: eventFixture(), env, ...fixture }), false);
  assert.ok(fixture.calls.every(call => call[0] === 'gh'));
});

test('candidate inspection stays read-only; publication uses one atomic non-forced push', () => {
  const candidate = executionFixture();
  assert.equal(handoff({ event: eventFixture(), env, ...candidate }), true);
  assert.ok(!candidate.calls.some(call => ['push', 'fetch'].includes(call[1])));
  const fixture = executionFixture();
  assert.equal(handoff({ event: eventFixture(), env, ...fixture, publish: true }), true);
  assert.deepEqual(fixture.calls.filter(call => call[1] === 'push'), [['git', 'push', '--atomic', 'origin',
    `${sha}:refs/heads/release/native-production`, `${sha}:refs/tags/native-publish-production-${sha}`]]);
  assert.ok(fixture.calls.filter(call => call[1] === 'merge-base').length === 2);
});

test('stale, dirty, non-descendant and incompatible candidates cannot push', () => {
  for (const options of [{ main: old }, { moveMain: true }, { fail: 'merge-base' },
    { files: 'package.json\npackage-lock.json\nscripts/native-publisher.mjs' }, { fail: 'fetch' }]) {
    const fixture = executionFixture(options);
    assert.throws(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }));
    assert.ok(!fixture.calls.some(call => call[1] === 'push'));
  }
});

test('existing exact tag is observed, never updated or replayed after an unknown publisher result', () => {
  const fixture = executionFixture({ existing: `${sha}\trefs/tags/native-publish-production-${sha}`, release: sha });
  assert.equal(handoff({ event: eventFixture(), env, ...fixture, publish: true }), true);
  assert.ok(!fixture.calls.some(call => call[1] === 'push'));
  for (const options of [{ existing: `${old}\trefs/tags/native-publish-production-${sha}` },
    { existing: `${sha}\trefs/tags/native-publish-production-${sha}` }]) {
    const invalid = executionFixture(options);
    assert.throws(() => handoff({ event: eventFixture(), env, ...invalid, publish: true }));
    assert.ok(!invalid.calls.some(call => call[1] === 'push'));
  }
});

test('a failed atomic push is not automatically retried', () => {
  const fixture = executionFixture({ fail: 'push' });
  assert.throws(() => handoff({ event: eventFixture(), env, ...fixture, publish: true }), /fixture refusal/);
  assert.equal(fixture.calls.filter(call => call[1] === 'push').length, 1);
});

test('CI and handoff retain mandatory validation and the protected tag-only publisher', () => {
  const source = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
  const ci = source('ci.yml');
  for (const command of ['lint', 'typecheck', 'test:publisher', 'build']) assert.ok(ci.includes(`npm run ${command}`));
  assert.ok(ci.includes('npm test'));
  assert.ok(ci.includes('name: Journal CI'));
  assert.ok(ci.includes('pull_request:') && ci.includes('branches: [main]'));
  assert.ok(!/continue-on-error|secrets\.|environment:/.test(ci));
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
