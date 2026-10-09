import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancellationReport,
  cancellationRow,
} from '../scripts/cancellation-evidence.mjs';

const row = {
  mode: 'during-tool-helper',
  status: 'passed',
  stage: 'complete',
  stageReached: true,
  interruptSent: true,
  cancelReceipt: true,
  cliResponded: true,
  auxiliaryRequests: 0,
  requestsBeforeSignal: 1,
  requestsAfterSignal: 0,
  toolResultCount: 0,
  helperAliveAtSignal: true,
  helperAliveAfterDeadline: false,
  helperStoppedMs: 500,
  deadlineMs: 1000,
  endpointFailed: false,
  protectedMarkerAbsentEveryRequest: true,
  terminalBytes: 100,
  childExitCode: null,
  startupDiagnostics: [],
};
test('actual cancellation pass requires phase, user interrupt, no delivery, live CLI and helper death before deadline', () => {
  assert.deepEqual(cancellationRow(row), row);
  for (const patch of [
    { stageReached: false },
    { endpointFailed: true },
    { protectedMarkerAbsentEveryRequest: false },
    { endpointFailed: 'private' },
    { auxiliaryRequests: 'private' },
    { startupDiagnostics: ['private'] },
    { childExitCode: 0x100000000 },
    { interruptSent: false },
    { cancelReceipt: false },
    { cliResponded: false },
    { helperAliveAtSignal: false },
    { helperAliveAfterDeadline: true },
    { helperStoppedMs: 1001 },
    { helperStoppedMs: null },
    { toolResultCount: 1 },
    { requestsAfterSignal: 1 },
    { requestsBeforeSignal: 0 },
    { rawScreen: 'private' },
    { helperPid: 123 },
    { deadlineMs: 2000 },
  ])
    assert.equal(cancellationRow({ ...row, ...patch }), null);
});
test('both distinct cancellation phases are required and incomplete failure reports cannot pass', () => {
  const before = {
    ...row,
    mode: 'before-tool-helper',
    helperAliveAtSignal: null,
    helperAliveAfterDeadline: null,
    helperStoppedMs: null,
  };
  assert.deepEqual(
    cancellationReport({ hostVersion: '2.1.294', rows: [before, row] }),
    [before, row],
  );
  for (const value of [
    { hostVersion: '2.1.295', rows: [before, row] },
    { hostVersion: '2.1.294', rows: [row, row] },
    { hostVersion: '2.1.294', rows: [row] },
    { hostVersion: '2.1.294', rows: [before, row], raw: 'private' },
  ])
    assert.equal(cancellationReport(value), null);
  assert.equal(cancellationRow({ ...before, helperAliveAtSignal: true }), null);
  assert.deepEqual(
    cancellationRow({
      mode: row.mode,
      status: 'failed',
      code: 'CANCELLATION_PROBE_FAILED',
    }),
    { mode: row.mode, status: 'failed', code: 'CANCELLATION_PROBE_FAILED' },
  );
});
