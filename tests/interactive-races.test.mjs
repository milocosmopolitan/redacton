import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRaceReport } from '../scripts/qualify-races.mjs';
import { raceDiagnostics } from '../scripts/race-evidence.mjs';

const source = 'a'.repeat(64);
function report() {
  return {
    hostVersion: '2.1.294',
    modSourceSha256: source,
    results: ['on-to-off', 'off-to-on'].map((direction, index) => ({
      direction,
      status: 'passed',
      code: 'RACE_PASSED',
      finalStage: 'complete',
      phaseVerified: true,
      toggleObserved: true,
      receiptKind: 'prompt-policy',
      executions: 2,
      modelRequests: 4,
      firstScans: index === 0 ? 1 : 0,
      finalScans: 1,
      toolResultCount: 2,
      firstResultPresent: true,
      firstResultError: false,
      protectedMarkerAbsentEveryRequest: true,
    })),
  };
}
test('race evidence requires both actual phases, source, privacy and matching exit', () => {
  assert.equal(validateRaceReport(report(), source, 0).length, 2);
  for (const mutate of [
    (value) => {
      value.modSourceSha256 = 'b'.repeat(64);
    },
    (value) => {
      value.results[0].status = 'PRIVATE_UNKNOWN_STATUS';
    },
    (value) => {
      value.results[0].phaseVerified = false;
    },
    (value) => {
      value.results[0].protectedMarkerAbsentEveryRequest = false;
    },
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => validateRaceReport(value, source, 0));
  }
  assert.throws(() => validateRaceReport(report(), source, 1));
});
test('failed and blocked rows cannot leak free text through counter diagnostics', () => {
  for (const status of ['failed', 'blocked']) {
    for (const field of [
      'executions',
      'modelRequests',
      'firstScans',
      'finalScans',
    ]) {
      const value = report();
      Object.assign(value.results[0], {
        status,
        code:
          status === 'failed'
            ? 'RACE_BOUNDARY_FAILED'
            : 'RACE_PHASE_UNAVAILABLE',
        finalStage: 'toggle',
        phaseVerified: false,
        toggleObserved: false,
        executions: 1,
        modelRequests: 1,
        firstScans: -1,
        finalScans: -1,
      });
      value.results[0][field] = 'PRIVATE_PAYLOAD';
      assert.throws(() =>
        validateRaceReport(value, source, status === 'failed' ? 1 : 2),
      );
    }
  }
});
test('race diagnostic parser drops raw fields, arbitrary counters and unknown phases', () => {
  const rows = validateRaceReport(report(), source, 0);
  assert.deepEqual(
    raceDiagnostics(rows.map((row) => JSON.stringify(row)).join('\n')),
    rows,
  );
  for (const patch of [
    { executions: 'PRIVATE_PAYLOAD' },
    { finalStage: 'PRIVATE_STAGE' },
    { raw: 'PRIVATE_PAYLOAD' },
    { gateCode: 'PRIVATE_CODE' },
  ])
    assert.deepEqual(
      raceDiagnostics(JSON.stringify({ ...rows[0], ...patch })),
      [],
    );
  assert.deepEqual(
    raceDiagnostics('{"code":"INTERACTIVE_RACE_FAILURE","gateCode":"TIMEOUT"}'),
    [{ code: 'INTERACTIVE_RACE_FAILURE', gateCode: 'TIMEOUT' }],
  );
  assert.deepEqual(
    raceDiagnostics(
      '{"code":"INTERACTIVE_RACE_FAILURE","gateCode":"PRIVATE_TEXT"}',
    ),
    [],
  );
  assert.equal(
    raceDiagnostics(
      Array(20)
        .fill('{"code":"INTERACTIVE_RACE_FAILURE","gateCode":"TIMEOUT"}')
        .join('\n'),
    ).length,
    2,
  );
});
