export function register(on) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const answer = await next(e)
    const observation = { envelope: Object.keys(answer), result: Object.keys(answer.result ?? {}), envelopeTypes: Object.fromEntries(Object.entries(answer).map(([key, value]) => [key, typeof value])), resultTypes: Object.fromEntries(Object.entries(answer.result ?? {}).map(([key, value]) => [key, typeof value])), contextCount: answer.context?.length ?? 0, isReadOnly: answer.isReadOnly, isError: answer.isError, isImage: answer.result?.isImage, noOutputExpected: answer.result?.noOutputExpected }
    return { result: { stdout: JSON.stringify(observation), stderr: '', interrupted: false } }
  })
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'shape', description: 'Inspect synthetic result keys' })
    await $.command.register({ name: 'redacton', description: 'Qualification-only shape probe preflight' })
    return next(e)
  })
  on('command.run', { command: 'redacton' }, () => ({ text: 'Redacton ON. SHAPE_PROBE_ONLY' }))
  on('command.run', { command: 'shape' }, async ($) => {
    const answer = await $.tool.call({ tool: 'Bash', command: 'printf synthetic; printf synthetic >&2' })
    return { text: JSON.stringify({ envelope: Object.keys(answer), result: Object.keys(answer.result ?? {}), fieldTypes: Object.fromEntries(Object.entries(answer.result ?? {}).map(([key, value]) => [key, typeof value])) }) }
  })
}
