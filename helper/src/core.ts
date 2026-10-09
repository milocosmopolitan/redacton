import type { ScanAndRedactOptions } from '@redact-secret/core';
import canonicalTypes from './canonical-types.json' with { type: 'json' };
export const CANONICAL_TYPES = Object.freeze(canonicalTypes);
export const ENGINE_VERSION = '0.1.0-beta.14';
export const POLICY_ID = 'credentials-alpha1';
export const LIMITS = Object.freeze({
  inputBytes: 256 * 1024,
  segments: 256,
  findings: 1000,
  outputBytes: 2 * 1024 * 1024,
  timeoutMs: 2000,
});
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TYPES = new Set(CANONICAL_TYPES);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> =>
  record(value) &&
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const array = (value: unknown): value is unknown[] => Array.isArray(value);
const policy = Object.freeze({
  evaluate: (finding: { type: string }): 'block' | 'redact' =>
    finding.type === 'private_key' ? 'block' : 'redact',
});

export function failure(
  requestId: string | null = null,
  errorCode = 'INVALID_REQUEST',
  status: 'failed' | 'blocked' = 'failed',
) {
  return {
    protocolVersion: 1,
    requestId,
    status,
    engineVersion: ENGINE_VERSION,
    policyId: POLICY_ID,
    errorCode,
  };
}

type Segment = { id: string; text: string };
type Request = { protocolVersion: 1; requestId: string; policyId: string } & (
  | { operation: 'self-check' }
  | { operation: 'sanitize'; segments: Segment[] }
);
export function validateRequest(request: unknown): Request {
  if (
    !record(request) ||
    request.protocolVersion !== 1 ||
    typeof request.requestId !== 'string' ||
    !ID.test(request.requestId) ||
    request.policyId !== POLICY_ID
  )
    throw new Error('INVALID_REQUEST');
  if (request.operation === 'self-check') {
    if (
      !keys(request, ['protocolVersion', 'requestId', 'operation', 'policyId'])
    )
      throw new Error('INVALID_REQUEST');
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      policyId: POLICY_ID,
      operation: 'self-check',
    };
  }
  if (
    request.operation !== 'sanitize' ||
    !keys(request, [
      'protocolVersion',
      'requestId',
      'operation',
      'policyId',
      'segments',
    ]) ||
    !array(request.segments) ||
    request.segments.length < 1 ||
    request.segments.length > LIMITS.segments
  )
    throw new Error('INVALID_REQUEST');
  const seen = new Set<string>();
  const segments: Segment[] = [];
  let bytes = 0;
  for (const segment of request.segments) {
    if (
      !keys(segment, ['id', 'text']) ||
      typeof segment.id !== 'string' ||
      !ID.test(segment.id) ||
      seen.has(segment.id) ||
      typeof segment.text !== 'string'
    )
      throw new Error('INVALID_REQUEST');
    segments.push({ id: segment.id, text: segment.text });
    seen.add(segment.id);
    bytes += Buffer.byteLength(segment.text, 'utf8');
    if (bytes > LIMITS.inputBytes) throw new Error('INPUT_LIMIT');
  }
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    policyId: POLICY_ID,
    operation: 'sanitize',
    segments,
  };
}

export interface Engine {
  VERSION: string;
  initialize(): Promise<void>;
  artifact(): unknown;
  scanAndRedact(text: string, options: ScanAndRedactOptions): unknown;
}
export async function processRequest(value: unknown, engine: Engine) {
  let request: Request;
  try {
    request = validateRequest(value);
  } catch (error) {
    return failure(
      null,
      error instanceof Error && error.message === 'INPUT_LIMIT'
        ? 'INPUT_LIMIT'
        : 'INVALID_REQUEST',
    );
  }
  try {
    if (engine.VERSION !== ENGINE_VERSION)
      return failure(request.requestId, 'ENGINE_VERSION');
    await engine.initialize();
    const artifact = engine.artifact();
    if (artifact !== 'addon' && artifact !== 'wasm')
      return failure(request.requestId, 'ENGINE_UNAVAILABLE');
    if (request.operation === 'self-check')
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: 'ok',
        engineVersion: ENGINE_VERSION,
        policyId: POLICY_ID,
        artifact,
        findingCounts: {},
      };
    const segments = [];
    const findingCounts: Record<string, number> = Object.create(null);
    let total = 0;
    for (const segment of request.segments) {
      // Engine budgets must be positive; the aggregate check still refuses any extra finding.
      const result = engine.scanAndRedact(segment.text, {
        policy,
        limits: {
          maxInputBytes: LIMITS.inputBytes,
          maxFindings: Math.max(1, LIMITS.findings - total),
        },
      });
      if (
        !record(result) ||
        typeof result.text !== 'string' ||
        !array(result.findings)
      )
        return failure(request.requestId, 'ENGINE_RESPONSE');
      total += result.findings.length;
      if (total > LIMITS.findings)
        return failure(request.requestId, 'FINDING_LIMIT');
      let blocked = false;
      for (const finding of result.findings) {
        if (
          !record(finding) ||
          typeof finding.type !== 'string' ||
          typeof finding.action !== 'string' ||
          !TYPES.has(finding.type) ||
          !['redact', 'block'].includes(finding.action)
        )
          return failure(request.requestId, 'POLICY_FAILURE');
        if (finding.type === 'private_key' || finding.action === 'block')
          blocked = true;
        findingCounts[finding.type] = (findingCounts[finding.type] ?? 0) + 1;
      }
      if (blocked)
        return failure(request.requestId, 'PRIVATE_KEY_BLOCKED', 'blocked');
      segments.push({ id: segment.id, text: result.text });
    }
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      status: 'ok',
      engineVersion: ENGINE_VERSION,
      policyId: POLICY_ID,
      artifact,
      segments,
      findingCounts,
    };
  } catch {
    return failure(request.requestId, 'ENGINE_FAILURE');
  }
}

export function encodeResponse(response: { requestId: string | null }) {
  const json = JSON.stringify(response);
  return Buffer.byteLength(json, 'utf8') > LIMITS.outputBytes
    ? JSON.stringify(failure(response.requestId, 'OUTPUT_LIMIT'))
    : json;
}
