import assert from 'node:assert/strict';
import test from 'node:test';
import {
  helperOutcome,
  register,
} from '../qualification/config-race-companion/hooks/register.js';
import {
  configHelperDiagnostic,
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

test('helper outcomes classify only real delegated reply fields and preserve failures', async () => {
  const request = {
    protocolVersion: 2,
    operation: 'sanitize',
    requestId: 'synthetic-request',
    policyId: 'credentials-alpha1',
    config: { revision: 'cfg-1-1', rules: [] },
    segments: [{ id: 'stdout' }],
  };
  const reply = {
    protocolVersion: 2,
    requestId: request.requestId,
    policyId: request.policyId,
    configRevision: request.config.revision,
    engineVersion: '0.1.0-beta.14',
    status: 'ok',
  };
  const result = {
    value: {
      exitCode: 0,
      stdout: JSON.stringify(reply),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  };
  assert.equal(helperOutcome(result, request, 2000).outcome, 'DECLARED_OK');
  assert.equal(helperOutcome(result, request, 2000).elapsedBucket, 3);
  const missingIdentity = helperOutcome(
    {
      value: {
        ...result.value,
        stdout: JSON.stringify({
          status: 'ok',
          engineVersion: '0.1.0-beta.14',
        }),
      },
    },
    {},
    1,
  );
  assert.equal(missingIdentity.identityMatched, false);
  assert.equal(missingIdentity.outcome, 'IDENTITY_MISMATCH');
  assert.equal(
    helperOutcome({ value: { ...result.value, stdout: '{' } }, request, 1)
      .outcome,
    'INVALID_JSON',
  );
  assert.equal(
    helperOutcome(
      { value: { ...result.value, stderr: 'private marker' } },
      request,
      1,
    ).outcome,
    'STDERR_PRESENT',
  );
  assert.equal(
    helperOutcome(
      {
        value: {
          ...result.value,
          stdout: JSON.stringify({
            ...reply,
            status: 'failed',
            errorCode: 'TIMEOUT',
          }),
        },
      },
      request,
      1,
    ).outcome,
    'DECLARED_TIMEOUT',
  );
  const handlers = {};
  register((event, ...args) => {
    handlers[event] = args.at(-1);
  });
  const event = { init: { stdin: JSON.stringify(request) } };
  let delegated = 0;
  assert.equal(
    await handlers['process.run'](null, event, async (observed) => {
      assert.equal(observed, event);
      delegated++;
      return result;
    }),
    result,
  );
  const failure = Error('private exception marker');
  await assert.rejects(
    handlers['process.run'](null, event, async () => {
      delegated++;
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(delegated, 2);
  const receipt = handlers['command.run']().text;
  assert.match(receipt, /CONFIG_HELPER_1_DECLARED_OK_0_/);
  assert.match(receipt, /CONFIG_HELPER_2_PROCESS_REJECTED_N_/);
  assert.doesNotMatch(receipt, /private|marker/);
});

test('strict helper diagnostics reject raw fields, fabricated enums and oversized values', () => {
  const value = {
    code: 'CONFIG_HELPER_DIAGNOSTICS',
    helpers: [
      {
        ordinal: 2,
        outcome: 'PROCESS_REJECTED',
        exitCode: null,
        elapsedBucket: 3,
        stdoutTruncated: false,
        stderrTruncated: false,
        stderrPresent: false,
        identityMatched: false,
      },
    ],
    secondToolCode: 'REDACTON_WITHHELD',
  };
  assert.equal(configHelperDiagnostic(value), value);
  assert.deepEqual(configRaceDiagnostics(JSON.stringify(value)), [value]);
  for (const mutate of [
    (v) => {
      v.helpers[0].stdout = 'private';
    },
    (v) => {
      v.helpers[0].outcome = 'private';
    },
    (v) => {
      v.helpers[0].elapsedBucket = 5000;
    },
    (v) => {
      v.helpers[0].exitCode = 2147483648;
    },
    (v) => {
      v.helpers.push({ ...v.helpers[0] });
    },
    (v) => {
      v.secondToolCode = 'private';
    },
  ]) {
    const invalid = structuredClone(value);
    mutate(invalid);
    assert.equal(configHelperDiagnostic(invalid), null);
    assert.deepEqual(configRaceDiagnostics(JSON.stringify(invalid)), []);
  }
});
