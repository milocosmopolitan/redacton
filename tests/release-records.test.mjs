import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  approvedRun,
  validateReleaseManifest,
} from '../scripts/release-records.mjs';

const sha = 'a'.repeat(40);
const repository = { full_name: 'milocosmopolitan/redacton' };
const run = {
  id: 123,
  run_attempt: 2,
  actor: { login: 'maintainer' },
  event: 'workflow_dispatch',
  path: '.github/workflows/release-gate.yml',
  head_sha: sha,
  repository,
  head_repository: repository,
  status: 'completed',
  conclusion: 'success',
};
function manifest() {
  const paths = [
    'artifacts/redacton-0.1.1.tar.gz',
    'artifacts/redacton-0.1.1.zip',
    'artifacts/SHA256SUMS',
  ];
  for (const [platform, arches] of [
    ['darwin', ['x64', 'arm64']],
    ['linux', ['x64', 'arm64']],
    ['win32', ['x64']],
    ['wsl', ['x64', 'arm64']],
  ])
    for (const arch of arches)
      for (const node of [22, 24])
        paths.push(`qualification/evidence/${platform}-${arch}-${node}.json`);
  return {
    schemaVersion: 1,
    sourceSha: sha,
    version: '0.1.1',
    runId: '123',
    runAttempt: 2,
    actor: 'maintainer',
    files: paths.map((path) => ({ path, sha256: 'b'.repeat(64) })),
  };
}
test('tag approval requires successful exact-source canonical manual gate, not arbitrary named artifacts', () => {
  assert.equal(approvedRun(run, sha), true);
  for (const patch of [
    { event: 'pull_request' },
    { path: '.github/workflows/qualification.yml' },
    { head_sha: 'c'.repeat(40) },
    { head_repository: { full_name: 'attacker/fork' } },
    { repository: { full_name: 'attacker/fork' } },
    { conclusion: 'failure' },
    { status: 'in_progress' },
  ]) {
    assert.equal(approvedRun({ ...run, ...patch }, sha), false);
    assert.throws(() =>
      validateReleaseManifest(manifest(), { ...run, ...patch }, sha, '0.1.1'),
    );
  }
});
test('release bundle binds run attempt, actor, version, full rows and safe digest paths', () => {
  assert.equal(validateReleaseManifest(manifest(), run, sha, '0.1.1'), true);
  for (const mutate of [
    (v) => {
      v.runAttempt = 1;
    },
    (v) => {
      v.actor = 'attacker';
    },
    (v) => {
      v.sourceSha = 'c'.repeat(40);
    },
    (v) => {
      v.version = '0.1.0';
    },
    (v) => {
      v.files.pop();
    },
    (v) => {
      v.files[3] = v.files[4];
    },
    (v) => {
      v.files[3].path = '../../private';
    },
    (v) => {
      v.files[3].sha256 = 'invalid';
    },
    (v) => {
      v.rawTranscript = 'private';
    },
    (v) => {
      v.files[3].raw = 'private';
    },
  ]) {
    const value = manifest();
    mutate(value);
    assert.throws(() => validateReleaseManifest(value, run, sha, '0.1.1'));
  }
});

test('invalid source hashes and unsupported replacement rows never approve', () => {
  assert.equal(approvedRun({ ...run, head_sha: 'invalid' }, 'invalid'), false);
  const value = manifest();
  value.files[3].path = 'qualification/evidence/win32-arm64-22.json';
  assert.throws(() => validateReleaseManifest(value, run, sha, '0.1.1'));
});

test('CLI rejection emits one finite code and no stack or supplied text', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/release-records.mjs', 'PRIVATE_UNKNOWN_MODE'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '{"code":"RELEASE_RECORD_REJECTED"}\n');
});
