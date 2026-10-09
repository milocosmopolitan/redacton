import { expect, test } from 'claude-code/testing';
import {
  localCommand,
  readRequest,
  syntheticResponse,
  syntheticStorageReply,
} from './fixtures/host.ts';

test('plugin and SDK commands cannot disable protection or open settings; user commands stay local', async ($, on) => {
  let helpers = 0;
  let panels = 0;
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.id', () => ({ value: 'authority-session' }));
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  on('prompt.fill', () => ({ isFilled: true }));
  on('ui.open', () => {
    panels++;
    return { value: { isPlaced: true } };
  });
  on('ui.focus', () => ({ deny: 'SYNTHETIC_FOCUS_DENIED' }));
  on('process.run', (_$, e) => {
    helpers++;
    return (
      syntheticStorageReply(e.init?.stdin) ?? {
        value: {
          exitCode: 0,
          stdout: JSON.stringify(syntheticResponse(readRequest(e.init?.stdin))),
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    );
  });
  await $.session.start({
    surface: 'terminal',
    isInteractive: true,
    cwd: '/synthetic',
  });
  const before = helpers;
  for (const origin of [
    { kind: 'plugin', name: 'synthetic-plugin' } as const,
    { kind: 'sdk' } as const,
  ]) {
    for (const command of [
      'redactoff',
      'redactconfig',
      'redact:config',
      'redact:add-rule',
      'redact:remove-rule',
    ]) {
      const result = await $.command.run({ ...localCommand(command), origin });
      expect(result.text).toContain('REDACTON_USER_ACTION_REQUIRED');
    }
    const status = await $.command.run({
      ...localCommand('redact:status'),
      origin,
    });
    expect(status.text).toContain('Redacton ON');
  }
  expect(helpers).toBe(before);
  expect(panels).toBe(0);
  const off = await $.command.run(localCommand('redactoff'));
  expect(off.text).toContain('Redacton is OFF');
  expect(helpers).toBe(before);
  const onResult = await $.command.run({
    ...localCommand('redacton'),
    origin: { kind: 'sdk' },
  });
  expect(onResult.text).toContain('Redacton ON');
  const opened = await $.command.run(localCommand('redactconfig'));
  expect(opened.text).toContain('local panel opened');
  expect(panels).toBe(1);
});
