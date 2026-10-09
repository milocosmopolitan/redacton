import { expect, test } from 'claude-code/testing'

test('prompt replacement reaches next and thrown prompt is withheld', async ($, on) => {
  const seen: string[] = []
  on('prompt.submit', ($, e) => { seen.push(e.text); return { text: e.text } })
  expect((await $.prompt.submit({ text: 'SPIKE_RAW' })).text).toBe('SPIKE_SANITIZED')
  expect((await $.prompt.submit({ text: 'SPIKE_THROW' })).drop).toBe('SPIKE_CATCH_BLOCKED')
  expect((await $.prompt.submit({ text: 'SPIKE_DROP' })).drop).toBe('SPIKE_BLOCKED')
  expect(seen).toEqual(['SPIKE_SANITIZED'])
})

test('stub envelope replacement removes aliases; safe catch does not reexecute; kit accepts null', async ($, on) => {
  let executions = 0
  on('tool.call', ($, e) => {
    executions += 1
    return { result: { stdout: 'SPIKE_RAW', stderr: 'SPIKE_RAW', interrupted: false }, text: 'SPIKE_RAW', ...(e.command === 'spike-context' ? { context: ['SPIKE_RAW'] } : {}), ref: 1 }
  })
  const replaced = await $.tool.call({ tool: 'Bash', command: 'spike-replace' })
  expect(replaced.result).toEqual({ stdout: 'SPIKE_SANITIZED', stderr: '', interrupted: false })
  expect(replaced.ref).toBeUndefined()
  expect(replaced.text).toBeUndefined()
  expect(replaced.context).toBeUndefined()
  expect(await $.tool.call({ tool: 'Bash', command: 'spike-throw' })).toEqual({ deny: 'SPIKE_CATCH_BLOCKED' })
  expect((await $.tool.call({ tool: 'Bash', command: 'spike-invalid' })).result).toBe(null)
  expect((await $.tool.call({ tool: 'Bash', command: 'spike-context' })).deny).toBe('SPIKE_CONTEXT_BLOCKED')
  expect(executions).toBe(4)
})
