import { expect, test } from 'claude-code/testing'

function host(on, behavior = 'ok') {
  const calls = []
  on('session.start', () => ({ cwd: '/synthetic' }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 'synthetic-session' }))
  on('command.register', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', ($, e) => {
    const request = JSON.parse(e.init.stdin)
    calls.push(request.operation)
    if (behavior === 'denied' && request.operation === 'sanitize') return { deny: 'SYNTHETIC_FAILURE' }
    const reply = { protocolVersion: 1, requestId: request.requestId, status: 'ok', engineVersion: '0.1.0-beta.14', policyId: 'credentials-alpha1', artifact: 'addon', findingCounts: {} }
    if (request.operation === 'sanitize') reply.segments = request.segments.map(segment => ({ id: segment.id, text: 'SANITIZED' }))
    return { value: { exitCode: 0, stdout: behavior === 'invalid' && request.operation === 'sanitize' ? '{' : JSON.stringify(reply), stderr: '', isStdoutTruncated: behavior === 'truncated' && request.operation === 'sanitize', isStderrTruncated: false } }
  })
  return calls
}

test('ON scans prompt before submission; OFF bypasses helper and warns locally', async ($, on) => {
  const calls = host(on)
  const seen = []
  on('prompt.submit', ($, e) => { seen.push(e.text); return { text: e.text } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
  expect(await $.prompt.submit({ text: 'SYNTHETIC_RAW', wait: false, origin: { kind: 'composer' } })).toEqual({ text: 'SANITIZED' })
  expect(seen).toEqual(['SANITIZED'])
  const off = await $.command.run({ command: 'redactoff', args: '' })
  expect(off.text).toContain('OFF')
  const before = calls.length
  await $.prompt.submit({ text: 'SYNTHETIC_RAW', wait: false, origin: { kind: 'composer' } })
  expect(seen).toEqual(['SANITIZED', 'SYNTHETIC_RAW'])
  expect(calls.length).toBe(before)
})

for (const behavior of ['denied', 'invalid', 'truncated']) {
  test(`ON withholds tool output for ${behavior} helper response without reexecution`, async ($, on) => {
    host(on, behavior)
    let executions = 0
    on('tool.call', () => { executions++; return { result: { stdout: 'SYNTHETIC_RAW', stderr: 'SYNTHETIC_RAW', interrupted: false }, text: 'SYNTHETIC_RAW', ref: 1 } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
    const answer = await $.tool.call({ tool: 'Bash', command: 'synthetic-command' })
    expect(answer.deny).toBeDefined()
    expect(answer.ref).toBeUndefined()
    expect(answer.text).toBeUndefined()
    expect(executions).toBe(1)
  })
}

test('OFF warning is present on the terminal AbovePrompt render tree', async ($, on) => {
  host(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
  await $.command.run({ command: 'redactoff', args: '' })
  const ui = await $.ui.mount({ plugin: 'redacton', component: 'AbovePrompt', requestId: 'synthetic-band', surface: 'terminal',
    viewport: { columns: 120, rows: 30 }, props: { hasSurvey: false, isWorking: false, maxRows: 10,
      bodyColumns: 115, scroll: { offset: 0, bodyRows: 10 }, view: {} } })
  expect(await ui.find({ type: 'Text', text: '⚠ Redacton OFF — credential protection disabled' })).toBeDefined()
  await ui.unmount()
})

test('ON operation keeps protection after a mid-flight OFF command', async ($, on) => {
  const calls = host(on)
  let started, release
  const began = new Promise(resolve => { started = resolve })
  const held = new Promise(resolve => { release = resolve })
  on('tool.call', async () => {
    started()
    await held
    return { result: { stdout: 'SYNTHETIC_RAW', stderr: '', interrupted: false } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
  const operation = $.tool.call({ tool: 'Bash', command: 'synthetic-command' })
  await began
  await $.command.run({ command: 'redactoff', args: '' })
  release()
  const answer = await operation
  expect(answer.result.stdout).toBe('SANITIZED')
  expect(calls.filter(operation => operation === 'sanitize').length).toBe(1)
})

test('OFF operation remains bypassed after a mid-flight ON command', async ($, on) => {
  const calls = host(on)
  let started, release
  const began = new Promise(resolve => { started = resolve })
  const held = new Promise(resolve => { release = resolve })
  on('tool.call', async () => {
    started()
    await held
    return { result: { stdout: 'SYNTHETIC_RAW', stderr: '', interrupted: false } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
  await $.command.run({ command: 'redactoff', args: '' })
  const operation = $.tool.call({ tool: 'Bash', command: 'synthetic-command' })
  await began
  await $.command.run({ command: 'redacton', args: '' })
  release()
  const answer = await operation
  expect(answer.result.stdout).toBe('SYNTHETIC_RAW')
  expect(calls.filter(operation => operation === 'sanitize').length).toBe(0)
})

test('same tool invocation ID in different agents does not collide', async ($, on) => {
  const calls = host(on)
  let executions = 0
  on('tool.call', () => { executions++; return { result: { stdout: 'SYNTHETIC_RAW', stderr: '', interrupted: false } } })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
  const answers = await Promise.all(['agent-a', 'agent-b'].map(agentId => $.tool.call({ tool: 'Bash', command: 'synthetic-command', tool_use_id: 'same-id', agentId })))
  expect(answers.map(answer => answer.result.stdout)).toEqual(['SANITIZED', 'SANITIZED'])
  expect(executions).toBe(2)
  expect(calls.filter(operation => operation === 'sanitize').length).toBe(2)
})

test('host refusal is preserved without scanner dispatch', async ($, on) => {
  const calls = host(on)
  on('tool.call', () => ({ deny: 'HOST_PERMISSION_DENIED' }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
  const answer = await $.tool.call({ tool: 'Bash', command: 'synthetic-command' })
  expect(answer.deny).toBeDefined()
  expect(calls.filter(operation => operation === 'sanitize').length).toBe(0)
})

test('clear boundary resets OFF to ON and checks readiness before the next prompt', async ($, on) => {
  const calls = host(on)
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/synthetic' })
  await $.command.run({ command: 'redactoff', args: '' })
  await $.session.end({ reason: 'clear', sessionId: 'synthetic-session', resume: { id: 'synthetic-session' } })
  const answer = await $.prompt.submit({ text: 'SYNTHETIC_RAW', wait: false, origin: { kind: 'composer' } })
  expect(answer.text).toBe('SANITIZED')
  expect(calls.filter(operation => operation === 'self-check').length).toBe(2)
  expect(calls.filter(operation => operation === 'sanitize').length).toBe(1)
})
