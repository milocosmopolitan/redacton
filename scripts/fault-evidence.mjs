const modes = new Set([
  'invalid-json',
  'mismatch-id',
  'duplicate-id',
  'missing-id',
  'unknown-status',
  'missing-helper',
  'timeout',
  'policy-failure',
  'output-truncated',
  'prompt-invalid',
  'missing-node',
]);
const codes = new Set([
  'FAULT_PROBE_FAILED',
  'FAULT_PREFLIGHT_FAILED',
  'FAULT_BOUNDARY_FAILED',
  'INVALID_TIMEOUT_PID',
  'TIMEOUT_PID_CHECK_FAILED',
  'MISSING_NODE_NOT_UNAVAILABLE',
]);
const counts = [
  'preflightRequests',
  'requests',
  'toolResultCount',
  'executions',
];
const booleans = [
  'preflightOn',
  'rawInToolResults',
  'toolResultIsError',
  'fixedWithholdCode',
  'completed',
  'readinessUnavailable',
];
const stateKeys = [
  'code',
  'mode',
  'preflightExitCode',
  'preflightOn',
  'preflightRequests',
  'exitCode',
  'requests',
  'toolResultCount',
  'rawInToolResults',
  'toolResultIsError',
  'fixedWithholdCode',
  'executions',
  'completed',
  'timeoutChildAlive',
  'readinessUnavailable',
]
  .sort()
  .join(',');
const exitCode = (value) =>
  value === null ||
  (Number.isSafeInteger(value) && value >= -1 && value <= 255);

export function faultDiagnostics(stdout) {
  const output = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 4096) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !modes.has(value.mode)
    )
      continue;
    const keys = Object.keys(value).sort().join(',');
    if (keys === 'code,mode' && codes.has(value.code))
      output.push({ code: value.code, mode: value.mode });
    else if (
      keys === stateKeys &&
      value.code === 'FAULT_PROBE_STATE' &&
      exitCode(value.preflightExitCode) &&
      exitCode(value.exitCode) &&
      counts.every(
        (key) =>
          Number.isSafeInteger(value[key]) &&
          value[key] >= 0 &&
          value[key] <= 128,
      ) &&
      booleans.every((key) => typeof value[key] === 'boolean') &&
      (value.timeoutChildAlive === null ||
        typeof value.timeoutChildAlive === 'boolean')
    ) {
      output.push(
        Object.fromEntries(
          stateKeys.split(',').map((key) => [key, value[key]]),
        ),
      );
    }
    if (output.length === 24) break;
  }
  return output;
}
