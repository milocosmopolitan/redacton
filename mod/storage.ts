import { validateConfigDocument } from '../helper/src/config.ts';
import type { ConfigDocument } from './config.ts';
import { ENGINE_VERSION, LIMITS, POLICY_ID, utf8Bytes } from './protocol.ts';
import type { SavedConfiguration, SavedScope } from './settings.ts';
import { hasOnlyKeys as keys, isPlainRecord as plain } from './validation.ts';
export interface StorageRequest {
  protocolVersion: 2;
  requestId: string;
  operation:
    | 'load-config'
    | 'save-config'
    | 'reset-config'
    | 'import-config'
    | 'export-config';
  policyId: typeof POLICY_ID;
  storage: {
    scope: SavedScope;
    approved: boolean;
    projectRoot?: string;
    expectedRevision?: string;
    expectedIdentity?: string;
    expectedDocument?: ConfigDocument;
    document?: ConfigDocument;
  };
}
export type StorageResponse =
  | { ok: true; settings: SavedConfiguration }
  | { ok: false; code: string };
const codes = new Set([
  'SETTINGS_UNAVAILABLE',
  'SETTINGS_CONFLICT',
  'SETTINGS_BUSY',
  'SETTINGS_CORRUPT',
  'ENGINE_VERSION',
  'ENGINE_UNAVAILABLE',
  'PROJECT_TRUST_REQUIRED',
  'INVALID_CONFIG',
  'NAMES_ACTION_CONFLICT',
  'INVALID_REQUEST',
  'INPUT_LIMIT',
  'OUTPUT_LIMIT',
  'INPUT_FAILURE',
  'TIMEOUT',
]);
export function validateStorageResponse(
  result: unknown,
  request: StorageRequest,
): StorageResponse {
  const failure: StorageResponse = {
    ok: false,
    code: 'INVALID_SETTINGS_RESPONSE',
  };
  if (
    !keys(result, [
      'exitCode',
      'stdout',
      'stderr',
      'isStdoutTruncated',
      'isStderrTruncated',
    ]) ||
    result.exitCode !== 0 ||
    result.stderr !== '' ||
    result.isStdoutTruncated !== false ||
    result.isStderrTruncated !== false ||
    typeof result.stdout !== 'string' ||
    utf8Bytes(result.stdout) > LIMITS.outputBytes
  )
    return failure;
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return failure;
  }
  if (
    !plain(value) ||
    value.protocolVersion !== 2 ||
    value.requestId !== request.requestId ||
    value.engineVersion !== ENGINE_VERSION ||
    value.policyId !== POLICY_ID
  )
    return failure;
  if (value.status === 'failed') {
    if (
      !keys(value, [
        'protocolVersion',
        'requestId',
        'status',
        'engineVersion',
        'policyId',
        'errorCode',
      ]) ||
      typeof value.errorCode !== 'string' ||
      !codes.has(value.errorCode)
    )
      return failure;
    return { ok: false, code: value.errorCode };
  }
  if (
    value.status !== 'ok' ||
    (value.artifact !== 'addon' && value.artifact !== 'wasm') ||
    !keys(value, [
      'protocolVersion',
      'requestId',
      'status',
      'engineVersion',
      'policyId',
      'artifact',
      'settings',
    ]) ||
    !keys(value.settings, ['scope', 'identity', 'revision', 'document']) ||
    value.settings.scope !== request.storage.scope ||
    typeof value.settings.identity !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.settings.identity) ||
    typeof value.settings.revision !== 'string' ||
    !/^(?:absent|[0-9a-f-]{36})$/.test(value.settings.revision)
  )
    return failure;
  try {
    const document = validateConfigDocument(value.settings.document);
    return {
      ok: true,
      settings: {
        scope: request.storage.scope,
        identity: value.settings.identity,
        revision: value.settings.revision,
        document,
      },
    };
  } catch {
    return failure;
  }
}

export interface TransferReceipt {
  scope: SavedScope;
  identity: string;
  document: ConfigDocument;
}
export type TransferResponse =
  | { ok: true; transfer: TransferReceipt }
  | { ok: false; code: string };
export function validateTransferResponse(
  result: unknown,
  request: StorageRequest,
): TransferResponse {
  const failure: TransferResponse = {
    ok: false,
    code: 'INVALID_TRANSFER_RESPONSE',
  };
  if (
    !keys(result, [
      'exitCode',
      'stdout',
      'stderr',
      'isStdoutTruncated',
      'isStderrTruncated',
    ]) ||
    result.exitCode !== 0 ||
    result.stderr !== '' ||
    result.isStdoutTruncated !== false ||
    result.isStderrTruncated !== false ||
    typeof result.stdout !== 'string' ||
    utf8Bytes(result.stdout) > LIMITS.outputBytes
  )
    return failure;
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return failure;
  }
  if (
    !plain(value) ||
    value.protocolVersion !== 2 ||
    value.requestId !== request.requestId ||
    value.engineVersion !== ENGINE_VERSION ||
    value.policyId !== POLICY_ID
  )
    return failure;
  if (value.status === 'failed') {
    if (
      !keys(value, [
        'protocolVersion',
        'requestId',
        'status',
        'engineVersion',
        'policyId',
        'errorCode',
      ]) ||
      typeof value.errorCode !== 'string' ||
      !codes.has(value.errorCode)
    )
      return failure;
    return { ok: false, code: value.errorCode };
  }
  if (
    value.status !== 'ok' ||
    (value.artifact !== 'addon' && value.artifact !== 'wasm') ||
    !keys(value, [
      'protocolVersion',
      'requestId',
      'status',
      'engineVersion',
      'policyId',
      'artifact',
      'transfer',
    ]) ||
    !keys(value.transfer, ['scope', 'identity', 'document']) ||
    value.transfer.scope !== request.storage.scope ||
    typeof value.transfer.identity !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.transfer.identity)
  )
    return failure;
  try {
    const document = validateConfigDocument(value.transfer.document);
    if (
      request.operation === 'export-config' &&
      (value.transfer.identity !== request.storage.expectedIdentity ||
        JSON.stringify(document) !== JSON.stringify(request.storage.document))
    )
      return failure;
    return {
      ok: true,
      transfer: {
        scope: request.storage.scope,
        identity: value.transfer.identity,
        document,
      },
    };
  } catch {
    return failure;
  }
}
