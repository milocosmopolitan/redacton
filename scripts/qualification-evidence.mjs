export const requiredGates = [
  'sdk',
  'package',
  'prompt',
  'read',
  'bash',
  'off',
  'guarded-errors',
  'permission-denial',
  'sessions',
  'cancellation',
  'toggle-races',
  'config-races',
  'terminal-ui',
];
export function validateEvidence(value, sourceSha) {
  if (
    value?.schemaVersion !== 1 ||
    value.sourceSha !== sourceSha ||
    !/^[a-f0-9]{64}$/.test(value.artifactSha256) ||
    !/^[a-f0-9]{40}$/.test(sourceSha) ||
    !/^v?\d+\.\d+\.\d+$/.test(value.version) ||
    !['v22.16.0', 'v24.21.0'].includes(value.node) ||
    value.claude !== '2.1.294' ||
    value.engine !== '0.1.0-beta.14' ||
    !['darwin', 'linux', 'win32', 'wsl'].includes(value.platform) ||
    !['x64', 'arm64'].includes(value.arch) ||
    value.emulated !== false ||
    !value.gates ||
    Object.keys(value).some(
      (key) =>
        ![
          'schemaVersion',
          'sourceSha',
          'artifactSha256',
          'version',
          'node',
          'claude',
          'engine',
          'platform',
          'arch',
          'emulated',
          'gates',
        ].includes(key),
    ) ||
    Object.keys(value.gates).some((key) => !requiredGates.includes(key)) ||
    requiredGates.some(
      (key) => !['passed', 'failed', 'blocked'].includes(value.gates[key]),
    )
  )
    throw new Error('EVIDENCE_INVALID');
  return requiredGates.every((key) => value.gates[key] === 'passed');
}
