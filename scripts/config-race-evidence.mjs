const stages = [
  'startup',
  'hold',
  'panel',
  'focus-id',
  'prefix',
  'length',
  'build',
  'validate',
  'preview',
  'apply',
  'applied',
  'close',
  'first',
  'first-report',
  'second',
  'second-report',
  'complete',
];
const booleans = [
  'appliedWhileHeld',
  'oldConfigurationObserved',
  'newConfigurationObserved',
  'firstRawObserved',
  'secondMaskedObserved',
  'toolResultsSuccessful',
  'privateEveryRequest',
  'endpointFailed',
];
const counters = {
  executions: 2,
  stdoutSanitizes: 3,
  modelRequests: 4,
  auxiliaryRequests: 4,
  toolResultCount: 2,
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export function configRaceRow(value) {
  if (
    !exact(value, ['status', 'stage', ...booleans, ...Object.keys(counters)]) ||
    !['passed', 'blocked', 'failed'].includes(value.status) ||
    !stages.includes(value.stage) ||
    !booleans.every((key) => typeof value[key] === 'boolean') ||
    !Object.entries(counters).every(
      ([key, limit]) =>
        Number.isSafeInteger(value[key]) &&
        value[key] >= 0 &&
        value[key] <= limit,
    )
  )
    return null;
  if (
    value.status === 'passed' &&
    !(
      value.stage === 'complete' &&
      booleans
        .filter((key) => key !== 'endpointFailed')
        .every((key) => value[key]) &&
      !value.endpointFailed &&
      value.executions === 2 &&
      value.stdoutSanitizes === 2 &&
      value.modelRequests === 4 &&
      value.toolResultCount === 2
    )
  )
    return null;
  if (
    value.status === 'blocked' &&
    !(
      value.stage === 'panel' &&
      value.executions === 1 &&
      value.stdoutSanitizes === 0 &&
      value.modelRequests === 1 &&
      !value.appliedWhileHeld &&
      !value.endpointFailed &&
      value.privateEveryRequest
    )
  )
    return null;
  return value;
}
export function validateConfigRaceReport(value, sourceDigest, exitCode) {
  if (
    !exact(value, ['hostVersion', 'modSourceSha256', 'row']) ||
    value.hostVersion !== '2.1.294' ||
    !/^[a-f0-9]{64}$/.test(sourceDigest) ||
    value.modSourceSha256 !== sourceDigest ||
    !configRaceRow(value.row) ||
    exitCode !== (value.row.status === 'passed' ? 0 : 1)
  )
    throw new Error('CONFIG_RACE_REPORT_INVALID');
  return value.row;
}
export function configHelperDiagnostic(value) {
  const outcomes = [
    'DECLARED_OK',
    'DECLARED_TIMEOUT',
    'DECLARED_ENGINE_UNAVAILABLE',
    'DECLARED_BLOCKED',
    'DECLARED_FAILED',
    'PROCESS_REJECTED',
    'PROCESS_DENIED',
    'PROCESS_EXIT_NONZERO',
    'PROCESS_SHAPE_INVALID',
    'STDOUT_TRUNCATED',
    'STDERR_TRUNCATED',
    'STDERR_PRESENT',
    'INVALID_JSON',
    'IDENTITY_MISMATCH',
    'STATUS_UNKNOWN',
  ];
  const flags = [
    'stdoutTruncated',
    'stderrTruncated',
    'stderrPresent',
    'identityMatched',
  ];
  if (
    !exact(value, ['code', 'helpers', 'secondToolCode']) ||
    value.code !== 'CONFIG_HELPER_DIAGNOSTICS' ||
    ![
      'SUCCESS',
      'UNKNOWN',
      'REDACTON_WITHHELD',
      'REDACTON_UNSUPPORTED_SHAPE',
      'REDACTON_TOOL_DENIED',
    ].includes(value.secondToolCode) ||
    !Array.isArray(value.helpers) ||
    value.helpers.length > 2
  )
    return null;
  let previous = 0;
  for (const helper of value.helpers) {
    if (
      !exact(helper, [
        'ordinal',
        'outcome',
        'exitCode',
        'elapsedBucket',
        ...flags,
      ]) ||
      ![1, 2].includes(helper.ordinal) ||
      helper.ordinal <= previous ||
      !outcomes.includes(helper.outcome) ||
      !(
        helper.exitCode === null ||
        (Number.isInteger(helper.exitCode) &&
          helper.exitCode >= -2147483648 &&
          helper.exitCode <= 2147483647)
      ) ||
      !Number.isInteger(helper.elapsedBucket) ||
      helper.elapsedBucket < 0 ||
      helper.elapsedBucket > 4 ||
      !flags.every((key) => typeof helper[key] === 'boolean')
    )
      return null;
    previous = helper.ordinal;
  }
  return value;
}
export function configRaceDiagnostics(stdout) {
  if (typeof stdout !== 'string' || stdout.length > 1048576) return [];
  const output = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 4096) continue;
    try {
      const value = JSON.parse(line);
      if (
        exact(value, ['code']) &&
        [
          'CONFIG_RACE_REJECTED',
          'CONFIG_RACE_PREREQUISITE_UNAVAILABLE',
        ].includes(value.code)
      )
        output.push(value);
      else if (configHelperDiagnostic(value)) output.push(value);
      else if (value?.code === 'CONFIG_RACE_ROW') {
        const { code, ...row } = value;
        if (configRaceRow(row)) output.push({ code, ...row });
      }
    } catch {}
    if (output.length === 2) break;
  }
  return output;
}
