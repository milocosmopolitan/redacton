export function register(on) {
  let scans = 0;
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'race-report', description: 'Fixed synthetic tool scanner count' });
    return next(e);
  });
  on('process.run', (_$, e, next) => {
    try {
      const request = JSON.parse(e.init?.stdin ?? '{}');
      if (request.operation === 'sanitize' && request.segments.some(segment => segment.id === 'stdout')) scans++;
    } catch {}
    return next(e);
  });
  on('command.run', { command: 'race-report' }, () => ({ text: `RACE_REPORT_${scans}` }));
}
