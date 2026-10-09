import { validateEvidence } from './qualification-evidence.mjs';

export const manualGates = [
  'terminal-ui',
  'config-races',
  'toggle-races',
  'cancellation',
];
export function mergeManualEvidence(
  base,
  attestation,
  sourceSha,
  artifactSha256,
) {
  if (
    attestation?.schemaVersion !== 1 ||
    attestation.sourceSha !== sourceSha ||
    attestation.artifactSha256 !== artifactSha256 ||
    attestation.reviewed !== true ||
    !Array.isArray(attestation.rows) ||
    attestation.rows.length > 14 ||
    Object.keys(attestation).some(
      (key) =>
        ![
          'schemaVersion',
          'sourceSha',
          'artifactSha256',
          'reviewed',
          'rows',
        ].includes(key),
    )
  )
    throw new Error('MANUAL_EVIDENCE_INVALID');
  const rows = new Map();
  for (const record of base) {
    validateEvidence(record, sourceSha);
    if (record.artifactSha256 !== artifactSha256)
      throw new Error('MANUAL_ARTIFACT_MISMATCH');
    const id = `${record.platform}-${record.arch}-${record.node}`;
    if (rows.has(id)) throw new Error('MANUAL_BASE_DUPLICATE');
    rows.set(id, structuredClone(record));
  }
  const seen = new Set();
  for (const item of attestation.rows) {
    if (
      !item ||
      Object.keys(item).some(
        (key) => !['platform', 'arch', 'node', 'gates'].includes(key),
      ) ||
      !item.gates ||
      Object.keys(item.gates).length === 0
    )
      throw new Error('MANUAL_EVIDENCE_INVALID');
    const id = `${item.platform}-${item.arch}-${item.node}`;
    if (seen.has(id) || !rows.has(id)) throw new Error('MANUAL_ROW_INVALID');
    seen.add(id);
    const record = rows.get(id);
    for (const [gate, status] of Object.entries(item.gates)) {
      if (
        !manualGates.includes(gate) ||
        status !== 'passed' ||
        record.gates[gate] !== 'blocked' ||
        (gate === 'cancellation' && record.platform !== 'win32')
      )
        throw new Error('MANUAL_GATE_INVALID');
      record.gates[gate] = 'passed';
      if (record.gateCodes) record.gateCodes[gate] = 'MANUAL_REVIEWED_PASS';
    }
    validateEvidence(record, sourceSha);
  }
  return [...rows.values()];
}
