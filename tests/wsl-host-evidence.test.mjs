import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { archiveTar } from '../scripts/artifact-archive.mjs';
import { requiredGates } from '../scripts/qualification-evidence.mjs';
import {
  canonicalWslArtifactIdentity,
  validateWslHostExport,
} from '../scripts/qualify-wsl-host.mjs';

const source = 'a'.repeat(40);
const artifact = 'b'.repeat(64);
test('canonical identity derives pinned source and lock and rejects altered archive bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redacton-wsl-canonical-'));
  const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
  try {
    const tar = archiveTar([
      {
        name: 'redacton-0.1.1/package.json',
        data: Buffer.from('{"version":"0.1.1"}'),
      },
      {
        name: 'redacton-0.1.1/PROVENANCE.json',
        data: Buffer.from(
          JSON.stringify({
            schemaVersion: 1,
            source: { commit: source, dirty: false },
            sourceLockSha256: artifact,
            builder: { node: 'v22.16.0', platform: 'linux', arch: 'x64' },
          }),
        ),
      },
    ]);
    const zip = Buffer.from('checksum fixture');
    writeFileSync(join(dir, 'redacton-0.1.1.tar.gz'), tar);
    writeFileSync(join(dir, 'redacton-0.1.1.zip'), zip);
    writeFileSync(
      join(dir, 'SHA256SUMS'),
      `${sha(tar)}  redacton-0.1.1.tar.gz\n${sha(zip)}  redacton-0.1.1.zip\n`,
    );
    assert.deepEqual(canonicalWslArtifactIdentity(dir, source), {
      sourceSha: source,
      lockSha256: artifact,
      artifactSha256: sha(tar),
    });
    assert.throws(() => canonicalWslArtifactIdentity(dir, 'c'.repeat(40)));
    writeFileSync(join(dir, 'redacton-0.1.1.zip'), 'corrupt');
    assert.throws(() => canonicalWslArtifactIdentity(dir, source));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
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

test('ARM exports require explicit native ARM identity for both Node rows', () => {
  const value = bundle();
  for (const row of value.rows) row.record.arch = 'arm64';
  assert.equal(validateWslHostExport(value, source, artifact, 'arm64'), value);
  assert.throws(() => validateWslHostExport(value, source, artifact));
  assert.throws(() => validateWslHostExport(value, source, artifact, 'arm'));
  for (const patch of [{ arch: 'x64' }, { emulated: true }]) {
    const invalid = structuredClone(value);
    Object.assign(invalid.rows[1].record, patch);
    assert.throws(() =>
      validateWslHostExport(invalid, source, artifact, 'arm64'),
    );
  }
});

test('WSL configuration evidence rejects raw text and hidden helper reruns', () => {
  const value = bundle();
  const diagnostic = {
    code: 'CONFIG_RACE_ROW',
    status: 'passed',
    stage: 'complete',
    appliedWhileHeld: true,
    oldConfigurationObserved: true,
    newConfigurationObserved: true,
    firstRawObserved: true,
    secondMaskedObserved: true,
    toolResultsSuccessful: true,
    privateEveryRequest: true,
    endpointFailed: false,
    executions: 2,
    modelRequests: 4,
    auxiliaryRequests: 2,
    toolResultCount: 2,
    stdoutSanitizes: 2,
  };
  for (const row of value.rows) {
    row.status = 'passed';
    row.record.gates['config-races'] = 'passed';
    row.record.gateCodes['config-races'] = 'PASS';
    row.diagnostics.push(structuredClone(diagnostic));
  }
  assert.equal(validateWslHostExport(value, source, artifact), value);
  for (const patch of [
    { stdoutSanitizes: 3 },
    { privateEveryRequest: false },
    { transcript: 'private' },
  ]) {
    const invalid = structuredClone(value);
    Object.assign(invalid.rows[0].diagnostics[0], patch);
    assert.throws(() => validateWslHostExport(invalid, source, artifact));
  }
});
