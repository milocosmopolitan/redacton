export function register(on) {
  const observations = [];
  let reports = 0;
  let stdoutSanitizes = 0;
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'config-race-report', description: 'Fixed synthetic captured configuration metadata' });
    return next(e);
  });
  on('process.run', (_$, e, next) => {
    try {
      const request = JSON.parse(e.init?.stdin ?? '{}');
      if (request.operation === 'sanitize' && request.segments.some(segment => segment.id === 'stdout')) {
        stdoutSanitizes = Math.min(3, stdoutSanitizes + 1);
        const config = request.config;
        if (observations.length < 2 && /^cfg-[0-9]{1,6}-[0-9]{1,6}$/.test(config.revision) && Array.isArray(config.rules) && config.rules.length <= 1) {
          const rule = config.rules[0];
          const exactRule = !rule || (rule.kind === 'token' && rule.id === 'config-race-token' && rule.prefix === 'syntheticcred_' && rule.alphabet === 'alnum' && rule.run.kind === 'exact' && rule.run.length === 16 && rule.action === 'redact');
          observations.push({ revision: config.revision, rules: config.rules.length, exactRule });
        }
      }
    } catch {}
    return next(e);
  });
  on('command.run', { command: 'config-race-report' }, () => ({
    text: `CONFIG_RACE_REPORT_${++reports}_${stdoutSanitizes}_${observations.length}_${observations.map(value => `${value.revision}_${value.rules}_${value.exactRule ? 1 : 0}`).join('_')}`,
  }));
}
