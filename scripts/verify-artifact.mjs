import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readTar, readZip } from './artifact-archive.mjs';

const version = JSON.parse(
  await readFile(resolve('package.json'), 'utf8'),
).version;
const artifactName = `redacton-${version}`;
const temp = await mkdtemp(join(tmpdir(), 'redacton-artifact-'));
let extracted;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function run(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: extracted,
    encoding: 'utf8',
    timeout: 60000,
    ...options,
  });
  if (result.status !== 0) throw new Error('ARTIFACT_CHECK_FAILED');
  return result;
}
const request = {
  protocolVersion: 1,
  requestId: 'artifact_check',
  operation: 'sanitize',
  policyId: 'credentials-alpha1',
  segments: [{ id: 's0', text: 'ghp_SYNTHETICREVOKED00000000000000000000' }],
};
function helper(expectedArtifact) {
  const result = run([process.execPath, 'helper/dist/index.js'], {
    input: JSON.stringify(request),
    timeout: 4000,
  });
  if (result.stderr !== '') throw new Error('HELPER_STDERR');
  const response = JSON.parse(result.stdout);
  if (
    response.status !== 'ok' ||
    response.engineVersion !== '0.1.0-beta.14' ||
    response.artifact !== expectedArtifact ||
    response.segments[0].text.includes(request.segments[0].text) ||
    response.findingCounts.github_token !== 1
  )
    throw new Error('HELPER_QUALIFICATION_FAILED');
  const customText = 'ZXQ_12345678901234567890';
  const configured = {
    ...request,
    protocolVersion: 2,
    config: {
      schemaVersion: 1,
      revision: 'artifact-cfg',
      source: 'session',
      scope: 'session',
      rules: [
        {
          kind: 'token',
          id: 'corp-token',
          action: 'redact',
          prefix: 'ZXQ_',
          alphabet: 'alnum',
          run: { kind: 'exact', length: 20 },
          specificity: 'contextual',
          validator: 'none',
        },
      ],
    },
    segments: [...request.segments, { id: 's1', text: customText }],
  };
  const check = run([process.execPath, 'helper/dist/index.js'], {
    input: JSON.stringify(configured),
    timeout: 4000,
  });
  if (check.stderr !== '') throw new Error('HELPER_STDERR');
  const reply = JSON.parse(check.stdout);
  if (
    reply.status !== 'ok' ||
    reply.protocolVersion !== 2 ||
    reply.configRevision !== configured.config.revision ||
    reply.engineVersion !== '0.1.0-beta.14' ||
    reply.artifact !== expectedArtifact ||
    reply.findingCounts.github_token !== 1 ||
    reply.findingCounts['corp-token'] !== 1 ||
    reply.segments.length !== 2 ||
    reply.segments[1].text !== '<SECRET_1>'
  )
    throw new Error('CONFIGURED_HELPER_QUALIFICATION_FAILED');
}
try {
  const sums = (await readFile(resolve('artifacts/SHA256SUMS'), 'utf8'))
    .trim()
    .split('\n');
  if (sums.length !== 2) throw new Error('ARCHIVE_CHECKSUM');
  const layouts = [];
  for (const [index, name] of [
    `${artifactName}.tar.gz`,
    `${artifactName}.zip`,
  ].entries()) {
    const bytes = await readFile(resolve('artifacts', name));
    if (!sums.includes(`${digest(bytes)}  ${name}`))
      throw new Error('ARCHIVE_CHECKSUM');
    const entries = name.endsWith('.zip') ? readZip(bytes) : readTar(bytes);
    const manifest = entries.get(`${artifactName}/SHA256SUMS`);
    if (!manifest) throw new Error('ARTIFACT_MANIFEST');
    const lines = manifest.toString('utf8').trim().split('\n');
    const expected = new Set([`${artifactName}/SHA256SUMS`]);
    for (const line of lines) {
      const match = /^([a-f0-9]{64}) {2}(.+)$/.exec(line);
      if (!match) throw new Error('ARTIFACT_CHECKSUM');
      const path = `${artifactName}/${match[2]}`;
      if (
        expected.has(path) ||
        !entries.has(path) ||
        digest(entries.get(path)) !== match[1]
      )
        throw new Error('ARTIFACT_CHECKSUM');
      expected.add(path);
    }
    if (entries.size !== expected.size)
      throw new Error('ARTIFACT_UNLISTED_FILE');
    layouts.push(
      [...entries]
        .map(([path, data]) => `${path} ${digest(data)}`)
        .sort()
        .join('\n'),
    );
    const destination = join(temp, String(index));
    for (const [path, data] of entries) {
      const target = join(destination, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, data);
    }
    extracted = join(destination, artifactName);
    const runtimePackage = JSON.parse(
      await readFile(join(extracted, 'package.json'), 'utf8'),
    );
    if (
      runtimePackage.scripts !== undefined ||
      runtimePackage.redactonArtifact?.prebuilt !== true ||
      runtimePackage.redactonArtifact?.classification !==
        'unqualified-portable-wasm'
    )
      throw new Error('ARTIFACT_RUNTIME_MANIFEST');
    helper('wasm');
  }
  if (layouts[0] !== layouts[1]) throw new Error('ARCHIVE_LAYOUT_MISMATCH');
  if (process.argv.includes('--native')) {
    extracted = resolve('.');
    helper('addon');
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      checks: [
        'tar-and-zip-strict-layout',
        'archive-and-complete-file-checksums',
        'public-automatic-wasm-fallback',
        'built-in-and-approved-config-redaction',
        ...(process.argv.includes('--native') ? ['checkout-native-addon'] : []),
      ],
      classification: 'helper-only; actual host qualification required',
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
