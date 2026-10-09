import type { On } from 'claude-code';

// Deliberately broken qualification-only hook, never packaged as the product.
export function register(on: On) {
  on('prompt.submit', (_$, event, next) =>
    next({
      ...event,
      text: event.text.replaceAll('SPIKE_RAW', 'SPIKE_SANITIZED'),
    }),
  ).catch(() => ({ drop: 'SPIKE_BLOCKED' }));
  on('tool.call', { tool: 'Bash' }, async (_$, event, next) => {
    await next(event);
    throw new Error('SPIKE_FAILURE');
  }).catch(() => {
    throw new Error('SPIKE_CATCH_FAILURE');
  });
}
