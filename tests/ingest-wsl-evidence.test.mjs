import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestWslEvidence } from '../scripts/ingest-wsl-evidence.mjs';
import { requiredGates } from '../scripts/qualification-evidence.mjs';

const source = 'a'.repeat(40),
  artifact = 'b'.repeat(64),
  version = '0.1.1';
function record(node = 'v22.16.0') {
  return {
    schemaVersion: 1,
    sourceSha: source,
    artifactSha256: artifact,
    version,
    node,
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
  };
}
function fixture(callback) {
  const temporary = mkdtempSync(join(tmpdir(), 'redacton-wsl-ingestion-'));
  try {
    const input = join(temporary, 'input'),
      output = join(temporary, 'output');
    mkdirSync(input);
    callback(input, output);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
test('optional absence and summary-only artifacts grant no WSL qualification', () =>
  fixture((input, output) => {
    assert.equal(
      ingestWslEvidence(
        join(input, 'absent'),
        output,
        source,
        artifact,
        version,
      ),
      0,
    );
    writeFileSync(join(input, 'wsl-host-summary.json'), '{}');
    assert.equal(
      ingestWslEvidence(input, output, source, artifact, version),
      0,
    );
    assert.equal(existsSync(output), false);
    writeFileSync(join(input, 'wsl-installation.json'), '{}');
    assert.throws(() =>
      ingestWslEvidence(input, output, source, artifact, version),
    );
  }));
test('only exact actual-host WSL x64 rows are imported, preserving blocked gates', () =>
  fixture((input, output) => {
    const nested = join(input, 'wsl-host');
    mkdirSync(nested);
    writeFileSync(join(nested, 'wsl-x64-22.json'), JSON.stringify(record()));
    writeFileSync(
      join(nested, 'wsl-x64-24.json'),
      JSON.stringify(record('v24.21.0')),
    );
    writeFileSync(join(nested, 'wsl-host-summary.json'), '{}');
    assert.equal(
      ingestWslEvidence(input, output, source, artifact, version),
      2,
    );
    assert.equal(
      JSON.parse(readFileSync(join(output, 'wsl-x64-22.json'))).gates[
        'config-races'
      ],
      'blocked',
    );
    assert.equal(existsSync(join(output, 'wsl-host-summary.json')), false);
    assert.throws(() =>
      ingestWslEvidence(input, output, source, artifact, version),
    );
  }));
test('provenance, runtime, target and overwrite failures write no partial replacement', () => {
  for (const mutate of [
    (v) => {
      v.sourceSha = 'c'.repeat(40);
    },
    (v) => {
      v.artifactSha256 = 'c'.repeat(64);
    },
    (v) => {
      v.version = '0.1.0';
    },
    (v) => {
      v.platform = 'linux';
      v.environment = 'native';
    },
    (v) => {
      v.arch = 'arm64';
    },
    (v) => {
      v.node = 'v24.21.0';
    },
    (v) => {
      v.raw = 'private';
    },
  ])
    fixture((input, output) => {
      const value = record();
      mutate(value);
      writeFileSync(join(input, 'wsl-x64-22.json'), JSON.stringify(value));
      assert.throws(() =>
        ingestWslEvidence(input, output, source, artifact, version),
      );
      assert.equal(existsSync(output), false);
    });
  fixture((input, output) => {
    writeFileSync(join(input, 'wsl-x64-22.json'), JSON.stringify(record()));
    writeFileSync(
      join(input, 'wsl-x64-24.json'),
      JSON.stringify(record('v24.21.0')),
    );
    mkdirSync(output);
    writeFileSync(join(output, 'wsl-x64-24.json'), 'existing');
    assert.throws(() =>
      ingestWslEvidence(input, output, source, artifact, version),
    );
    assert.equal(existsSync(join(output, 'wsl-x64-22.json')), false);
    assert.equal(
      readFileSync(join(output, 'wsl-x64-24.json'), 'utf8'),
      'existing',
    );
  });
});
