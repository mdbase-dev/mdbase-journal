import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { reviewedNativeBase } from './native-tag.mjs';
import { repinPlan } from './sdk-repin.mjs';
import { verifiedPackage, verifyLockIntegrities } from './lib/npm-provenance.mjs';

export function completedMainRun(event, repository) {
  const run = event.workflow_run;
  assert.equal(event.action, 'completed');
  assert.equal(event.repository?.full_name, repository);
  assert.equal(run?.head_repository?.full_name, repository);
  assert.equal(run?.name, 'CI');
  assert.equal(run?.path, '.github/workflows/ci.yml');
  assert.equal(run?.event, 'push');
  assert.equal(run?.head_branch, 'main');
  assert.equal(run?.status, 'completed');
  assert.equal(run?.conclusion, 'success');
  assert.match(run?.head_sha ?? '', /^[a-f0-9]{40}$/);
  return run.head_sha;
}

export function mergedTrainPull(pulls, repository, sha, appSlug) {
  const candidates = pulls.filter(pull => pull.merged_at && pull.merge_commit_sha === sha &&
    pull.base?.ref === 'main' && pull.base?.repo?.full_name === repository &&
    pull.head?.ref === 'automation/sdk-repin' && pull.head?.repo?.full_name === repository &&
    pull.user?.type === 'Bot' && /^Pin production Connect packages to v0\.1\.0-beta\.[1-9][0-9]*$/.test(pull.title));
  assert.ok(candidates.length <= 1, 'Ambiguous merged train PR');
  if (!candidates.length) return null;
  const pull = candidates[0];
  if (appSlug) assert.equal(pull.user.login, `${appSlug}[bot]`, 'Not the release automation App PR');
  return pull;
}

export function assertRepinFiles(files) {
  assert.deepEqual([...files].sort(), ['package-lock.json', 'package.json'], 'Only the existing root manifest and npm lockfile may change');
}

export function assertAppCommits(commits, pull) {
  assert.ok(Number.isSafeInteger(pull.commits) && pull.commits > 0 && pull.commits <= 100, 'Missing or oversized PR commit history');
  assert.equal(commits.length, pull.commits, 'Incomplete PR commit history');
  assert.equal(commits.at(-1).sha, pull.head.sha, 'PR commit history/head mismatch');
  const bot = pull.user;
  assert.ok(Number.isSafeInteger(bot.id) && bot.id > 0, 'Missing App bot identity');
  for (const commit of commits) {
    for (const role of ['author', 'committer']) {
      assert.equal(commit[role]?.type, 'Bot', `PR commit ${role} is not the release App`);
      assert.equal(commit[role]?.id, bot.id, `PR commit ${role} is not the release App`);
      assert.equal(commit[role]?.login, bot.login, `PR commit ${role} is not the release App`);
      assert.equal(commit.commit?.[role]?.name, bot.login, `PR commit ${role} name mismatch`);
      assert.equal(commit.commit?.[role]?.email, `${bot.id}+${bot.login}@users.noreply.github.com`, `PR commit ${role} email mismatch`);
    }
  }
}

export function assertRepinContent(before, after, version) {
  const plan = repinPlan([{ path: 'package.json', text: JSON.stringify(before.manifest) }], version);
  assert.equal(plan.changes.length, 1, 'No planned npm pin change');
  assert.deepEqual(after.manifest, JSON.parse(plan.changes[0].text), 'Manifest differs from regenerated pin-only repin');
  const oldLock = structuredClone(before.lock), newLock = structuredClone(after.lock);
  assert.equal(oldLock.lockfileVersion, 3);
  assert.equal(newLock.lockfileVersion, 3);
  const root = oldLock.packages[''];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (after.manifest[section]) root[section] = after.manifest[section];
  }
  for (const name of plan.packages) {
    const key = `node_modules/${name}`;
    assert.ok(oldLock.packages[key] && newLock.packages[key], 'New/missing package lock entry');
    assert.equal(newLock.packages[key].version, version, 'Lock version differs from repin');
    delete oldLock.packages[key];
    delete newLock.packages[key];
  }
  assert.deepEqual(newLock, oldLock, 'Lock changes outside repinned @mdbase-dev entries');
  return plan.packages;
}

export async function handoff({ event, env = process.env, execute, publish = false, verifyPackage = verifiedPackage }) {
  const repository = env.GITHUB_REPOSITORY;
  assert.equal(repository, 'mdbase-dev/mdbase-journal');
  const sha = completedMainRun(event, repository);
  const api = endpoint => JSON.parse(execute('gh', ['api', `repos/${repository}/${endpoint}`]));
  const associated = api(`commits/${sha}/pulls?per_page=100`);
  assert.ok(associated.length < 100, 'Truncated associated PR response');
  const pulls = associated.map(pull => api(`pulls/${pull.number}`));
  const pull = mergedTrainPull(pulls, repository, sha, publish ? env.APP_SLUG : undefined);
  if (!pull) return false;
  assertAppCommits(api(`pulls/${pull.number}/commits?per_page=100`), pull);
  const git = (...args) => execute('git', args).trim();
  assert.equal(git('rev-parse', 'HEAD'), sha, 'Checkout must match successful main CI');
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Dirty handoff checkout');
  git('merge-base', '--is-ancestor', reviewedNativeBase, sha);
  assertRepinFiles(git('diff', '--name-only', `${sha}^`, sha).split('\n'));
  assert.equal(git('diff', '--diff-filter=ACDRTUXB', '--name-only', '--no-renames', `${sha}^`, sha), '', 'Repin may only modify existing regular files');
  assert.equal(git('diff', '--summary', '--no-renames', `${sha}^`, sha), '', 'Repin cannot change file modes');
  const read = ref => ({ manifest: JSON.parse(git('show', `${ref}:package.json`)), lock: JSON.parse(git('show', `${ref}:package-lock.json`)) });
  const after = read(sha);
  const version = pull.title.match(/v(0\.1\.0-beta\.[1-9][0-9]*)$/)[1];
  const packages = assertRepinContent(read(`${sha}^`), after, version);
  const release = `v${version}`;
  const commit = git('ls-remote', 'https://github.com/mdbase-dev/mdbase-connect.git', `refs/tags/${release}^{}`).split(/\s/)[0];
  assert.match(commit, /^[a-f0-9]{40}$/, 'Missing annotated Connect tag commit');
  const verified = [];
  for (const name of packages) verified.push(await verifyPackage(name, version, release, commit));
  verifyLockIntegrities(after.lock, verified);
  const main = api('git/ref/heads/main');
  assert.equal(main.object?.type, 'commit');
  assert.equal(main.object.sha, sha, 'main moved after this CI run; refusing stale handoff');
  if (!publish) return true;
  assert.ok(env.APP_SLUG, 'Release App identity required');
  assert.ok(env.GH_TOKEN, 'Release App token required');
  const branch = 'refs/heads/release/native-production';
  const tag = `refs/tags/native-publish-production-${sha}`;
  const previous = api('git/ref/heads/release/native-production');
  assert.equal(previous.object?.type, 'commit');
  assert.match(previous.object.sha, /^[a-f0-9]{40}$/);
  git('fetch', '--no-tags', 'origin', `${branch}:refs/remotes/origin/release/native-production`);
  git('merge-base', '--is-ancestor', previous.object.sha, sha);
  const existing = git('ls-remote', 'origin', tag);
  if (existing) {
    assert.equal(existing, `${sha}\t${tag}`, 'Existing publication tag has another identity');
    assert.equal(previous.object.sha, sha, 'Publication tag exists but release HEAD moved');
    return true;
  }
  assert.equal(api('git/ref/heads/main').object.sha, sha, 'main moved before handoff');
  git('push', '--atomic', 'origin', `${sha}:${branch}`, `${sha}:${tag}`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const mode = process.argv[2];
  assert.ok(['candidate', 'publish'].includes(mode), 'Expected candidate or publish');
  const publish = mode === 'publish';
  const gitEnv = { ...process.env };
  if (publish) {
    assert.ok(process.env.GH_TOKEN, 'Release App token required');
    gitEnv.GIT_CONFIG_COUNT = '1';
    gitEnv.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    gitEnv.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GH_TOKEN}`).toString('base64')}`;
    gitEnv.GIT_TERMINAL_PROMPT = '0';
  }
  const execute = (command, args) => execFileSync(command, args, {
    env: command === 'git' ? gitEnv : process.env,
    encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const eligible = await handoff({ event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), execute, publish });
  if (!publish) appendFileSync(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n`);
}
