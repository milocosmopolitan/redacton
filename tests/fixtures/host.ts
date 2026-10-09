import { validateConfigDocument } from '../../helper/src/config.ts';
import type { ActiveConfiguration } from '../../mod/config.ts';
import type { HelperRequest } from '../../mod/protocol.ts';
import { makeRequest } from '../../mod/protocol.ts';
import { isPlainRecord } from '../../mod/validation.ts';

export interface SyntheticResponse {
  protocolVersion: number;
  requestId: string;
  status: string;
  engineVersion: string;
  policyId: string;
  artifact: string;
  findingCounts?: Record<string, number>;
  configRevision?: string;
  validated?: true;
  ruleCount?: number;
  outcomes?: unknown[];
  segments?: { id: string; text: string }[];
}

export function readRequest(stdin: unknown): HelperRequest {
  if (typeof stdin !== 'string') throw new Error('INVALID_FIXTURE_REQUEST');
  const value: unknown = JSON.parse(stdin);
  if (!isPlainRecord(value) || typeof value.requestId !== 'string')
    throw new Error('INVALID_FIXTURE_REQUEST');
  let config: ActiveConfiguration | undefined;
  if (value.protocolVersion === 2) {
    const raw = value.config;
    if (
      !isPlainRecord(raw) ||
      typeof raw.revision !== 'string' ||
      (raw.source !== 'defaults' &&
        raw.source !== 'session' &&
        raw.source !== 'personal' &&
        raw.source !== 'project') ||
      raw.scope !== raw.source
    )
      throw new Error('INVALID_FIXTURE_CONFIG');
    config = {
      ...validateConfigDocument({
        schemaVersion: raw.schemaVersion,
        rules: raw.rules,
      }),
      revision: raw.revision,
      source: raw.source,
      scope: raw.source,
    };
  }
  if (value.operation === 'self-check') {
    return {
      protocolVersion: config ? 2 : 1,
      ...(config ? { config } : {}),
      requestId: value.requestId,
      operation: 'self-check',
      policyId: 'credentials-alpha1',
    };
  }
  if (
    (value.operation === 'validate-config' || value.operation === 'preview') &&
    config
  )
    return {
      protocolVersion: 2,
      requestId: value.requestId,
      operation: value.operation,
      policyId: 'credentials-alpha1',
      config,
    };
  const request = makeRequest(value.requestId, value.segments, config);
  if (!request) throw new Error('INVALID_FIXTURE_REQUEST');
  return request;
}

export function syntheticResponse(request: HelperRequest): SyntheticResponse {
  const value: SyntheticResponse = {
    protocolVersion: request.protocolVersion,
    ...(request.config ? { configRevision: request.config.revision } : {}),
    requestId: request.requestId,
    status: 'ok',
    engineVersion: '0.1.0-beta.14',
    policyId: 'credentials-alpha1',
    artifact: 'addon',
    findingCounts: {},
  };
  if (request.operation === 'validate-config') {
    value.findingCounts = undefined;
    value.validated = true;
    value.ruleCount = request.config.rules.length;
  }
  if (request.operation === 'preview') {
    value.findingCounts = undefined;
    value.outcomes = request.config.rules.map((rule) => ({
      id: rule.id,
      positive: {
        detected: true,
        action: rule.action,
        findingCounts: {
          [rule.kind === 'token' ? rule.id : 'contextual_secret']: 1,
        },
      },
      negative: { detected: false, action: 'none', findingCounts: {} },
    }));
  }
  if (request.operation === 'sanitize') {
    value.segments = request.segments.map((segment) => ({
      id: segment.id,
      text: 'SANITIZED',
    }));
  }
  return value;
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {
    throw new Error('UNINITIALIZED_FIXTURE_GATE');
  };
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

export function localCommand(command: string) {
  return {
    command,
    args: '',
    origin: { kind: 'composer' } as const,
    presentation: { isFullscreen: false, columns: 80 },
  };
}

export function stdoutOf(answer: unknown): string {
  if (
    !isPlainRecord(answer) ||
    !isPlainRecord(answer.result) ||
    typeof answer.result.stdout !== 'string'
  ) {
    throw new Error('INVALID_FIXTURE_TOOL_RESULT');
  }
  return answer.result.stdout;
}

export function syntheticStorageReply(
  stdin: unknown,
  document: import('../../mod/config.ts').ConfigDocument = {
    schemaVersion: 1,
    rules: [],
  },
  revision = 'absent',
) {
  if (typeof stdin !== 'string') return null;
  const request: unknown = JSON.parse(stdin);
  if (!isPlainRecord(request) || request.operation !== 'load-config')
    return null;
  if (
    request.protocolVersion !== 2 ||
    request.policyId !== 'credentials-alpha1' ||
    typeof request.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(request.requestId) ||
    !isPlainRecord(request.storage)
  )
    throw new Error('INVALID_FIXTURE_STORAGE');
  const storage = request.storage;
  if (
    (storage.scope !== 'personal' && storage.scope !== 'project') ||
    typeof storage.approved !== 'boolean' ||
    Object.keys(request).length !== 5 ||
    Object.keys(storage).length !== (storage.scope === 'project' ? 3 : 2) ||
    (storage.scope === 'project' &&
      (typeof storage.projectRoot !== 'string' ||
        !storage.projectRoot.startsWith('/')))
  )
    throw new Error('INVALID_FIXTURE_STORAGE');
  return {
    value: {
      exitCode: 0,
      stdout: JSON.stringify({
        protocolVersion: 2,
        requestId: request.requestId,
        status: 'ok',
        engineVersion: '0.1.0-beta.14',
        policyId: 'credentials-alpha1',
        artifact: 'addon',
        settings: {
          scope: storage.scope,
          identity: (storage.scope === 'personal' ? '0' : '1').repeat(64),
          revision,
          document: validateConfigDocument(document),
        },
      }),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  };
}
