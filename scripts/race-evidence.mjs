const keys =
  'code,direction,executions,finalScans,finalStage,firstScans,gateCode,modelRequests,phaseVerified,status,toggleObserved';
const stages = [
  'startup',
  'initial',
  'hold',
  'toggle',
  'first',
  'first-report',
  'second',
  'second-report',
  'complete',
];
const integer = (value, min, max) =>
  Number.isSafeInteger(value) && value >= min && value <= max;

export function raceDiagnostics(stdout) {
  if (typeof stdout !== 'string' || stdout.length > 1024 * 1024) return [];
  const rows = [];
  for (const line of stdout.split('\n')) {
    if (rows.length === 2) break;
    if (line.length > 4096) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === 'code,gateCode' &&
      value.code === 'INTERACTIVE_RACE_FAILURE' &&
      [
        'PREREQUISITE_UNAVAILABLE',
        'TIMEOUT',
        'HARNESS_FAILED',
        'REPORT_INVALID',
      ].includes(value.gateCode)
    ) {
      rows.push(value);
      continue;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== keys ||
      value.code !== 'INTERACTIVE_RACE_ROW' ||
      !['on-to-off', 'off-to-on'].includes(value.direction) ||
      !stages.includes(value.finalStage) ||
      !['passed', 'blocked', 'failed'].includes(value.status) ||
      value.gateCode !==
        {
          passed: 'RACE_PASSED',
          blocked: 'RACE_PHASE_UNAVAILABLE',
          failed: 'RACE_BOUNDARY_FAILED',
        }[value.status] ||
      typeof value.phaseVerified !== 'boolean' ||
      typeof value.toggleObserved !== 'boolean' ||
      !integer(value.executions, 0, 8) ||
      !integer(value.modelRequests, 0, 8) ||
      !integer(value.firstScans, -1, 1000) ||
      !integer(value.finalScans, -1, 1000)
    )
      continue;
    rows.push(value);
    if (rows.length === 2) break;
  }
  return rows;
}
