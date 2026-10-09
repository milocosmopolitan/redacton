import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigController } from '../../mod/config.ts';
import {
  type ConfigurationRequest,
  ENGINE_VERSION,
  POLICY_ID,
  validateProcessResponse,
} from '../../mod/protocol.ts';

test('preview preserves actual built-in redaction when a custom recipe requests block', () => {
  const config = new ConfigController({
    schemaVersion: 1,
    rules: [
      {
        kind: 'token',
        id: 'internal_gh',
        prefix: 'ghp_',
        alphabet: 'alnum',
        run: { kind: 'exact', length: 36 },
        specificity: 'entropy',
        validator: 'none',
        action: 'block',
      },
    ],
  }).snapshot();
  const request: ConfigurationRequest = {
    protocolVersion: 2,
    requestId: 'overlap',
    operation: 'preview',
    policyId: POLICY_ID,
    config,
  };
  const response = {
    protocolVersion: 2,
    requestId: request.requestId,
    configRevision: config.revision,
    status: 'ok',
    engineVersion: ENGINE_VERSION,
    policyId: POLICY_ID,
    artifact: 'addon',
    outcomes: [
      {
        id: 'internal_gh',
        positive: {
          detected: true,
          action: 'redact',
          findingCounts: { github_token: 1 },
        },
        negative: { detected: false, action: 'none', findingCounts: {} },
      },
    ],
  };
  const result = validateProcessResponse(
    {
      exitCode: 0,
      stdout: JSON.stringify(response),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
    request,
  );
  assert.equal(config.rules[0]?.action, 'block');
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok')
    assert.fail('actual preview metadata was withheld');
  assert.equal(result.outcomes?.[0]?.positive.action, 'redact');
  assert.deepEqual(result.outcomes?.[0]?.positive.findingCounts, {
    github_token: 1,
  });
});
