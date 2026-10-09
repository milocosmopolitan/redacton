export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ui-tool-probe', description: 'Synthetic local Bash UI qualification' })
    return next(e)
  })
  on('command.run', { command: 'ui-tool-probe' }, async ($) => {
    const answer = await $.tool.call({ tool: 'Bash', command: 'printf UI_SYNTHETIC_ACTIVITY', description: 'Synthetic UI qualification' })
    return { text: answer.result?.stdout === 'UI_SYNTHETIC_ACTIVITY' ? 'UI_TOOL_COMPLETED' : 'UI_TOOL_NOT_COMPLETED' }
  }).catch(() => ({ text: 'UI_TOOL_NOT_COMPLETED' }))
}
