import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadOriginals } from './lib/native-originals.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const hashes = {};
for (const [key, name] of [['SDK', 'sdk'], ['UI', 'ui'], ['PROTOCOL', 'connect-protocol']]) {
  const pin = manifest.dependencies[`@mdbase-dev/${name}`];
  if (!pin.startsWith('file:')) throw new Error('Production build requires qualified native original intake');
  hashes[`NATIVE_${key}_SHA256`] = createHash('sha256').update(await readFile(new URL(`../${pin.slice(5)}`, import.meta.url))).digest('hex');
}
hashes.NATIVE_TRUST_ASSET_SHA256 = createHash('sha256').update(await readFile(new URL('../vendor/native-release/production/next-trust/production.json', import.meta.url))).digest('hex');
const originals = await loadOriginals({ target: 'production', repoRoot: root, hashes, installed: true });
const { buildApplication } = await import('./build-application.mjs');
const { buildOfflineShell } = await import('@mdbase-dev/sdk/offline-shell/build');
const output = await mkdtemp(new URL('../.application-build-ci-', import.meta.url));
try {
  for (const name of ['index.html', 'journal.css']) await copyFile(new URL(`../public/${name}`, import.meta.url), `${output}/${name}`);
  await buildApplication({ output, originals, env: { JOURNAL_ENVIRONMENT: 'production', JOURNAL_ORIGIN: 'https://journal.mdbase.dev' } });
  await buildOfflineShell({ directory: output });
} finally {
  await rm(output, { recursive: true, force: true });
}
