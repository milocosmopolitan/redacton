export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'spike', description: 'Local synthetic compatibility probe' })
    return next(e)
  })
  on('command.run', { command: 'spike' }, async () => ({ text: 'SPIKE_LOCAL_OK' }))
  on('prompt.submit', async ($, e, next) => {
    if (e.text === 'SPIKE_THROW') throw new Error('SPIKE_FAILURE')
    if (e.text === 'SPIKE_DROP') return { drop: 'SPIKE_BLOCKED' }
    return next({ ...e, text: e.text.replaceAll('SPIKE_RAW', 'SPIKE_SANITIZED') })
  }).catch(() => ({ drop: 'SPIKE_CATCH_BLOCKED' }))
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const snapshot = e.command
    const answer = await next(e)
    if (snapshot.includes('spike-throw') || snapshot.includes('spike-catch-throw')) throw new Error('SPIKE_FAILURE')
    if (snapshot.includes('spike-invalid')) return { result: null }
    if (snapshot === 'spike-raw') return answer
    if (answer.context?.length) return { deny: 'SPIKE_CONTEXT_BLOCKED' }
    return { result: { stdout: 'SPIKE_SANITIZED', stderr: '', interrupted: false } }
  }).catch(($, e) => {
    if (e.command.includes('spike-catch-throw')) throw new Error('SPIKE_CATCH_FAILURE')
    return { deny: 'SPIKE_CATCH_BLOCKED' }
  })
}
