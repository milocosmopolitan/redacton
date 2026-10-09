import { expect, test } from 'claude-code/testing';
import {
  localCommand,
  readRequest,
  syntheticResponse,
  syntheticStorageReply,
} from './fixtures/host.ts';

test('immediate config command shares the local pane, rejects arguments and protects failed registration fallback even OFF', async ($, on) => {
  const registrations: { name: string; immediate?: true }[] = [];
  let helperCalls = 0;
  const opened: string[] = [];
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.id', () => ({ value: 'config-command-session' }));
  on('command.register', (_$, e) => {
    registrations.push(e);
    return { value: { command: e.name } };
  });
  on('prompt.fill', () => ({ isFilled: true }));
  on('ui.focus', () => ({ deny: 'SYNTHETIC_FOCUS_DENIED' }));
  on('ui.open', (_$, e) => {
    opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on('ui.close', () => ({ value: undefined }));
  on('prompt.submit', (_$, e) => ({ text: e.text }));
  on('process.run', (_$, e) => {
    helperCalls++;
    const storage = syntheticStorageReply(e.init?.stdin);
    return (
      storage ?? {
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
  expect(
    registrations.find((value) => value.name === 'redactconfig')?.immediate,
  ).toBe(true);
  await $.command.run(localCommand('redactoff'));
  const before = helperCalls;
  const rejected = await $.command.run({
    ...localCommand('redactconfig'),
    args: 'SYNTHETIC_ARG',
  });
  expect(rejected.text).toContain('no arguments');
  expect(rejected.text).not.toContain('SYNTHETIC_ARG');
  expect(opened.length).toBe(0);
  expect(
    (
      await $.prompt.submit({
        text: '/redactconfig SYNTHETIC_ARG',
        wait: false,
        origin: { kind: 'composer' },
      })
    ).drop,
  ).toBe('REDACTON_LOCAL_COMMAND_UNAVAILABLE');
  expect(helperCalls).toBe(before);
  const result = await $.command.run(localCommand('redactconfig'));
  expect(result.text).toContain('local panel opened');
  expect(opened).toEqual(['redact-config']);
  expect(helperCalls).toBe(before);
});
