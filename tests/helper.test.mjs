import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { processRequest, encodeResponse, LIMITS, ENGINE_VERSION, POLICY_ID } from '../helper/src/core.mjs';

const request = (segments = [{ id: 's0', text: 'synthetic plain text' }]) => ({ protocolVersion: 1, requestId: 'request_1', operation: 'sanitize', policyId: POLICY_ID, segments });
const stub = scanAndRedact => ({ VERSION: ENGINE_VERSION, initialize: async () => {}, artifact: () => 'addon', scanAndRedact });

test('strict requests reject duplicate IDs, extra fields, incorrect versions and aggregate UTF-8 limits before engine calls', async () => {
  let calls = 0;
  const engine = stub(() => { calls++; throw new Error('must not run'); });
  for (const invalid of [ { ...request(), extra: true }, { ...request(), protocolVersion: 2 }, request([{ id: 'same', text: '' }, { id: 'same', text: '' }]), request([{ id: 's0', text: 'é'.repeat(131073) }]), request(Array.from({ length: 257 }, (_, i) => ({ id: `s${i}`, text: '' }))) ]) assert.notEqual((await processRequest(invalid, engine)).status, 'ok');
  assert.equal(calls, 0);
});

test('all recognized findings use explicit redaction; private key blocks whole batch without partial output', async () => {
  const engine = stub((text, options) => {
    const type = text === 'key fixture' ? 'private_key' : 'contextual_secret';
    const action = options.policy.evaluate({ type });
    return { text: '[REDACTED]', findings: [{ type, action }] };
  });
  const result = await processRequest(request(), engine);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.segments, [{ id: 's0', text: '[REDACTED]' }]);
  assert.deepEqual({ ...result.findingCounts }, { contextual_secret: 1 });
  const blocked = await processRequest(request([{ id: 's0', text: 'first' }, { id: 's1', text: 'key fixture' }]), engine);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.errorCode, 'PRIVATE_KEY_BLOCKED');
  assert.equal(blocked.segments, undefined);
});

test('engine failures and unexpected policy actions expose fixed codes only', async () => {
  const thrown = await processRequest(request(), stub(() => { throw new Error('sensitive-path-and-input'); }));
  assert.equal(thrown.errorCode, 'ENGINE_FAILURE');
  assert.equal(JSON.stringify(thrown).includes('sensitive-path'), false);
  const warned = await processRequest(request(), stub(() => ({ text: 'unchanged', findings: [{ type: 'contextual_secret', action: 'warn' }] })));
  assert.equal(warned.errorCode, 'POLICY_FAILURE');
  assert.equal(warned.segments, undefined);
});

test('aggregate findings and output limits withhold complete response', async () => {
  const overflow = await processRequest(request(), stub(() => ({ text: 'x', findings: Array.from({ length: 1001 }, () => ({ type: 'contextual_secret', action: 'redact' })) })));
  assert.equal(overflow.errorCode, 'FINDING_LIMIT');
  const encoded = encodeResponse({ requestId: 'request_1', segments: [{ text: 'x'.repeat(LIMITS.outputBytes) }] });
  assert.equal(JSON.parse(encoded).errorCode, 'OUTPUT_LIMIT');
});

test('self-check reports readiness and exact version without text; mismatched version fails', async () => {
  const self = { protocolVersion: 1, requestId: 'check_1', operation: 'self-check', policyId: POLICY_ID };
  const result = await processRequest(self, stub(() => { throw new Error('no scan'); }));
  assert.equal(result.status, 'ok');
  assert.equal(result.engineVersion, ENGINE_VERSION);
  assert.equal(result.segments, undefined);
  assert.equal((await processRequest(self, { VERSION: 'wrong' })).errorCode, 'ENGINE_VERSION');
});

test('CLI rejects trailing JSON and malformed UTF-8 without stderr', () => {
  for (const input of ['{} {}', Buffer.from([0xff])]) {
    const result = spawnSync(process.execPath, ['helper/src/index.mjs'], { input, encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).errorCode, 'INVALID_JSON');
  }
});
