import assert from 'node:assert/strict';
import test from 'node:test';
import { faultDiagnostics } from '../scripts/fault-evidence.mjs';

test('fault diagnostics reject raw fields, arbitrary codes and unbounded counts', () => {
  const state = {
    code: 'FAULT_PROBE_STATE',
    mode: 'invalid-json',
    preflightExitCode: 0,
    preflightOn: true,
    preflightRequests: 0,
    exitCode: 0,
    requests: 2,
    toolResultCount: 1,
    rawInToolResults: false,
    toolResultIsError: true,
    fixedWithholdCode: true,
    executions: 1,
    completed: true,
    timeoutChildAlive: null,
    readinessUnavailable: false,
  };
  assert.equal(faultDiagnostics(JSON.stringify(state)).length, 1);
  const code = { code: 'FAULT_BOUNDARY_FAILED', mode: 'invalid-json' };
  assert.deepEqual(faultDiagnostics(JSON.stringify(code)), [code]);
  for (const patch of [
    { payload: 'private' },
    { mode: 'private' },
    { requests: 129 },
    { exitCode: 'private' },
    { completed: 'private' },
  ])
    assert.deepEqual(
      faultDiagnostics(JSON.stringify({ ...state, ...patch })),
      [],
    );
  assert.deepEqual(faultDiagnostics('private stderr'), []);
});
