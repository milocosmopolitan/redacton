import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredGates } from '../scripts/qualification-evidence.mjs';
import { validateWslHostExport } from '../scripts/qualify-wsl-host.mjs';

const source = 'a'.repeat(40);
const artifact = 'b'.repeat(64);
function bundle() {
  return {
    schemaVersion: 1,
    sourceSha: source,
    artifactSha256: artifact,
    rows: ['22.16.0', '24.21.0'].map((node) => ({
      node,
      status: 'blocked',
      phase: 'COMPLETE',
      diagnostics: [],
      record: {
        schemaVersion: 1,
        sourceSha: source,
        artifactSha256: artifact,
        version: '0.1.1',
        node: `v${node}`,
        claude: '2.1.294',
        engine: '0.1.0-beta.14',
        platform: 'wsl',
        arch: 'x64',
        environment: 'wsl2',
        emulated: false,
        gates: Object.fromEntries(
          requiredGates.map((gate) => [
            gate,
            gate === 'config-races' ? 'blocked' : 'passed',
          ]),
        ),
        gateCodes: Object.fromEntries(
          requiredGates.map((gate) => [
            gate,
            gate === 'config-races' ? 'MANUAL_REQUIRED' : 'PASS',
          ]),
        ),
      },
    })),
  };
}
test('WSL exports preserve blocked gates and reject foreign provenance, target and raw output', () => {
  const value = bundle();
  assert.equal(validateWslHostExport(value, source, artifact), value);
  for (const mutate of [
    (v) => {
      v.rows[0].status = 'passed';
    },
    (v) => {
      v.rows[0].record.sourceSha = 'c'.repeat(40);
    },
    (v) => {
      v.rows[0].record.artifactSha256 = 'c'.repeat(64);
    },
    (v) => {
      v.rows[0].record.platform = 'linux';
      v.rows[0].record.environment = 'native';
    },
    (v) => {
      v.rows[0].record.arch = 'arm64';
    },
    (v) => {
      v.rows[0].record.emulated = true;
    },
    (v) => {
      v.rows[0].node = '22.23.3';
    },
    (v) => {
      v.rows[0].diagnostics.push({
        code: 'FAULT_PROBE_FAILED',
        stdout: 'private',
      });
    },
    (v) => {
      v.rows.reverse();
    },
  ]) {
    const invalid = structuredClone(value);
    mutate(invalid);
    assert.throws(() => validateWslHostExport(invalid, source, artifact));
  }
});
test('source setup failures export fixed states without publishing host records', () => {
  const value = bundle();
  for (const row of value.rows) {
    row.record = null;
    row.status = 'failed';
    row.phase = 'LOCK';
  }
  assert.equal(validateWslHostExport(value, source, artifact), value);
  value.rows[0].status = 'blocked';
  assert.throws(() => validateWslHostExport(value, source, artifact));
});
