import { canonicalTypes } from './canonical-types.js'

export const LIMITS = Object.freeze({ inputBytes: 262144, segments: 256, findings: 1000, outputBytes: 2097152, timeoutMs: 2000, pending: 4 })
export const POLICY_ID = 'credentials-alpha1'
export const ENGINE_VERSION = '0.1.0-beta.14'
const typeSet = new Set(canonicalTypes)
const opaqueId = /^[A-Za-z0-9_-]{1,64}$/
const codes = new Set(['INVALID_REQUEST', 'INPUT_LIMIT', 'ENGINE_VERSION', 'ENGINE_UNAVAILABLE',
  'ENGINE_RESPONSE', 'FINDING_LIMIT', 'POLICY_FAILURE', 'PRIVATE_KEY_BLOCKED', 'ENGINE_FAILURE',
  'OUTPUT_LIMIT', 'TIMEOUT', 'INVALID_JSON', 'INPUT_FAILURE'])
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))
const keys = (value, allowed) => plain(value) && Object.keys(value).every(key => allowed.includes(key))

export function utf8Bytes(text) {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i += 1 }
    else bytes += 3
  }
  return bytes
}

export function makeRequest(requestId, segments) {
  if (typeof requestId !== 'string' || !opaqueId.test(requestId) || !Array.isArray(segments) || segments.length > LIMITS.segments || !segments.length) return null
  const ids = new Set()
  let bytes = 0
  for (const segment of segments) {
    if (!keys(segment, ['id', 'text']) || typeof segment.id !== 'string' || !opaqueId.test(segment.id) || typeof segment.text !== 'string' || ids.has(segment.id)) return null
    ids.add(segment.id)
    bytes += utf8Bytes(segment.text)
    if (bytes > LIMITS.inputBytes) return null
  }
  return { protocolVersion: 1, requestId, operation: 'sanitize', policyId: POLICY_ID, segments }
}

export function validateProcessResponse(processResult, request) {
  const invalid = { status: 'failed', errorCode: 'INVALID_HELPER_RESPONSE' }
  if (!keys(processResult, ['exitCode', 'stdout', 'stderr', 'isStdoutTruncated', 'isStderrTruncated']) || processResult.exitCode !== 0 ||
      processResult.isStdoutTruncated !== false || processResult.isStderrTruncated !== false || processResult.stderr !== '' ||
      typeof processResult.stdout !== 'string' || utf8Bytes(processResult.stdout) > LIMITS.outputBytes) return invalid
  let value
  try { value = JSON.parse(processResult.stdout) } catch { return invalid }
  if (!plain(value) || value.protocolVersion !== 1 || value.requestId !== request.requestId ||
      value.engineVersion !== ENGINE_VERSION || value.policyId !== POLICY_ID) return invalid
  if (value.status === 'blocked' || value.status === 'failed') {
    if (!keys(value, ['protocolVersion', 'requestId', 'status', 'engineVersion', 'policyId', 'errorCode']) || !codes.has(value.errorCode)) return invalid
    return { status: value.status, errorCode: value.errorCode }
  }
  if (value.status !== 'ok' || !keys(value, ['protocolVersion', 'requestId', 'status', 'engineVersion', 'policyId', 'artifact', 'segments', 'findingCounts']) ||
      !['addon', 'wasm'].includes(value.artifact) || !plain(value.findingCounts)) return invalid
  let total = 0
  for (const [type, count] of Object.entries(value.findingCounts)) {
    if (!typeSet.has(type) || !Number.isSafeInteger(count) || count < 0) return invalid
    total += count
    if (total > LIMITS.findings) return invalid
  }
  if (request.operation === 'self-check') {
    if ('segments' in value || total !== 0) return invalid
  } else {
    if (!Array.isArray(value.segments) || value.segments.length !== request.segments.length) return invalid
    const expected = new Set(request.segments.map(segment => segment.id))
    for (const segment of value.segments) {
      if (!keys(segment, ['id', 'text']) || typeof segment.text !== 'string' || !expected.delete(segment.id)) return invalid
    }
    if (expected.size) return invalid
  }
  return { status: 'ok', segments: value.segments, findingCounts: value.findingCounts, count: total, artifact: value.artifact }
}
