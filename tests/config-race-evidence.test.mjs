import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configRaceDiagnostics,
  configRaceRow,
  validateConfigRaceReport,
} from '../scripts/config-race-evidence.mjs';

const source = 'a'.repeat(64);
const row = {
  status: 'passed',
  stage: 'complete',
  appliedWhileHeld: true,
  executions: 2,
  stdoutSanitizes: 2,
  modelRequests: 4,
  auxiliaryRequests: 0,
  oldConfigurationObserved: true,
  newConfigurationObserved: true,
  firstRawObserved: true,
  secondMaskedObserved: true,
  toolResultCount: 2,
  toolResultsSuccessful: true,
  privateEveryRequest: true,
  endpointFailed: false,
};
test('config race requires actual Apply, both captured policies and privacy of every request', () => {
  const report = { hostVersion: '2.1.294', modSourceSha256: source, row };
  assert.equal(validateConfigRaceReport(report, source, 0), row);
  for (const key of [
    'appliedWhileHeld',
    'oldConfigurationObserved',
    'newConfigurationObserved',
    'privateEveryRequest',
    'secondMaskedObserved',
  ])
    assert.equal(configRaceRow({ ...row, [key]: false }), null);
  assert.throws(() => validateConfigRaceReport(report, 'b'.repeat(64), 0));
  assert.throws(() => validateConfigRaceReport(report, source, 1));
  assert.equal(configRaceRow({ ...row, stdoutSanitizes: 3 }), null);
});
test('failed observations stay finite and reject extra or arbitrary fields', () => {
  const failed = {
    ...row,
    status: 'failed',
    stage: 'second',
    executions: 1,
    modelRequests: 2,
    toolResultCount: 1,
    newConfigurationObserved: false,
    secondMaskedObserved: false,
    toolResultsSuccessful: false,
    endpointFailed: true,
  };
  assert.equal(configRaceRow(failed), failed);
  for (const value of [
    { ...failed, raw: 'private text' },
    { ...failed, stage: 'arbitrary text' },
    { ...failed, modelRequests: 999 },
    { ...failed, endpointFailed: 'private text' },
  ])
    assert.equal(configRaceRow(value), null);
  assert.deepEqual(
    configRaceDiagnostics(
      JSON.stringify({ code: 'CONFIG_RACE_ROW', ...failed }),
    ),
    [{ code: 'CONFIG_RACE_ROW', ...failed }],
  );
  assert.deepEqual(
    configRaceDiagnostics(
      JSON.stringify({
        code: 'CONFIG_RACE_ROW',
        ...failed,
        raw: 'private text',
      }),
    ),
    [],
  );
});
