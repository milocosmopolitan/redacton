import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HelperRequest, HelperResponse } from '../../mod/protocol.ts';
import {
  ENGINE_VERSION,
  LIMITS,
  makeRequest,
  POLICY_ID,
  validateProcessResponse,
} from '../../mod/protocol.ts';

const request = () => {
  const value = makeRequest('request_1', [
    { id: 's0', text: 'ordinary text' },
    { id: 's1', text: '' },
  ]);
  assert.ok(value);
  return value;
};
interface FixtureResponse {
  protocolVersion: number;
  requestId?: unknown;
  status?: unknown;
  engineVersion?: unknown;
  policyId?: unknown;
  artifact?: unknown;
  segments?: Record<string, unknown>[];
  findingCounts: unknown;
  [key: string]: unknown;
}
const response = (): FixtureResponse => ({
  protocolVersion: 1,
  requestId: 'request_1',
  status: 'ok',
  engineVersion: ENGINE_VERSION,
  policyId: POLICY_ID,
  artifact: 'addon',
  segments: [
    { id: 's0', text: 'sanitized' },
    { id: 's1', text: '' },
  ],
  findingCounts: {},
});
const processResult = (value: unknown) => ({
  exitCode: 0,
  stdout: JSON.stringify(value),
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
});
const check = (value: unknown, req: HelperRequest = request()) =>
  validateProcessResponse(processResult(value), req);
const invalid = (value: HelperResponse) => {
  assert.ok(value.status !== 'ok');
  assert.equal(value.errorCode, 'INVALID_HELPER_RESPONSE');
};
const segment = (
  value: FixtureResponse,
  index: number,
): Record<string, unknown> => {
  const item = value.segments?.[index];
  assert.ok(item);
  return item;
};

test('request identity, segment correspondence and exact response fields are mandatory', () => {
  assert.equal(check(response()).status, 'ok');
  const transformations: ((r: FixtureResponse) => void)[] = [
    (r) => {
      delete r.requestId;
    },
    (r) => {
      r.requestId = 'other';
    },
    (r) => {
      delete r.segments;
    },
    (r) => {
      r.segments?.pop();
    },
    (r) => {
      segment(r, 1).id = 's0';
    },
    (r) => {
      segment(r, 1).id = 'unrequested';
    },
    (r) => {
      delete segment(r, 0).id;
    },
    (r) => {
      delete segment(r, 0).text;
    },
    (r) => {
      segment(r, 0).original = 'raw';
    },
    (r) => {
      r.originalContent = 'raw';
    },
    (r) => {
      r.status = 'partial';
    },
    (r) => {
      r.policyId = 'other';
    },
    (r) => {
      r.engineVersion = 'other';
    },
    (r) => {
      r.artifact = 'unknown';
    },
  ];
  for (const transform of transformations) {
    const value = response();
    transform(value);
    invalid(check(value));
  }
});

test('failure statuses project fixed codes and never partial text or arbitrary metadata', () => {
  const failed = {
    protocolVersion: 1,
    requestId: 'request_1',
    status: 'failed',
    engineVersion: ENGINE_VERSION,
    policyId: POLICY_ID,
    errorCode: 'ENGINE_FAILURE',
  };
  assert.deepEqual(check(failed), {
    status: 'failed',
    errorCode: 'ENGINE_FAILURE',
  });
  assert.deepEqual(
    check({ ...failed, status: 'blocked', errorCode: 'PRIVATE_KEY_BLOCKED' }),
    { status: 'blocked', errorCode: 'PRIVATE_KEY_BLOCKED' },
  );
  for (const extra of [
    { segments: [] },
    { errorCode: 'arbitrary_exception' },
    { hash: 'opaque-but-secret-derived' },
    { detail: 'raw-path' },
    { status: 'warning' },
  ])
    invalid(check({ ...failed, ...extra }));
});

test('counts use canonical types, safe integers and exact aggregate ceiling', () => {
  const counted = check({
    ...response(),
    findingCounts: { github_token: 1000 },
  });
  assert.ok(counted.status === 'ok');
  assert.equal(counted.count, 1000);
  for (const findingCounts of [
    { github_token: 1001 },
    { github_token: 999, aws_access_key_id: 2 },
    { github_token: -1 },
    { github_token: 1.5 },
    { github_token: '1' },
    { secret_hash: 1 },
    { matched_plaintext: 1 },
    { github_token: Number.MAX_SAFE_INTEGER },
  ])
    invalid(check({ ...response(), findingCounts }));
  invalid(check({ ...response(), findingCounts: ['github_token'] }));
});

test('process failures, truncation, malformed JSON and excessive output cannot succeed', () => {
  for (const patch of [
    { exitCode: 1 },
    { isStdoutTruncated: true },
    { isStderrTruncated: true },
    { stdout: '{} {}' },
    { stdout: 'not-json' },
    { stdout: 'x'.repeat(LIMITS.outputBytes + 1) },
    { stdout: null },
    { stderr: 'arbitrary engine exception' },
    { isStdoutTruncated: 'false' },
    { isStdoutTruncated: undefined },
    { isStderrTruncated: undefined },
    { stderr: undefined },
  ])
    invalid(
      validateProcessResponse(
        { ...processResult(response()), ...patch },
        request(),
      ),
    );
});

test('self-check has no segments, requires valid artifact and zero canonical findings', () => {
  const req: HelperRequest = {
    protocolVersion: 1,
    requestId: 'request_1',
    operation: 'self-check',
    policyId: POLICY_ID,
  };
  const value = response();
  delete value.segments;
  assert.equal(check(value, req).status, 'ok');
  for (const patch of [
    { segments: [] },
    { findingCounts: { github_token: 1 } },
    { findingCounts: null },
    { artifact: undefined },
    { status: undefined },
    { requestId: null },
    { findingCounts: { unknown: 0 } },
  ])
    invalid(check({ ...value, ...patch }, req));
});

test('request event input and segment count limits count UTF-8 bytes', () => {
  assert.ok(makeRequest('req', [{ id: 's0', text: 'é'.repeat(131072) }]));
  assert.equal(
    makeRequest('req', [{ id: 's0', text: 'é'.repeat(131073) }]),
    null,
  );
  assert.equal(
    makeRequest('req', [
      { id: 's0', text: '' },
      { id: 's0', text: '' },
    ]),
    null,
  );
  assert.ok(
    makeRequest(
      'req',
      Array.from({ length: 256 }, (_, i) => ({ id: `s${i}`, text: '' })),
    ),
  );
  assert.equal(
    makeRequest(
      'req',
      Array.from({ length: 257 }, (_, i) => ({ id: `s${i}`, text: '' })),
    ),
    null,
  );
});
