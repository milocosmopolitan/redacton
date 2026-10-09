import type { On } from 'claude-code';

interface SanitizedBash {
  result: { stdout: string; stderr: string; interrupted: boolean };
}
const accepted = new Map<string, SanitizedBash>();

export function register(on: On) {
  on('prompt.submit', (_$, e, next) =>
    next({ ...e, text: e.text.replaceAll('SPIKE_RAW', 'SPIKE_SANITIZED') }),
  ).catch(() => ({ drop: 'SPIKE_OUTER_BLOCKED' }));

  // The outer hook owns the result boundary even when the inner hook is skipped.
  on('tool.call', { tool: ['Read', 'Bash'] }, async (_$, e, next) => {
    if (e.tool === 'Bash' && e.command.includes('unguarded')) return next(e);
    accepted.delete(e.tool_use_id);
    try {
      await next(e);
      if (!accepted.has(e.tool_use_id)) return { deny: 'SPIKE_OUTER_BLOCKED' };
      return accepted.get(e.tool_use_id) ?? { deny: 'SPIKE_OUTER_BLOCKED' };
    } finally {
      accepted.delete(e.tool_use_id);
    }
  }).catch(() => ({ deny: 'SPIKE_OUTER_BLOCKED' }));

  on('tool.call', { tool: 'Bash' }, async (_$, e, next) => {
    const answer = await next(e);
    if (
      e.command.includes('spike-throw') ||
      e.command.includes('spike-catch-throw')
    )
      throw new Error('SPIKE_FAILURE');
    if (answer.context?.length) return { deny: 'SPIKE_CONTEXT_BLOCKED' };
    const sanitized = {
      result: { stdout: 'SPIKE_SANITIZED', stderr: '', interrupted: false },
    };
    accepted.set(e.tool_use_id, sanitized);
    return sanitized;
  }).catch((_$, e) => {
    if (e.command.includes('spike-catch-throw'))
      throw new Error('SPIKE_CATCH_FAILURE');
    return { deny: 'SPIKE_CATCH_BLOCKED' };
  });
}
