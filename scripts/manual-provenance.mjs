import { manualGates } from './manual-evidence.mjs';
export function validateManualProvenance(
  value,
  run,
  sourceSha,
  artifactSha256,
  node22Run,
  node24Run,
) {
  const keys = [
    'schemaVersion',
    'sourceSha',
    'artifactSha256',
    'reviewer',
    'runId',
    'runAttempt',
    'node22Run',
    'node24Run',
    'attestationSha256',
    'overrides',
  ];
  if (
    value?.schemaVersion !== 1 ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.sourceSha !== sourceSha ||
    value.artifactSha256 !== artifactSha256 ||
    value.runId !== String(run.id) ||
    value.runAttempt !== String(run.run_attempt) ||
    value.reviewer !== run.actor?.login ||
    value.node22Run !== node22Run ||
    value.node24Run !== node24Run ||
    !/^[a-f0-9]{64}$/.test(value.attestationSha256) ||
    !Array.isArray(value.overrides) ||
    value.overrides.length > 14
  )
    throw new Error('MANUAL_PROVENANCE_INVALID');
  for (const row of value.overrides) {
    if (
      !row ||
      !['darwin', 'linux', 'win32'].includes(row.platform) ||
      !['x64', 'arm64'].includes(row.arch) ||
      !['v22.16.0', 'v24.21.0'].includes(row.node) ||
      Object.keys(row).some(
        (key) => !['platform', 'arch', 'node', 'gates'].includes(key),
      )
    )
      throw new Error('MANUAL_PROVENANCE_INVALID');
  }
  for (const row of value.overrides)
    if (
      !Array.isArray(row.gates) ||
      row.gates.length === 0 ||
      row.gates.some((gate) => !manualGates.includes(gate))
    )
      throw new Error('MANUAL_PROVENANCE_INVALID');
  return true;
}
