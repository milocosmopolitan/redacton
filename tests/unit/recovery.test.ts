import assert from 'node:assert/strict';
import test from 'node:test';
import { failureScope } from '../../mod/recovery.ts';

test('unknown or non-sanitize refusal codes cannot be treated as harmless event failures', () => {
  for (const code of [
    'CANCELLED',
    'QUEUE_SATURATED',
    'UNSUPPORTED_SHAPE',
    'FINDING_LIMIT',
    'PRIVATE_KEY_BLOCKED',
  ]) {
    assert.equal(failureScope('sanitize', code), 'operation');
    assert.equal(failureScope('self-check', code), 'scanner');
  }
  for (const code of [
    'TIMEOUT',
    'ENGINE_FAILURE',
    'INVALID_HELPER_RESPONSE',
    'synthetic arbitrary diagnostic',
    'finding_limit',
  ])
    assert.equal(failureScope('sanitize', code), 'scanner');
});
