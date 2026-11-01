import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  publisherIdentity,
  verifiedPackage,
  verifyProvenance,
  verifyLockIntegrities,
} from "../scripts/lib/npm-provenance.mjs";

const release = "v0.1.0-beta.149";
const version = release.slice(1);
const commit = "a".repeat(40);
const name = "@mdbase-dev/sdk";
const bytes = Buffer.from("unit-test archive bytes");
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const tarball = "https://registry.npmjs.org/@mdbase-dev/sdk/-/sdk.tgz";
const options = { name, version, integrity, release, commit };

function statement() {
  return {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [
      {
        name: `pkg:npm/%40mdbase-dev/sdk@${version}`,
        digest: { sha512: Buffer.from(integrity.slice(7), "base64").toString("hex") },
      },
    ],
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            repository: "https://github.com/mdbase-dev/mdbase-connect",
            path: ".github/workflows/publish-sdk-npm.yml",
            ref: `refs/tags/${release}`,
          },
        },
        resolvedDependencies: [
          {
            uri: `git+https://github.com/mdbase-dev/mdbase-connect@refs/tags/${release}`,
            digest: { gitCommit: commit },
          },
        ],
      },
    },
  };
}

function bundle(payload = statement()) {
  return {
    dsseEnvelope: {
      payloadType: "application/vnd.in-toto+json",
      payload: Buffer.from(JSON.stringify(payload)).toString("base64"),
    },
  };
}

test("Sigstore must authenticate the exact issuer, repository, workflow and tag before payload admission", async () => {
  let authenticated = false;
  await verifyProvenance(bundle(), options, async (_bundle, policy) => {
    authenticated = true;
    assert.equal(policy.certificateIssuer, "https://token.actions.githubusercontent.com");
    assert.equal(policy.tlogThreshold, 1);
    assert.equal(policy.ctLogThreshold, 1);
    const identity = new RegExp(policy.certificateIdentityURI);
    const expected = `https://github.com/mdbase-dev/mdbase-connect/.github/workflows/publish-sdk-npm.yml@refs/tags/${release}`;
    assert.ok(identity.test(expected));
    assert.ok(!identity.test(`evil${expected}`));
    assert.ok(!identity.test(expected.replace("publish-sdk-npm", "publish-npm")));
    assert.ok(!identity.test(expected.replace(release, "v0.1.0-beta.148")));
    assert.ok(!identity.test(expected.replace("mdbase-dev/", "attacker/")));
  });
  assert.ok(authenticated);
  assert.match(publisherIdentity("@mdbase-dev/ui", release).path, /\/publish-npm.yml$/);
  await assert.rejects(
    verifyProvenance(bundle(), options, async () => {
      throw new Error("invalid signature");
    }),
    /invalid signature/,
  );
});

for (const failure of [
  "repository",
  "workflow",
  "ref",
  "commit",
  "digest",
  "subject",
  "missing source",
]) {
  test(`rejects authenticated provenance with wrong ${failure}`, async () => {
    const payload = statement();
    const definition = payload.predicate.buildDefinition;
    if (failure === "repository") definition.externalParameters.workflow.repository += "-evil";
    if (failure === "workflow")
      definition.externalParameters.workflow.path = ".github/workflows/untrusted.yml";
    if (failure === "ref") definition.externalParameters.workflow.ref = "refs/heads/main";
    if (failure === "commit") definition.resolvedDependencies[0].digest.gitCommit = "b".repeat(40);
    if (failure === "digest") payload.subject[0].digest.sha512 = "0".repeat(128);
    if (failure === "subject") payload.subject[0].name = "pkg:npm/other@1.0.0";
    if (failure === "missing source") definition.resolvedDependencies = [];
    await assert.rejects(verifyProvenance(bundle(payload), options, async () => {}));
  });
}

test("registry provenance is required and downloaded archive bytes must match its signed digest", async (context) => {
  let corrupt = false;
  let missing = false;
  const manifest = () => ({
    name,
    version,
    dist: {
      integrity,
      tarball,
      attestations: {
        url: "https://registry.npmjs.org/attestation",
        provenance: { predicateType: statement().predicateType },
      },
    },
  });
  context.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/attestation"))
      return Response.json({
        attestations: [{ predicateType: statement().predicateType, bundle: bundle() }],
      });
    if (url === tarball) return new Response(corrupt ? "tampered" : bytes);
    const metadata = manifest();
    if (missing) delete metadata.dist.attestations;
    return Response.json(metadata);
  });
  assert.deepEqual(await verifiedPackage(name, version, release, commit, async () => {}), {
    name,
    version,
    integrity,
    tarball,
  });
  corrupt = true;
  await assert.rejects(
    verifiedPackage(name, version, release, commit, async () => {}),
    /Tarball integrity mismatch/,
  );
  missing = true;
  await assert.rejects(
    verifiedPackage(name, version, release, commit, async () => {}),
    /Missing provenance/,
  );
});

test("lock refresh cannot replace a verified digest or its tarball", () => {
  const packages = [{ name, version, integrity, tarball }];
  const lock = { lockfileVersion: 3, packages: { [`node_modules/${name}`]: { version, integrity, resolved: tarball } } };
  verifyLockIntegrities(lock, packages);
  lock.packages[`node_modules/${name}`].integrity = "sha512-tampered";
  assert.throws(() => verifyLockIntegrities(lock, packages), /Lockfile integrity mismatch/);
  lock.packages[`node_modules/${name}`] = {
    integrity,
    version,
    resolved: "https://evil.test/sdk.tgz",
  };
  assert.throws(() => verifyLockIntegrities(lock, packages), /Lockfile tarball mismatch/);
});

test('an unpublished SDK version and registry outages fail closed', async context => {
  for (const status of [404, 500]) {
    const mock = context.mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
    await assert.rejects(verifiedPackage(name, version, release, commit), new RegExp(`HTTP ${status}`));
    mock.mock.restore();
  }
});
