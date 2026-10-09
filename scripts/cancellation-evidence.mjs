const modes = ['before-tool-helper', 'during-tool-helper'];
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys;
export function cancellationRow(value) {
  if (!modes.includes(value?.mode)) return null;
  if (
    exact(value, 'code,mode,status') &&
    value.code === 'CANCELLATION_PROBE_FAILED' &&
    value.status === 'failed'
  )
    return value;
  if (
    !exact(
      value,
      'auxiliaryRequests,cancelReceipt,childExitCode,cliResponded,deadlineMs,endpointFailed,helperAliveAfterDeadline,helperAliveAtSignal,helperStoppedMs,interruptSent,mode,protectedMarkerAbsentEveryRequest,requestsAfterSignal,requestsBeforeSignal,stage,stageReached,startupDiagnostics,status,terminalBytes,toolResultCount',
    ) ||
    !['passed', 'failed'].includes(value.status) ||
    !(
      value.childExitCode === null ||
      (Number.isSafeInteger(value.childExitCode) &&
        value.childExitCode >= -255 &&
        value.childExitCode <= 0xffffffff)
    ) ||
    !Number.isSafeInteger(value.terminalBytes) ||
    value.terminalBytes < 0 ||
    value.terminalBytes > 65536 ||
    !Array.isArray(value.startupDiagnostics) ||
    value.startupDiagnostics.length > 14 ||
    new Set(value.startupDiagnostics).size !==
      value.startupDiagnostics.length ||
    !value.startupDiagnostics.every((word) =>
      [
        'Protect unavailable',
        'Protect loading',
        'Protect ready',
        'unknown option',
        'only supported',
        'permission-mode',
        'API key',
        'trust',
        'Welcome',
        'Error',
        'SyntaxError',
        'ReferenceError',
        'node',
        'Bun',
      ].includes(word),
    ) ||
    !['startup', 'waiting', 'interrupted', 'status', 'complete'].includes(
      value.stage,
    ) ||
    ![
      'cancelReceipt',
      'cliResponded',
      'interruptSent',
      'stageReached',
      'endpointFailed',
      'protectedMarkerAbsentEveryRequest',
    ].every((key) => typeof value[key] === 'boolean') ||
    ![
      'requestsBeforeSignal',
      'requestsAfterSignal',
      'toolResultCount',
      'auxiliaryRequests',
    ].every(
      (key) =>
        Number.isSafeInteger(value[key]) &&
        value[key] >= 0 &&
        value[key] <= 128,
    ) ||
    !['helperAliveAtSignal', 'helperAliveAfterDeadline'].every(
      (key) => value[key] === null || typeof value[key] === 'boolean',
    ) ||
    !(
      value.helperStoppedMs === null ||
      (Number.isSafeInteger(value.helperStoppedMs) &&
        value.helperStoppedMs >= 0 &&
        value.helperStoppedMs <= 45000)
    ) ||
    value.deadlineMs !== 1000
  )
    return null;
  if (
    value.status === 'passed' &&
    !(
      !value.endpointFailed &&
      value.protectedMarkerAbsentEveryRequest &&
      value.stage === 'complete' &&
      value.stageReached &&
      value.interruptSent &&
      value.cancelReceipt &&
      value.cliResponded &&
      value.requestsBeforeSignal === 1 &&
      value.requestsAfterSignal === 0 &&
      value.toolResultCount === 0 &&
      (value.mode === 'before-tool-helper'
        ? value.helperAliveAtSignal === null &&
          value.helperAliveAfterDeadline === null &&
          value.helperStoppedMs === null
        : value.helperAliveAtSignal === true &&
          value.helperAliveAfterDeadline === false &&
          value.helperStoppedMs !== null &&
          value.helperStoppedMs <= 1000)
    )
  )
    return null;
  return value;
}
export function cancellationReport(value) {
  if (
    !exact(value, 'hostVersion,rows') ||
    value.hostVersion !== '2.1.294' ||
    !Array.isArray(value.rows) ||
    value.rows.length !== 2 ||
    new Set(value.rows.map((row) => row?.mode)).size !== 2 ||
    !value.rows.every(cancellationRow)
  )
    return null;
  return value.rows;
}

export function cancellationDiagnostics(stdout) {
  const output = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 4096) continue;
    try {
      const value = JSON.parse(line);
      if (exact(value, 'code') && value.code === 'CANCELLATION_PROBE_FAILED')
        output.push(value);
      else if (value?.code === 'CANCELLATION_ROW') {
        const { code, ...row } = value;
        if (cancellationRow(row)) output.push({ code, ...row });
      }
    } catch {}
    if (output.length === 4) break;
  }
  return output;
}
