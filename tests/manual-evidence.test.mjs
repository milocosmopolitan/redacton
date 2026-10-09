import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeManualEvidence } from '../scripts/manual-evidence.mjs';
import { requiredGates } from '../scripts/qualification-evidence.mjs';

const sourceSha = 'a'.repeat(40),
  artifactSha256 = 'b'.repeat(64);
const record = () => ({
  schemaVersion: 1,
  sourceSha,
  artifactSha256,
  version: '0.1.1',
  node: 'v22.16.0',
  claude: '2.1.294',
  engine: '0.1.0-beta.14',
  platform: 'darwin',
  arch: 'arm64',
  emulated: false,
  environment: 'native',
  gateCodes: Object.fromEntries(
    requiredGates.map((key) => [
      key,
      ['terminal-ui', 'config-races', 'toggle-races'].includes(key)
        ? 'MANUAL_REQUIRED'
        : 'PASS',
    ]),
  ),
  gates: Object.fromEntries(
    requiredGates.map((key) => [
      key,
      ['terminal-ui', 'config-races', 'toggle-races'].includes(key)
        ? 'blocked'
        : 'passed',
    ]),
  ),
});
const attestation = (gates = { 'terminal-ui': 'passed' }) => ({
  reviewed: true,
  schemaVersion: 1,
  sourceSha,
  artifactSha256,
  rows: [{ platform: 'darwin', arch: 'arm64', node: 'v22.16.0', gates }],
});
test('reviewed manual outcomes fill only exact-source, exact-artifact blocked manual gates', () => {
  const before = record();
  const merged = mergeManualEvidence(
    [before],
    attestation(),
    sourceSha,
    artifactSha256,
  );
  assert.equal(merged[0].gates['terminal-ui'], 'passed');
  assert.equal(before.gates['terminal-ui'], 'blocked');
  assert.equal(merged[0].gates['config-races'], 'blocked');
  assert.throws(
    () =>
      mergeManualEvidence(
        [before],
        { ...attestation(), sourceSha: 'c'.repeat(40) },
        sourceSha,
        artifactSha256,
      ),
    /MANUAL_EVIDENCE_INVALID/,
  );
  assert.throws(
    () =>
      mergeManualEvidence([before], attestation(), sourceSha, 'c'.repeat(64)),
    /MANUAL_EVIDENCE_INVALID/,
  );
});
test('manual review cannot override failed automated probes, invent rows, or pass nonmanual gates', () => {
  const failed = record();
  failed.gates['terminal-ui'] = 'failed';
  failed.gateCodes['terminal-ui'] = 'PROBE_FAILED';
  assert.throws(
    () =>
      mergeManualEvidence([failed], attestation(), sourceSha, artifactSha256),
    /MANUAL_GATE_INVALID/,
  );
  assert.throws(
    () =>
      mergeManualEvidence(
        [record()],
        attestation({ prompt: 'passed' }),
        sourceSha,
        artifactSha256,
      ),
    /MANUAL_GATE_INVALID/,
  );
  const unknown = attestation();
  unknown.rows[0].platform = 'win32';
  assert.throws(
    () => mergeManualEvidence([record()], unknown, sourceSha, artifactSha256),
    /MANUAL_ROW_INVALID/,
  );
  const raw = attestation();
  raw.rows[0].rawTranscript = 'SYNTHETIC';
  assert.throws(
    () => mergeManualEvidence([record()], raw, sourceSha, artifactSha256),
    /MANUAL_EVIDENCE_INVALID/,
  );
});
