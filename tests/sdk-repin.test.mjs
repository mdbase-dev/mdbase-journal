import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { productionIdentity, repinPlan } from "../scripts/sdk-repin.mjs";

const commit = "a".repeat(40);
const release = "v0.1.0-beta.149";
const version = release.slice(1);
const record = `MDBASE_CONNECT_RELEASE=${release}\nMDBASE_CONNECT_COMMIT=${commit}\n`;

test("only the exact annotated production identity is accepted", () => {
  assert.equal(productionIdentity(record, release, commit), commit);
  for (const [input, tag] of [
    ["latest", commit],
    ["v0.1.0-beta.147", commit],
    [release, "b".repeat(40)],
    [release, ""],
  ]) {
    assert.throws(() => productionIdentity(record, input, tag));
  }
});

test("only npm pins advance, including preservation of the SDK file original", () => {
  const plan = repinPlan(
    [
      {
        path: "package.json",
        text: JSON.stringify({
          dependencies: {
            "@mdbase-dev/ui": "^0.1.0-beta.147",
            "@mdbase-dev/sdk": "file:vendor/original.tgz",
            "@mdbase-dev/sdk-staging": "file:vendor/staging.tgz",
            "@mdbase-dev/sdk-lab": "file:vendor/lab.tgz",
            "@mdbase-dev/sdk-legacy-729b5391": "file:vendor/legacy.tgz",
            "@mdbase-dev/connect-protocol": "file:vendor/protocol.tgz",
            "@other/package": "1.0.0",
          },
          devDependencies: { "@mdbase-dev/connect-dev": "0.1.0-beta.125" },
          optionalDependencies: { "@mdbase-dev/i18n": "~0.1.0-beta.147" },
          peerDependencies: { "@mdbase-dev/ui": "^0.1.0-beta.140" },
        }),
      },
    ],
    version,
  );
  const changed = JSON.parse(plan.changes[0].text);
  assert.equal(changed.dependencies["@mdbase-dev/ui"], version);
  assert.equal(changed.dependencies["@mdbase-dev/sdk"], "file:vendor/original.tgz");
  assert.equal(changed.devDependencies["@mdbase-dev/connect-dev"], version);
  assert.equal(changed.optionalDependencies["@mdbase-dev/i18n"], version);
  assert.equal(changed.peerDependencies["@mdbase-dev/ui"], "^0.1.0-beta.140");
  assert.equal(changed.dependencies["@mdbase-dev/sdk-staging"], "file:vendor/staging.tgz");
  assert.equal(changed.dependencies["@mdbase-dev/connect-protocol"], "file:vendor/protocol.tgz");
  assert.equal(changed.dependencies["@other/package"], "1.0.0");
  assert.deepEqual(plan.packages, [
    "@mdbase-dev/connect-dev",
    "@mdbase-dev/i18n",
    "@mdbase-dev/ui",
  ]);
});

test("matching exact pins do not rewrite formatting or create a PR", () => {
  const plan = repinPlan(
    [
      {
        path: "package.json",
        text: JSON.stringify({ dependencies: { "@mdbase-dev/sdk": version } }),
      },
    ],
    version,
  );
  assert.deepEqual(plan.changes, []);
});

test("unexpected remote pin schemes refuse rather than silently migrate", () => {
  assert.throws(() =>
    repinPlan(
      [
        {
          path: "package.json",
          text: JSON.stringify({
            dependencies: { "@mdbase-dev/ui": "https://example.test/ui.tgz" },
          }),
        },
      ],
      version,
    ),
  );
});

test("unqualified SDK refuses atomically; qualified fixture preserves file pins and repeat no-op", () => {
  const directory = mkdtempSync(join(tmpdir(), "journal-sdk-repin-"));
  try {
    const binaries = join(directory, "bin");
    mkdirSync(binaries);
    const original = JSON.stringify({
      dependencies: {
        "@mdbase-dev/ui": "0.1.0-beta.147",
        "@mdbase-dev/sdk": "file:original-sdk.tgz",
      },
    });
    writeFileSync(join(directory, "package.json"), original);
    const fake = `#!${process.execPath}
const command = process.argv[1].split('/').pop();
if (command === 'gh') console.log(JSON.stringify({content: Buffer.from(${JSON.stringify(record)}).toString('base64')}));
else if (command === 'git') console.log(process.argv[2] === 'ls-remote' ? '${commit}\\trefs/tags/${release}^{}' : 'package.json\\0');
else if (process.argv[3].startsWith('@mdbase-dev/sdk@') && process.env.MISSING_SDK === 'true') process.exit(1);
else console.log(JSON.stringify('${version}'));
`;
    for (const name of ["gh", "git", "npm"]) {
      writeFileSync(join(binaries, name), fake, { mode: 0o755 });
    }
    const output = join(directory, "output");
    const invoke = (missing) =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
          import { repin } from ${JSON.stringify(new URL("../scripts/sdk-repin.mjs", import.meta.url).href)};
          await repin(async (name, version) => {
            return {name, version, integrity: 'fixture'};
          }, async () => {
            if (process.env.MISSING_SDK === 'true') throw new Error('no partial repin');
          }, async () => ({bytes: Buffer.from('qualified fixture only')}));
        `,
        ],
        {
          cwd: directory,
          env: {
            ...process.env,
            CONNECT_RELEASE: release,
            GITHUB_OUTPUT: output,
            REPIN_INTEGRITIES: join(directory, "integrities.json"),
            MISSING_SDK: String(missing),
            PATH: `${binaries}:${process.env.PATH}`,
          },
          stdio: "pipe",
        },
      );
    assert.throws(() => invoke(true), /no partial repin/);
    assert.equal(readFileSync(join(directory, "package.json"), "utf8"), original);
    assert.equal(existsSync(output), false);
    invoke(false);
    assert.equal(
      JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).dependencies[
        "@mdbase-dev/sdk"
      ],
      "file:original-sdk.tgz",
    );
    assert.match(readFileSync(output, "utf8"), /changed=true/);
    writeFileSync(output, "");
    invoke(false);
    assert.match(readFileSync(output, "utf8"), /changed=false/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
