let calls = 0
let configured = false
export function register(on) {
  on('process.run', ($, e, next) => { calls += 1;try{const request=JSON.parse(e.init?.stdin??'{}');if(request.operation==='sanitize')configured=request.config?.rules?.some(rule=>rule.kind==='token' && rule.id==='synthetic.rule' && rule.prefix==='syntheticcred_' && rule.run?.length===16)??false;}catch{} return next(e) })
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'helpercount', description: 'Return fixed helper dispatch count' })
    return next(e)
  })
  on('command.run', { command: 'helpercount' }, () => ({ text: 'HELPER_CALLS_' + calls + ' CONFIG_EXPECTED_' + configured }))
}
