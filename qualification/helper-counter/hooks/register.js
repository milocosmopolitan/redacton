let calls = 0
export function register(on) {
  on('process.run', ($, e, next) => { calls += 1; return next(e) })
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'helpercount', description: 'Return fixed helper dispatch count' })
    return next(e)
  })
  on('command.run', { command: 'helpercount' }, () => ({ text: 'HELPER_CALLS_' + calls }))
}
