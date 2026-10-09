import { isAbsolute } from 'node:path';
import type { ScanAndRedactOptions } from '@redact-secret/core';
import canonicalTypes from './canonical-types.json' with { type: 'json' };
import type { ActiveConfiguration } from './config.js';
import { validateConfigDocument } from './config.js';
import {
  compileConfiguration,
  syntheticExamples,
  validateLiteralSafety,
} from './rules.js';
import { storageOperation } from './storage.js';
export const CANONICAL_TYPES = Object.freeze(canonicalTypes);
export const ENGINE_VERSION = '0.1.0-beta.14';
export const POLICY_ID = 'credentials-alpha1';
export const LIMITS = Object.freeze({
  inputBytes: 256 * 1024,
  segments: 256,
  findings: 1000,
  outputBytes: 2 * 1024 * 1024,
  timeoutMs: 2000,
  settingsTimeoutMs: 5000,
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
// Settings gain time only after the complete closed envelope and documents validate.
export function requestDeadlineMs(value: unknown): number {
  try {
    if (
      !keys(value, [
        'protocolVersion',
        'requestId',
        'operation',
        'policyId',
        'storage',
      ]) ||
      value.protocolVersion !== 2 ||
      typeof value.requestId !== 'string' ||
      !ID.test(value.requestId) ||
      value.policyId !== POLICY_ID ||
      typeof value.operation !== 'string' ||
      ![
        'load-config',
        'save-config',
        'reset-config',
        'import-config',
        'export-config',
      ].includes(value.operation)
    )
      return LIMITS.timeoutMs;
    const storage = value.storage;
    if (
      !record(storage) ||
      (storage.scope !== 'personal' && storage.scope !== 'project') ||
      typeof storage.approved !== 'boolean'
    )
      return LIMITS.timeoutMs;
    const saving =
      value.operation === 'save-config' || value.operation === 'reset-config';
    const exporting = value.operation === 'export-config';
    if (
      !keys(storage, [
        'scope',
        'approved',
        ...(storage.scope === 'project' ? ['projectRoot'] : []),
        ...(saving
          ? ['expectedIdentity', 'expectedRevision', 'expectedDocument']
          : []),
        ...(exporting ? ['expectedIdentity'] : []),
        ...(value.operation === 'save-config' || exporting ? ['document'] : []),
      ])
    )
      return LIMITS.timeoutMs;
    if (
      storage.scope === 'project' &&
      (typeof storage.projectRoot !== 'string' ||
        !isAbsolute(storage.projectRoot))
    )
      return LIMITS.timeoutMs;
    if (
      (saving || exporting) &&
      (typeof storage.expectedIdentity !== 'string' ||
        !/^[0-9a-f]{64}$/.test(storage.expectedIdentity))
    )
      return LIMITS.timeoutMs;
    if (saving) {
      if (
        typeof storage.expectedRevision !== 'string' ||
        !/^(?:absent|[0-9a-f-]{36})$/.test(storage.expectedRevision)
      )
        return LIMITS.timeoutMs;
      validateConfigDocument(storage.expectedDocument);
    }
    if (value.operation === 'save-config' || exporting)
      validateConfigDocument(storage.document);
    return LIMITS.settingsTimeoutMs;
  } catch {
    return LIMITS.timeoutMs;
  }
}

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
async function processLegacyRequest(
  value: unknown,
  engine: Engine,
  allowedTypes: ReadonlySet<string> = TYPES,
) {
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
      let privateKey = false;
      for (const finding of result.findings) {
        if (
          !record(finding) ||
          typeof finding.type !== 'string' ||
          typeof finding.action !== 'string' ||
          !allowedTypes.has(finding.type) ||
          !['redact', 'block'].includes(finding.action)
        )
          return failure(request.requestId, 'POLICY_FAILURE');
        if (finding.type === 'private_key') privateKey = true;
        if (privateKey || finding.action === 'block') blocked = true;
        findingCounts[finding.type] = (findingCounts[finding.type] ?? 0) + 1;
      }
      if (blocked)
        return failure(
          request.requestId,
          privateKey ? 'PRIVATE_KEY_BLOCKED' : 'RULE_BLOCKED',
          'blocked',
        );
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

export function encodeResponse(response: {
  requestId: string | null;
  protocolVersion?: number;
  configRevision?: string | null;
}) {
  const json = JSON.stringify(response);
  if (Buffer.byteLength(json, 'utf8') <= LIMITS.outputBytes) return json;
  const limited = failure(response.requestId, 'OUTPUT_LIMIT');
  return JSON.stringify(
    response.protocolVersion === 2
      ? {
          ...limited,
          protocolVersion: 2,
          configRevision: response.configRevision ?? null,
        }
      : limited,
  );
}

function configuration(input: unknown): ActiveConfiguration {
  if (
    !keys(input, ['schemaVersion', 'rules', 'revision', 'source', 'scope']) ||
    typeof input.revision !== 'string' ||
    !ID.test(input.revision) ||
    (input.source !== 'defaults' &&
      input.source !== 'personal' &&
      input.source !== 'project' &&
      input.source !== 'session') ||
    input.scope !== input.source
  )
    throw new Error('INVALID_CONFIG');
  const document = validateConfigDocument({
    schemaVersion: input.schemaVersion,
    rules: input.rules,
  });
  return Object.freeze({
    ...document,
    revision: input.revision,
    source: input.source,
    scope: input.source,
  });
}
export async function processRequest(value: unknown, engine: Engine) {
  if (!record(value) || value.protocolVersion !== 2)
    return processLegacyRequest(value, engine);
  if (
    [
      'load-config',
      'save-config',
      'reset-config',
      'import-config',
      'export-config',
    ].includes(String(value.operation))
  )
    return storageOperation(
      value,
      engine,
      CANONICAL_TYPES,
      ENGINE_VERSION,
      POLICY_ID,
    );
  let config: ActiveConfiguration;
  let requestId: string;
  try {
    if (
      typeof value.requestId !== 'string' ||
      !ID.test(value.requestId) ||
      value.policyId !== POLICY_ID ||
      typeof value.operation !== 'string' ||
      !['self-check', 'sanitize', 'validate-config', 'preview'].includes(
        value.operation,
      ) ||
      !keys(
        value,
        value.operation === 'sanitize'
          ? [
              'protocolVersion',
              'requestId',
              'operation',
              'policyId',
              'config',
              'segments',
            ]
          : ['protocolVersion', 'requestId', 'operation', 'policyId', 'config'],
      )
    )
      throw new Error('INVALID_REQUEST');
    config = configuration(value.config);
    requestId = value.requestId;
  } catch {
    return {
      ...failure(null, 'INVALID_REQUEST'),
      protocolVersion: 2,
      configRevision: null,
    };
  }
  const bind = <T extends { requestId: string | null }>(response: T) => ({
    ...response,
    protocolVersion: 2,
    configRevision: config.revision,
  });
  try {
    if (engine.VERSION !== ENGINE_VERSION)
      return bind(failure(requestId, 'ENGINE_VERSION'));
    await engine.initialize();
    const artifact = engine.artifact();
    if (artifact !== 'addon' && artifact !== 'wasm')
      return bind(failure(requestId, 'ENGINE_UNAVAILABLE'));
    validateLiteralSafety(config, engine);
    const compiled = compileConfiguration(config, CANONICAL_TYPES);
    const options = {
      policy: compiled.policy,
      ...(compiled.ruleset ? { ruleset: compiled.ruleset } : {}),
      limits: {
        maxInputBytes: LIMITS.inputBytes,
        maxFindings: LIMITS.findings,
      },
    };
    const validation = engine.scanAndRedact('', {
      ...options,
      ...(compiled.validationRuleset
        ? { ruleset: compiled.validationRuleset }
        : {}),
    });
    if (
      !record(validation) ||
      validation.text !== '' ||
      !array(validation.findings) ||
      validation.findings.length !== 0
    )
      throw new Error('ENGINE_RESPONSE');
    if (value.operation === 'validate-config')
      return bind({
        protocolVersion: 2,
        requestId,
        status: 'ok',
        engineVersion: ENGINE_VERSION,
        policyId: POLICY_ID,
        artifact,
        validated: true,
        ruleCount: config.rules.length,
      });
    if (value.operation === 'preview') {
      let total = 0;
      const outcomes = config.rules.map((rule) => {
        const [positive, negative] = syntheticExamples(rule);
        const project = (text: string) => {
          const result = engine.scanAndRedact(text, options);
          if (
            !record(result) ||
            typeof result.text !== 'string' ||
            !array(result.findings)
          )
            throw new Error('ENGINE_RESPONSE');
          total += result.findings.length;
          if (total > LIMITS.findings) throw new Error('FINDING_LIMIT');
          const counts: Record<string, number> = Object.create(null);
          let blocked = false;
          for (const finding of result.findings) {
            if (
              !record(finding) ||
              typeof finding.type !== 'string' ||
              !compiled.types.has(finding.type) ||
              (finding.action !== 'redact' && finding.action !== 'block')
            )
              throw new Error('POLICY_FAILURE');
            blocked ||=
              finding.action === 'block' || finding.type === 'private_key';
            counts[finding.type] = (counts[finding.type] ?? 0) + 1;
          }
          return {
            detected: result.findings.length > 0,
            action: blocked
              ? 'block'
              : result.findings.length
                ? 'redact'
                : 'none',
            findingCounts: counts,
          };
        };
        return {
          id: rule.id,
          positive: project(positive),
          negative: project(negative),
        };
      });
      return bind({
        protocolVersion: 2,
        requestId,
        status: 'ok',
        engineVersion: ENGINE_VERSION,
        policyId: POLICY_ID,
        artifact,
        outcomes,
      });
    }
    const wrapper: Engine = {
      VERSION: engine.VERSION,
      initialize: () => engine.initialize(),
      artifact: () => engine.artifact(),
      scanAndRedact: (text, legacyOptions) =>
        engine.scanAndRedact(text, {
          ...legacyOptions,
          policy: compiled.policy,
          ...(compiled.ruleset ? { ruleset: compiled.ruleset } : {}),
        }),
    };
    const legacy = {
      protocolVersion: 1,
      requestId,
      operation: value.operation,
      policyId: POLICY_ID,
      ...(value.operation === 'sanitize' ? { segments: value.segments } : {}),
    };
    return bind(await processLegacyRequest(legacy, wrapper, compiled.types));
  } catch (error) {
    const code =
      error instanceof Error &&
      ['ENGINE_RESPONSE', 'POLICY_FAILURE', 'FINDING_LIMIT'].includes(
        error.message,
      )
        ? error.message
        : 'INVALID_CONFIG';
    return bind(failure(requestId, code));
  }
}
