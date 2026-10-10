import assert from 'node:assert/strict';
import test from 'node:test';
import { validateManualProvenance } from '../scripts/manual-provenance.mjs';

const source = 'a'.repeat(40),
  artifact = 'b'.repeat(64);
const run = { id: 123, run_attempt: 2, actor: { login: 'maintainer' } };
const value = () => ({
  schemaVersion: 1,
  sourceSha: source,
  artifactSha256: artifact,
  reviewer: 'maintainer',
  runId: '123',
  runAttempt: '2',
  node22Run: '456',
  node24Run: '789',
  attestationSha256: 'c'.repeat(64),
  overrides: [
    {
      platform: 'linux',
      arch: 'x64',
      node: 'v22.16.0',
      gates: ['terminal-ui'],
    },
  ],
});
test('manual evidence provenance binds review actor, run attempt, base runs and artifact', () => {
  assert.equal(
    validateManualProvenance(value(), run, source, artifact, '456', '789'),
    true,
  );
  for (const patch of [
    { reviewer: 'another' },
    { runAttempt: '1' },
    { node22Run: '999' },
    { sourceSha: 'd'.repeat(40) },
    { rawTranscript: 'SYNTHETIC' },
  ])
    assert.throws(
      () =>
        validateManualProvenance(
          { ...value(), ...patch },
          run,
          source,
          artifact,
          '456',
          '789',
        ),
      /MANUAL_PROVENANCE_INVALID/,
    );
});
