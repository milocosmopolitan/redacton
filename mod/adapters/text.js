const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))
const keys = (value, allowed) => plain(value) && Reflect.ownKeys(value).every(key =>
  typeof key === 'string' && allowed.includes(key) && 'value' in Object.getOwnPropertyDescriptor(value, key))
const blocked = () => ({ status: 'blocked', errorCode: 'UNSUPPORTED_SHAPE' })
// The model-origin host envelope retains these optional keys as undefined.
// Populated values can carry paths, aliases or background output, so withhold them.
const emptyBashFields = ['returnCodeInterpretation', 'backgroundTaskId', 'backgroundedByUser',
  'backgroundedByTurnAbort', 'backgroundedToDeliverMessage', 'timedOutAfterMs',
  'backgroundEndsWithFinalResponse', 'backgroundCwdHint', 'dangerouslyDisableSandbox',
  'persistedOutputPath', 'persistedOutputSize', 'staleReadFileStateHint', 'ghRateLimitHint',
  'gitOperation', 'bashEditDiff']
const safeOriginKinds = new Set(['composer', 'bridge', 'sdk', 'task-notification', 'scheduled-trigger',
  'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity',
  'auto-continuation', 'unclassified', 'slack-ping'])
const validOrigin = origin => keys(origin, ['kind']) && safeOriginKinds.has(origin.kind) ||
  keys(origin, ['kind', 'name', 'asUser']) && origin.kind === 'plugin' && typeof origin.name === 'string' &&
    (!own(origin, 'asUser') || origin.asUser === true) ||
  keys(origin, ['kind', 'server']) && origin.kind === 'channel' && typeof origin.server === 'string'

export function extractPrompt(value) {
  if (!keys(value, ['text', 'context', 'attachments', 'wait', 'origin', 'turnId']) ||
      typeof value.text !== 'string' || typeof value.wait !== 'boolean' ||
      !validOrigin(value.origin) ||
      (own(value, 'turnId') && typeof value.turnId !== 'string') ||
      (own(value, 'attachments') && (!Array.isArray(value.attachments) || value.attachments.length)) ||
      (own(value, 'context') && (!Array.isArray(value.context) || !value.context.every(text => typeof text === 'string')))) return blocked()
  const context = value.context ?? []
  return { status: 'ok', shape: 'prompt', segments: [{ id: 'text', text: value.text },
    ...context.map((text, index) => ({ id: `context${index}`, text }))],
    metadata: { wait: value.wait, origin: value.origin, ...(own(value, 'turnId') ? { turnId: value.turnId } : {}) } }
}

function sanitized(extraction, segments) {
  if (extraction?.status !== 'ok' || !Array.isArray(segments) || segments.length !== extraction.segments.length) return null
  const expected = new Set(extraction.segments.map(segment => segment.id))
  const output = new Map()
  for (const segment of segments) {
    if (!keys(segment, ['id', 'text']) || !expected.has(segment.id) || output.has(segment.id) || typeof segment.text !== 'string') return null
    output.set(segment.id, segment.text)
  }
  return output
}

export function rebuildPrompt(extraction, segments) {
  const values = sanitized(extraction, segments)
  if (!values || extraction.shape !== 'prompt') return { drop: 'INVALID_RESPONSE' }
  const result = { text: values.get('text'), wait: extraction.metadata.wait, origin: extraction.metadata.origin }
  if (own(extraction.metadata, 'turnId')) result.turnId = extraction.metadata.turnId
  if (values.size > 1) result.context = extraction.segments.slice(1).map(segment => values.get(segment.id))
  return result
}

export function extractToolResult(tool, value) {
  if (!keys(value, ['result', 'text', 'ref', 'context', 'isError', 'isReadOnly', 'deny']) ||
      value.isError === true || own(value, 'deny') && value.deny !== undefined ||
      (own(value, 'context') && (!Array.isArray(value.context) || value.context.length)) ||
      (own(value, 'isError') && value.isError !== undefined) ||
      (own(value, 'isReadOnly') && value.isReadOnly !== true && value.isReadOnly !== undefined) ||
      (own(value, 'text') && value.text !== undefined && typeof value.text !== 'string') ||
      (own(value, 'ref') && value.ref !== undefined && !Number.isSafeInteger(value.ref))) return blocked()
  const result = value.result
  if (tool === 'Bash') {
    if (!keys(result, ['stdout', 'stderr', 'interrupted', 'isImage', 'noOutputExpected', ...emptyBashFields]) ||
        emptyBashFields.some(field => own(result, field) && result[field] !== undefined) || typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string' || typeof result.interrupted !== 'boolean' ||
        (own(result, 'isImage') && result.isImage !== false) ||
        (own(result, 'noOutputExpected') && typeof result.noOutputExpected !== 'boolean')) return blocked()
    return { status: 'ok', shape: 'Bash', metadata: { interrupted: result.interrupted },
      segments: [{ id: 'stdout', text: result.stdout }, { id: 'stderr', text: result.stderr }] }
  }
  if (tool === 'Read') {
    if (!keys(result, ['type', 'file']) || result.type !== 'text' ||
        !keys(result.file, ['filePath', 'content', 'numLines', 'startLine', 'totalLines']) ||
        typeof result.file.filePath !== 'string' || typeof result.file.content !== 'string' ||
        !['numLines', 'startLine', 'totalLines'].every(key => Number.isSafeInteger(result.file[key]) && result.file[key] >= 0)) return blocked()
    return { status: 'ok', shape: 'Read', metadata: { numLines: result.file.numLines,
      startLine: result.file.startLine, totalLines: result.file.totalLines },
      segments: [{ id: 'filePath', text: result.file.filePath }, { id: 'content', text: result.file.content }] }
  }
  return blocked()
}

export function rebuildToolResult(extraction, segments) {
  const values = sanitized(extraction, segments)
  if (!values) return { deny: 'INVALID_RESPONSE' }
  if (extraction.shape === 'Bash') return { result: { stdout: values.get('stdout'), stderr: values.get('stderr'), interrupted: extraction.metadata.interrupted } }
  if (extraction.shape === 'Read') return { result: { type: 'text', file: { filePath: values.get('filePath'),
    content: values.get('content'), numLines: extraction.metadata.numLines,
    startLine: extraction.metadata.startLine, totalLines: extraction.metadata.totalLines } } }
  return { deny: 'INVALID_RESPONSE' }
}
