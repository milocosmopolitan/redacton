import { canonicalTypes } from './canonical-types.ts';
import type { ActiveConfiguration } from './config.ts';
import {
  isNonnegativeInteger,
  hasOnlyKeys as keys,
  isPlainRecord as plain,
} from './validation.ts';

export interface Segment {
  id: string;
  text: string;
}
interface RequestIdentity {
  protocolVersion: 1 | 2;
  config?: ActiveConfiguration;
  requestId: string;
  policyId: string;
}
export interface SanitizeRequest extends RequestIdentity {
  operation: 'sanitize';
  segments: Segment[];
}
export interface SelfCheckRequest extends RequestIdentity {
  operation: 'self-check';
}
export interface ConfigurationRequest extends RequestIdentity {
  operation: 'validate-config' | 'preview';
  config: ActiveConfiguration;
}
export type HelperRequest =
  | SanitizeRequest
  | SelfCheckRequest
  | ConfigurationRequest;
export interface PreviewOutcome {
  id: string;
  positive: {
    detected: boolean;
    action: 'redact' | 'block' | 'none';
    findingCounts: Record<string, number>;
  };
  negative: {
    detected: boolean;
    action: 'redact' | 'block' | 'none';
    findingCounts: Record<string, number>;
  };
}
export type HelperResponse =
  | { status: 'failed' | 'blocked'; errorCode: string }
  | {
      status: 'ok';
      segments?: Segment[];
      validated?: true;
      outcomes?: PreviewOutcome[];
      configRevision?: string;
      findingCounts: Record<string, number>;
      count: number;
      artifact: 'addon' | 'wasm';
    };

export const LIMITS = Object.freeze({
  inputBytes: 262144,
  segments: 256,
  findings: 1000,
  outputBytes: 2097152,
  timeoutMs: 2000,
  settingsTimeoutMs: 5000,
  pending: 4,
});
export const POLICY_ID = 'credentials-alpha1';
export const ENGINE_VERSION = '0.1.0-beta.14';
const typeSet: ReadonlySet<string> = new Set(canonicalTypes);
const opaqueId = /^[A-Za-z0-9_-]{1,64}$/;
const codes = new Set([
  'INVALID_REQUEST',
  'INPUT_LIMIT',
  'ENGINE_VERSION',
  'ENGINE_UNAVAILABLE',
  'ENGINE_RESPONSE',
  'FINDING_LIMIT',
  'POLICY_FAILURE',
  'PRIVATE_KEY_BLOCKED',
  'ENGINE_FAILURE',
  'OUTPUT_LIMIT',
  'TIMEOUT',
  'INVALID_JSON',
  'INPUT_FAILURE',
  'RULE_BLOCKED',
  'INVALID_CONFIG',
  'NAMES_ACTION_CONFLICT',
]);

export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export function makeRequest(
  requestId: unknown,
  segments: unknown,
  config?: ActiveConfiguration,
): SanitizeRequest | null {
  if (
    typeof requestId !== 'string' ||
    !opaqueId.test(requestId) ||
    !Array.isArray(segments) ||
    segments.length > LIMITS.segments ||
    !segments.length
  )
    return null;
  const ids = new Set<string>();
  let bytes = 0;
  const validated: Segment[] = [];
  for (const segment of segments) {
    if (
      !keys(segment, ['id', 'text']) ||
      typeof segment.id !== 'string' ||
      !opaqueId.test(segment.id) ||
      typeof segment.text !== 'string' ||
      ids.has(segment.id)
    )
      return null;
    ids.add(segment.id);
    validated.push({ id: segment.id, text: segment.text });
    bytes += utf8Bytes(segment.text);
    if (bytes > LIMITS.inputBytes) return null;
  }
  const request: SanitizeRequest = {
    protocolVersion: config ? 2 : 1,
    ...(config ? { config } : {}),
    requestId,
    operation: 'sanitize',
    policyId: POLICY_ID,
    segments: validated,
  };
  return utf8Bytes(JSON.stringify(request)) <= LIMITS.inputBytes
    ? request
    : null;
}

export function validateProcessResponse(
  processResult: unknown,
  request: HelperRequest,
): HelperResponse {
  const invalid: HelperResponse = {
    status: 'failed',
    errorCode: 'INVALID_HELPER_RESPONSE',
  };
  if (
    !keys(processResult, [
      'exitCode',
      'stdout',
      'stderr',
      'isStdoutTruncated',
      'isStderrTruncated',
    ]) ||
    processResult.exitCode !== 0 ||
    processResult.isStdoutTruncated !== false ||
    processResult.isStderrTruncated !== false ||
    processResult.stderr !== '' ||
    typeof processResult.stdout !== 'string' ||
    utf8Bytes(processResult.stdout) > LIMITS.outputBytes
  )
    return invalid;
  let value: unknown;
  try {
    value = JSON.parse(processResult.stdout);
  } catch {
    return invalid;
  }
  if (
    !plain(value) ||
    value.protocolVersion !== request.protocolVersion ||
    (request.protocolVersion === 2 &&
      (!request.config || value.configRevision !== request.config.revision)) ||
    value.requestId !== request.requestId ||
    value.engineVersion !== ENGINE_VERSION ||
    value.policyId !== POLICY_ID
  )
    return invalid;
  if (value.status === 'blocked' || value.status === 'failed') {
    if (
      !keys(value, [
        'protocolVersion',
        'requestId',
        'status',
        'engineVersion',
        'policyId',
        'errorCode',
        ...(request.protocolVersion === 2 ? ['configRevision'] : []),
      ]) ||
      typeof value.errorCode !== 'string' ||
      !codes.has(value.errorCode)
    )
      return invalid;
    return { status: value.status, errorCode: value.errorCode };
  }
  const boundKeys = request.protocolVersion === 2 ? ['configRevision'] : [];
  const allowedTypes = new Set(typeSet);
  for (const rule of request.config?.rules ?? [])
    if (rule.kind === 'token') allowedTypes.add(rule.id);
  function counts(input: unknown): Record<string, number> | null {
    if (!plain(input)) return null;
    const result: Record<string, number> = {};
    let total = 0;
    for (const [type, count] of Object.entries(input)) {
      if (!allowedTypes.has(type) || !isNonnegativeInteger(count)) return null;
      total += count;
      if (total > LIMITS.findings) return null;
      result[type] = count;
    }
    return result;
  }
  if (
    request.operation === 'validate-config' ||
    request.operation === 'preview'
  ) {
    if (
      value.status !== 'ok' ||
      (value.artifact !== 'addon' && value.artifact !== 'wasm')
    )
      return invalid;
    const common = [
      'protocolVersion',
      'requestId',
      'status',
      'engineVersion',
      'policyId',
      'artifact',
      ...boundKeys,
    ];
    if (request.operation === 'validate-config') {
      if (
        !keys(value, [...common, 'validated', 'ruleCount']) ||
        value.validated !== true ||
        value.ruleCount !== request.config.rules.length
      )
        return invalid;
      return {
        status: 'ok',
        validated: true,
        findingCounts: {},
        count: 0,
        artifact: value.artifact,
        configRevision: request.config.revision,
      };
    }
    if (
      !keys(value, [...common, 'outcomes']) ||
      !Array.isArray(value.outcomes) ||
      value.outcomes.length !== request.config.rules.length
    )
      return invalid;
    const expected = new Map(
      request.config.rules.map((rule) => [rule.id, rule]),
    );
    const outcomes: PreviewOutcome[] = [];
    let total = 0;
    function preview(input: unknown): PreviewOutcome['positive'] | null {
      if (
        !keys(input, ['detected', 'action', 'findingCounts']) ||
        typeof input.detected !== 'boolean' ||
        (input.action !== 'redact' &&
          input.action !== 'block' &&
          input.action !== 'none')
      )
        return null;
      const findingCounts = counts(input.findingCounts);
      if (!findingCounts) return null;
      const count = Object.values(findingCounts).reduce((a, b) => a + b, 0);
      total += count;
      if (
        total > LIMITS.findings ||
        input.detected !== count > 0 ||
        (input.action === 'none') !== (count === 0)
      )
        return null;
      return { detected: input.detected, action: input.action, findingCounts };
    }
    for (const outcome of value.outcomes) {
      if (
        !keys(outcome, ['id', 'positive', 'negative']) ||
        typeof outcome.id !== 'string'
      )
        return invalid;
      const rule = expected.get(outcome.id);
      if (!rule) return invalid;
      expected.delete(outcome.id);
      const positive = preview(outcome.positive),
        negative = preview(outcome.negative);
      if (!positive || !negative) return invalid;
      outcomes.push({ id: outcome.id, positive, negative });
    }
    if (expected.size) return invalid;
    return {
      status: 'ok',
      outcomes,
      findingCounts: {},
      count: total,
      artifact: value.artifact,
      configRevision: request.config.revision,
    };
  }
  if (
    value.status !== 'ok' ||
    !keys(value, [
      'protocolVersion',
      'requestId',
      'status',
      'engineVersion',
      'policyId',
      'artifact',
      'segments',
      'findingCounts',
      ...boundKeys,
    ]) ||
    (value.artifact !== 'addon' && value.artifact !== 'wasm') ||
    !plain(value.findingCounts)
  )
    return invalid;
  const findingCounts: Record<string, number> = {};
  let total = 0;
  for (const [type, count] of Object.entries(value.findingCounts)) {
    if (!allowedTypes.has(type) || !isNonnegativeInteger(count)) return invalid;
    findingCounts[type] = count;
    total += count;
    if (total > LIMITS.findings) return invalid;
  }
  const segments: Segment[] = [];
  if (request.operation === 'self-check') {
    if ('segments' in value || total !== 0) return invalid;
  } else if (request.operation === 'sanitize') {
    if (
      !Array.isArray(value.segments) ||
      value.segments.length !== request.segments.length
    )
      return invalid;
    const expected = new Set(request.segments.map((segment) => segment.id));
    for (const segment of value.segments) {
      if (
        !keys(segment, ['id', 'text']) ||
        typeof segment.id !== 'string' ||
        typeof segment.text !== 'string' ||
        !expected.delete(segment.id)
      )
        return invalid;
      segments.push({ id: segment.id, text: segment.text });
    }
    if (expected.size) return invalid;
  } else return invalid;
  return {
    status: 'ok',
    ...(request.operation === 'sanitize' ? { segments } : {}),
    findingCounts,
    count: total,
    artifact: value.artifact,
    ...(request.config ? { configRevision: request.config.revision } : {}),
  };
}
