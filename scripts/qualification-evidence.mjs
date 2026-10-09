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
export const gateCodes = {
  passed: ['PASS', 'MANUAL_REVIEWED_PASS'],
  failed: ['PROBE_FAILED', 'TIMEOUT', 'PROCESS_FAILED'],
  blocked: [
    'MANUAL_REQUIRED',
    'PLATFORM_UNAVAILABLE',
    'NOT_RUN',
    'RACE_PHASE_UNAVAILABLE',
    'PREREQUISITE_UNAVAILABLE',
  ],
};
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
    value.environment !== (value.platform === 'wsl' ? 'wsl2' : 'native') ||
    !value.gates ||
    !value.gateCodes ||
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
          'environment',
          'gates',
          'gateCodes',
        ].includes(key),
    ) ||
    Object.keys(value.gates).some((key) => !requiredGates.includes(key)) ||
    Object.keys(value.gateCodes).some((key) => !requiredGates.includes(key)) ||
    requiredGates.some(
      (key) =>
        !['passed', 'failed', 'blocked'].includes(value.gates[key]) ||
        !gateCodes[value.gates[key]]?.includes(value.gateCodes[key]),
    )
  )
    throw new Error('EVIDENCE_INVALID');
  return requiredGates.every((key) => value.gates[key] === 'passed');
}
