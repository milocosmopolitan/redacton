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
  findingCounts: Record<string, number>;
  segments?: { id: string; text: string }[];
}

export function readRequest(stdin: unknown): HelperRequest {
  if (typeof stdin !== 'string') throw new Error('INVALID_FIXTURE_REQUEST');
  const value: unknown = JSON.parse(stdin);
  if (!isPlainRecord(value) || typeof value.requestId !== 'string')
    throw new Error('INVALID_FIXTURE_REQUEST');
  if (value.operation === 'self-check') {
    return {
      protocolVersion: 1,
      requestId: value.requestId,
      operation: 'self-check',
      policyId: 'credentials-alpha1',
    };
  }
  const request = makeRequest(value.requestId, value.segments);
  if (!request) throw new Error('INVALID_FIXTURE_REQUEST');
  return request;
}

export function syntheticResponse(request: HelperRequest): SyntheticResponse {
  const value: SyntheticResponse = {
    protocolVersion: 1,
    requestId: request.requestId,
    status: 'ok',
    engineVersion: '0.1.0-beta.14',
    policyId: 'credentials-alpha1',
    artifact: 'addon',
    findingCounts: {},
  };
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
