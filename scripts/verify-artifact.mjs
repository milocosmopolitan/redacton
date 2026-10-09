import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve('artifacts/redacton-alpha-1');
const temp = await mkdtemp(join(tmpdir(), 'redacton-artifact-'));
const extracted = join(temp, 'redacton-alpha-1');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function checkTree(dir) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name),
      stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error('ARTIFACT_SYMLINK');
    if (stat.isDirectory()) await checkTree(path);
    else if (!stat.isFile()) throw new Error('ARTIFACT_SPECIAL_FILE');
  }
}
function run(args, options = {}) {
  const result = spawnSync('rtk', ['proxy', ...args], {
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
}
try {
  const [archiveHash, archiveName] = (
    await readFile(resolve('artifacts/SHA256SUMS'), 'utf8')
  )
    .trim()
    .split('  ');
  if (
    archiveName !== 'redacton-alpha-1-evaluation.tar.gz' ||
    digest(await readFile(resolve('artifacts', archiveName))) !== archiveHash
  )
    throw new Error('ARCHIVE_CHECKSUM');
  await checkTree(source);
  for (const line of (await readFile(join(source, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split('\n')) {
    const [hash, path] = line.split('  ');
    if (
      !path ||
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      digest(await readFile(join(source, path))) !== hash
    )
      throw new Error('ARTIFACT_CHECKSUM');
  }
  const unpack = spawnSync(
    'rtk',
    [
      'proxy',
      'python3',
      '-c',
      'import tarfile,sys; t=tarfile.open(sys.argv[1]); t.extractall(sys.argv[2],filter="data")',
      resolve('artifacts', archiveName),
      temp,
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  if (unpack.status !== 0) throw new Error('ARCHIVE_EXTRACTION_FAILED');
  await checkTree(extracted);
  for (const line of (await readFile(join(extracted, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split('\n')) {
    const [hash, path] = line.split('  ');
    if (
      !path ||
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      digest(await readFile(join(extracted, path))) !== hash
    )
      throw new Error('EXTRACTED_ARTIFACT_CHECKSUM');
  }
  const runtimePackage = JSON.parse(
    await readFile(join(extracted, 'package.json'), 'utf8'),
  );
  if (
    runtimePackage.scripts !== undefined ||
    runtimePackage.redactonArtifact?.prebuilt !== true
  )
    throw new Error('ARTIFACT_RUNTIME_MANIFEST');
  helper('addon');
  await rm(join(extracted, 'node_modules'), { recursive: true, force: true });
  run([
    'npm',
    'ci',
    '--ignore-scripts',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
  ]);
  helper('addon');
  for (const name of await readdir(
    join(extracted, 'node_modules/@redact-secret'),
  ))
    if (name.startsWith('node-'))
      await rm(join(extracted, 'node_modules/@redact-secret', name), {
        recursive: true,
      });
  helper('wasm');
  run(['claude', 'plugin', 'validate', '--strict', extracted]);
  console.log(
    JSON.stringify({
      status: 'passed',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      checks: [
        'archive-checksum',
        'archive-extraction',
        'file-checksums',
        'no-symlinks',
        'prebuilt-runtime-manifest',
        'bundled-native',
        'clean-install-ignore-scripts',
        'installed-native',
        'missing-addon-wasm',
        'strict-host-validation',
      ],
      classification: 'evaluation-only',
    }),
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
