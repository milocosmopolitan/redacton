export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ui-tool-probe', description: 'Synthetic local Bash UI qualification' })
    await $.command.register({name:'ui-custom-probe',description:'Synthetic local configured credential qualification'})
    return next(e)
  })
  on('command.run', {command:'ui-custom-probe'}, async ($)=>{
    const answer=await $.tool.call({tool:'Bash',command:"printf x >> ui-execution-counter; printf '%s\\n' 'syntheticcred_ABCDEF0123456789'; printf '%s\\n' 'syntheticcred_ABCDEF0123456789' >&2",description:'Synthetic configured credential qualification'});
    const result=answer.result;
    const denied=['REDACTON_UNAVAILABLE','REDACTON_UNSUPPORTED_SHAPE','REDACTON_WITHHELD','REDACTON_TOOL_DENIED','REDACTON_INPUT_LIMIT'].includes(answer.deny)?answer.deny:'OTHER';
    const combined=String(result?.stdout??'')+String(result?.stderr??'');
    return {text:!combined.includes('syntheticcred_ABCDEF0123456789') && combined.includes('<SECRET_1>')?'UI_CUSTOM_SANITIZED':combined.includes('syntheticcred_ABCDEF0123456789')?'UI_CUSTOM_RAW_OFF':`UI_CUSTOM_WITHHELD_${denied}`}

  }).catch(()=>({text:'UI_CUSTOM_WITHHELD'}))
  on('command.run', { command: 'ui-tool-probe' }, async ($) => {
    const answer = await $.tool.call({ tool: 'Bash', command: 'printf UI_SYNTHETIC_ACTIVITY', description: 'Synthetic UI qualification' })
    return { text: answer.result?.stdout === 'UI_SYNTHETIC_ACTIVITY' ? 'UI_TOOL_COMPLETED' : 'UI_TOOL_NOT_COMPLETED' }
  }).catch(() => ({ text: 'UI_TOOL_NOT_COMPLETED' }))
}
