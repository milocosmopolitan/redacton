import { expect, test } from 'claude-code/testing'

const start = { surface: 'terminal', isInteractive: true, cwd: '/synthetic' }
const prompt = { text: 'SYNTHETIC_RAW', wait: false, origin: { kind: 'composer' } }
function setup(on, processHook) {
  on('session.start', () => ({ cwd: '/synthetic' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 'resource-session' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', processHook).catch(() => ({ deny: 'SYNTHETIC_PROCESS_FAILURE' }))
}
function reply(request) {
  const value = { protocolVersion: 1, requestId: request.requestId, status: 'ok', engineVersion: '0.1.0-beta.14', policyId: 'credentials-alpha1', artifact: 'addon', findingCounts: {} }
  if (request.operation === 'sanitize') value.segments = request.segments.map(segment => ({ id: segment.id, text: 'SANITIZED' }))
  return { value: { exitCode: 0, stdout: JSON.stringify(value), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
}

test('five concurrent prompts dispatch at most four helpers and withhold the saturated operation', async ($, on) => {
  let active = 0, maximum = 0, sanitizes = 0, reached, release
  const fourStarted = new Promise(resolve => { reached = resolve })
  const gate = new Promise(resolve => { release = resolve })
  setup(on, async ($, e) => {
    const request = JSON.parse(e.init.stdin)
    if (request.operation === 'self-check') return reply(request)
    sanitizes++; active++; maximum = Math.max(maximum, active)
    if (active === 4) reached()
    await gate
    active--
    return reply(request)
  })
  let delivered = 0
  on('prompt.submit', ($, e) => { delivered++; return { text: e.text } })
  await $.session.start(start)
  const operations = Array.from({ length: 5 }, () => $.prompt.submit(prompt))
  await fourStarted
  release()
  const results = await Promise.all(operations)
  expect(maximum).toBe(4)
  expect(sanitizes).toBe(4)
  expect(delivered).toBe(4)
  expect(results.filter(result => result.drop === 'QUEUE_SATURATED').length).toBe(1)
})

for (const fault of ['wrong-request', 'duplicate-segment', 'missing-segment', 'unknown-status', 'unknown-count', 'truncated', 'process-throw', 'process-denied']) {
  test(`protected prompt is withheld for ${fault} process behavior`, async ($, on) => {
    setup(on, ($, e) => {
      const request = JSON.parse(e.init.stdin)
      if (request.operation === 'self-check') return reply(request)
      if (fault === 'process-throw') throw new Error('SYNTHETIC_TIMEOUT')
      if (fault === 'process-denied') return { deny: 'SYNTHETIC_MISSING_NODE' }
      const result = reply(request)
      const response = JSON.parse(result.value.stdout)
      if (fault === 'wrong-request') response.requestId = 'unrelated'
      if (fault === 'duplicate-segment') response.segments.push(response.segments[0])
      if (fault === 'missing-segment') response.segments = []
      if (fault === 'unknown-status') response.status = 'partial'
      if (fault === 'unknown-count') response.findingCounts = { secret_hash: 1 }
      if (fault === 'truncated') result.value.isStdoutTruncated = true
      result.value.stdout = JSON.stringify(response)
      return result
    })
    let delivered = 0
    on('prompt.submit', () => { delivered++; return { text: 'SYNTHETIC_RAW' } })
    await $.session.start(start)
    const result = await $.prompt.submit(prompt)
    expect(result.drop).toBeDefined()
    expect(delivered).toBe(0)
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_RAW')
    expect(JSON.stringify(result)).not.toContain('secret_hash')
  })
}

test('failed self-check cannot report ready or dispatch a protected original operation', async ($, on) => {
  let processes = 0, executed = 0, delivered = 0
  setup(on, () => { processes++; return { deny: 'SYNTHETIC_MISSING_NODE' } })
  on('tool.call', () => { executed++; return { result: { stdout: 'SYNTHETIC_RAW', stderr: '', interrupted: false } } })
  on('prompt.submit', () => { delivered++; return { text: 'SYNTHETIC_RAW' } })
  await $.session.start(start)
  expect((await $.prompt.submit(prompt)).drop).toBe('REDACTON_UNAVAILABLE')
  expect((await $.tool.call({ tool: 'Bash', command: 'synthetic-command' })).deny).toBe('REDACTON_UNAVAILABLE')
  expect(processes).toBe(1)
  expect(executed).toBe(0)
  expect(delivered).toBe(0)
})

test('repeated session.start resets OFF to ON and rechecks readiness', async ($, on) => {
  const operations = []
  setup(on, ($, e) => { const request = JSON.parse(e.init.stdin); operations.push(request.operation); return reply(request) })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start(start)
  await $.command.run({ command: 'redactoff', args: '' })
  await $.session.start(start)
  expect((await $.prompt.submit(prompt)).text).toBe('SANITIZED')
  expect(operations).toEqual(['self-check', 'self-check', 'sanitize'])
})

test('session.end resume clears OFF; next prompt lazily checks readiness then sanitizes', async ($, on) => {
  const operations = []
  setup(on, ($, e) => { const request = JSON.parse(e.init.stdin); operations.push(request.operation); return reply(request) })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start(start)
  await $.command.run({ command: 'redactoff', args: '' })
  await $.session.end({ reason: 'resume', sessionId: 'resource-session', resume: { sessionId: 'resource-session' } })
  expect((await $.prompt.submit(prompt)).text).toBe('SANITIZED')
  expect(operations).toEqual(['self-check', 'self-check', 'sanitize'])
})
