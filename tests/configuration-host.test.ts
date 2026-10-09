import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import {
  localCommand,
  readRequest,
  syntheticResponse,
  syntheticStorageReply,
} from './fixtures/host.ts';

function setup(on: On) {
  const calls: string[] = [];
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.id', () => ({ value: 'config-session' }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  on('prompt.fill', () => ({ isFilled: true }));
  on('ui.focus', () => ({ deny: 'SYNTHETIC_FOCUS_DENIED' }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.close', () => ({ value: undefined }));
  on('process.run', (_$, e) => {
    const storage = syntheticStorageReply(e.init?.stdin);
    if (storage) {
      calls.push('load-config');
      return storage;
    }
    const request = readRequest(e.init?.stdin);
    calls.push(request.operation);
    const base = syntheticResponse(request);
    let response: unknown = base;
    if (request.operation === 'validate-config')
      response = {
        ...base,
        findingCounts: undefined,
        validated: true,
        ruleCount: request.config.rules.length,
      };
    if (request.operation === 'preview')
      response = {
        ...base,
        findingCounts: undefined,
        outcomes: request.config.rules.map((rule) => ({
          id: rule.id,
          positive: {
            detected: true,
            action: rule.action,
            findingCounts: {
              [rule.kind === 'token' ? rule.id : 'contextual_secret']: 1,
            },
          },
          negative: { detected: false, action: 'none', findingCounts: {} },
        })),
      };
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify(response),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return calls;
}
const start = {
  surface: 'terminal',
  isInteractive: true,
  cwd: '/synthetic',
} as const;
const pane = {
  plugin: 'redact',
  component: 'Pane',
  requestId: 'redact-config',
  surface: 'terminal',
  viewport: { columns: 80, rows: 40 },
  props: {
    title: 'Local configuration',
    isFocused: true,
    bodyColumns: 78,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 38 },
    view: {},
  },
} as const;
test('status is cached, all namespaced arguments reject locally, OFF management dispatches zero helpers', async ($, on) => {
  const calls = setup(on);
  await $.session.start(start);
  const before = calls.length;
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'Cached observation',
  );
  for (const name of ['status', 'config', 'add-rule', 'remove-rule']) {
    const result = await $.command.run({
      ...localCommand(`redact:${name}`),
      args: 'SYNTHETIC_LOCAL_ARG',
    });
    expect(result.text).not.toContain('SYNTHETIC_LOCAL_ARG');
    expect(result.text).toContain('no arguments');
  }
  expect(calls.length).toBe(before);
  await $.command.run(localCommand('redactoff'));
  await $.command.run(localCommand('redact:add-rule'));
  const ui = await $.ui.mount(pane);
  await ui.input({ key: 'rule-id', text: 'synthetic-rule', kind: 'change' });
  await ui.input({ key: 'prefix', text: 'synthetic_', kind: 'change' });
  await ui.press({ key: 'build' });
  await ui.press({ key: 'validate' });
  for (const key of [
    'load-personal',
    'load-project',
    'save-personal',
    'save-project',
    'preview',
  ])
    await ui.press({ key });
  expect(calls.length).toBe(before);
  expect(await ui.find({ type: 'Text', text: /Redacton OFF/ })).toBeDefined();
  await ui.unmount();
});
test('draft validate and preview before apply; new operations bind revision and cancellation leaves active unchanged', async ($, on) => {
  const calls = setup(on);
  on('prompt.submit', (_$, e) => ({ text: e.text }));
  await $.session.start(start);
  const initial = (await $.command.run(localCommand('redact:status'))).text;
  await $.command.run(localCommand('redact:add-rule'));
  const ui = await $.ui.mount(pane);
  await ui.input({ key: 'rule-id', text: 'synthetic-rule', kind: 'change' });
  await ui.input({ key: 'prefix', text: 'synthetic_', kind: 'change' });
  await ui.press({ key: 'build' });
  await ui.press({ key: 'apply' });
  expect((await $.command.run(localCommand('redact:status'))).text).toBe(
    initial,
  );
  await ui.press({ key: 'validate' });
  await ui.press({ key: 'preview' });
  await ui.press({ key: 'apply' });
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'synthetic-rule',
  );
  expect(calls.filter((value) => value === 'validate-config').length).toBe(1);
  expect(calls.filter((value) => value === 'preview').length).toBe(1);
  await ui.press({ key: 'cancel' });
  await ui.unmount();
});
test('raw namespaced command fallback drops even while OFF', async ($, on) => {
  setup(on);
  let delivered = 0;
  on('prompt.submit', () => {
    delivered++;
    return { text: 'UNEXPECTED' };
  });
  await $.session.start(start);
  await $.command.run(localCommand('redactoff'));
  const result = await $.prompt.submit({
    text: '/redact:config SYNTHETIC_LOCAL_ARG',
    wait: false,
    origin: { kind: 'composer' },
  });
  expect(result.drop).toBe('REDACTON_LOCAL_COMMAND_UNAVAILABLE');
  expect(delivered).toBe(0);
});
