import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  requiredGates,
  validateEvidence,
} from '../scripts/qualification-evidence.mjs';

const sha = 'a'.repeat(40);
const evidence = () => ({
  schemaVersion: 1,
  sourceSha: sha,
  artifactSha256: 'c'.repeat(64),
  version: '0.1.0',
  node: 'v22.16.0',
  claude: '2.1.294',
  engine: '0.1.0-beta.14',
  platform: 'linux',
  arch: 'x64',
  emulated: false,
  environment: 'native',
  gates: Object.fromEntries(requiredGates.map((key) => [key, 'passed'])),
  gateCodes: Object.fromEntries(requiredGates.map((key) => [key, 'PASS'])),
});
test('skipped manual evidence cannot qualify a platform', () => {
  const value = evidence();
  value.gates['terminal-ui'] = 'blocked';
  value.gateCodes['terminal-ui'] = 'MANUAL_REQUIRED';
  assert.equal(validateEvidence(value, sha), false);
  value.gates.prompt = 'failed';
  value.gateCodes.prompt = 'PROBE_FAILED';
  assert.equal(validateEvidence(value, sha), false);
});
test('qualification rejects stale, emulated, unpinned, or arbitrary-content evidence', () => {
  assert.equal(validateEvidence(evidence(), sha), true);
  for (const patch of [
    { sourceSha: 'b'.repeat(40) },
    { emulated: true },
    { claude: '2.1.295' },
    { engine: 'latest' },
    { rawPayload: 'SYNTHETIC' },
    { node: 'v26.0.0' },
  ])
    assert.throws(
      () => validateEvidence({ ...evidence(), ...patch }, sha),
      /EVIDENCE_INVALID/,
    );
  const missing = evidence();
  delete missing.gates.bash;
  assert.throws(() => validateEvidence(missing, sha), /EVIDENCE_INVALID/);
});
test('release gate requires all 14 exact-commit rows and the actual qualified archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'redacton-gate-'));
  const run = (...args) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  try {
    assert.equal(run('init', '--quiet').status, 0);
    assert.equal(
      run(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--allow-empty',
        '--quiet',
        '-m',
        'synthetic fixture',
      ).status,
      0,
    );
    const sourceSha = run('rev-parse', 'HEAD').stdout.trim();
    await mkdir(join(dir, 'evidence'));
    await mkdir(join(dir, 'artifacts'));
    await mkdir(join(dir, 'docs'));
    await writeFile(
      join(dir, 'docs/platform-matrix.json'),
      await readFile(new URL('../docs/platform-matrix.json', import.meta.url)),
    );
    const bytes = Buffer.from('synthetic archive identity fixture');
    const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ version: '0.1.0' }),
    );
    await writeFile(join(dir, 'artifacts/redacton-0.1.0.tar.gz'), bytes);
    const gate = () =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL('../scripts/qualification-gate.mjs', import.meta.url),
          ),
          'evidence',
        ],
        { cwd: dir, encoding: 'utf8' },
      );
    const paths = [];
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
      ['wsl', 'x64'],
      ['wsl', 'arm64'],
    ]) {
      for (const node of ['v22.16.0', 'v24.21.0']) {
        const path = join(dir, 'evidence', `${platform}-${arch}-${node}.json`);
        paths.push(path);
        await writeFile(
          path,
          JSON.stringify({
            ...evidence(),
            platform,
            environment: platform === 'wsl' ? 'wsl2' : 'native',
            arch,
            node,
            sourceSha,
            artifactSha256,
          }),
        );
      }
    }
    assert.equal(gate().status, 0);
    await writeFile(
      join(dir, 'artifacts/redacton-0.1.0.tar.gz'),
      'changed bytes',
    );
    assert.match(gate().stderr, /RELEASE_ARTIFACT_IDENTITY_MISMATCH/);
    await writeFile(join(dir, 'artifacts/redacton-0.1.0.tar.gz'), bytes);
    await rm(paths[0]);
    assert.match(gate().stderr, /QUALIFICATION_ROW_MISSING/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
