import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import type { ConfigDocument } from '../mod/config.ts';
import type { HelperRequest } from '../mod/protocol.ts';
import {
  deferred,
  localCommand,
  readRequest,
  stdoutOf,
  syntheticResponse,
  syntheticStorageReply,
} from './fixtures/host.ts';

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
const saved: ConfigDocument = {
  schemaVersion: 1,
  rules: [
    {
      kind: 'token',
      id: 'saved-token',
      prefix: 'synthetic_',
      alphabet: 'alnum',
      run: { kind: 'exact', length: 16 },
      specificity: 'contextual',
      validator: 'none',
      action: 'redact',
    },
  ],
};
function setup(
  on: On,
  document: ConfigDocument = { schemaVersion: 1, rules: [] },
  corrupt = false,
  loadGate?: { began: () => void; wait: Promise<void> },
  placed = true,
  validationGate?: { began: () => void; wait: Promise<void> },
) {
  const requests: HelperRequest[] = [];
  const operations: string[] = [];
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.id', () => ({ value: 'race-session' }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  on('ui.open', () => ({
    value: placed
      ? { isPlaced: true }
      : { isPlaced: false, reason: 'SYNTHETIC_UNSUPPORTED_SURFACE' },
  }));
  on('prompt.fill', () => ({ isFilled: true }));
  on('ui.focus', () => ({ deny: 'SYNTHETIC_FOCUS_DENIED' }));
  on('ui.close', () => ({ value: undefined }));
  on('process.run', async (_$, e) => {
    const storage = syntheticStorageReply(
      e.init?.stdin,
      document,
      '12345678-1234-1234-1234-123456789abc',
    );
    if (storage) {
      operations.push('load-config');
      if (loadGate) {
        loadGate.began();
        await loadGate.wait;
      }
      if (corrupt) {
        const value = JSON.parse(storage.value.stdout);
        storage.value.stdout = JSON.stringify({
          protocolVersion: 2,
          requestId: value.requestId,
          status: 'failed',
          engineVersion: '0.1.0-beta.14',
          policyId: 'credentials-alpha1',
          errorCode: 'SETTINGS_CORRUPT',
        });
      }
      return storage;
    }
    const request = readRequest(e.init?.stdin);
    requests.push(request);
    operations.push(request.operation);
    if (validationGate && request.operation === 'validate-config') {
      validationGate.began();
      await validationGate.wait;
    }
    return {
      value: {
        exitCode: 0,
        stdout: JSON.stringify(syntheticResponse(request)),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return { requests, operations };
}
test('tool completion uses captured configuration across mid-flight explicit Apply', async ($, on) => {
  const fixture = setup(on);
  const began = deferred();
  const gate = deferred();
  let executions = 0;
  on('tool.call', async () => {
    executions++;
    if (executions === 1) {
      began.resolve();
      await gate.promise;
    }
    return {
      result: { stdout: 'SYNTHETIC_RAW', stderr: '', interrupted: false },
    };
  });
  await $.session.start(start);
  const initial = fixture.requests.find(
    (request) => request.operation === 'self-check',
  )?.config;
  expect(initial).toBeDefined();
  const operation = $.tool.call({ tool: 'Bash', command: 'synthetic-command' });
  await began.promise;
  await $.command.run(localCommand('redact:add-rule'));
  const ui = await $.ui.mount(pane);
  await ui.input({ key: 'rule-id', text: 'race-token', kind: 'change' });
  await ui.input({ key: 'prefix', text: 'synthetic_', kind: 'change' });
  for (const key of ['build', 'validate', 'preview', 'apply'])
    await ui.press({ key });
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'race-token',
  );
  gate.resolve();
  expect(stdoutOf(await operation)).toBe('SANITIZED');
  const first = fixture.requests.find(
    (request) => request.operation === 'sanitize',
  );
  expect(first?.config?.revision).toBe(initial?.revision);
  expect(first?.config?.rules.length).toBe(0);
  await $.tool.call({ tool: 'Bash', command: 'synthetic-command' });
  const scans = fixture.requests.filter(
    (request) => request.operation === 'sanitize',
  );
  expect(scans[1]?.config?.rules[0]?.id).toBe('race-token');
  expect(scans[1]?.config?.revision).not.toBe(initial?.revision);
  expect(executions).toBe(2);
  await ui.unmount();
});
test('personal defaults restore on resume with ON and exact rules; cached status dispatches nothing', async ($, on) => {
  const fixture = setup(on, saved);
  on('prompt.submit', (_$, e) => ({ text: e.text }));
  await $.session.start(start);
  const before = fixture.operations.length;
  const firstStatus = await $.command.run(localCommand('redact:status'));
  expect(firstStatus.text).toContain('saved-token');
  expect(fixture.operations.length).toBe(before);
  await $.command.run(localCommand('redactoff'));
  await $.session.end({
    reason: 'resume',
    sessionId: 'race-session',
    resume: { id: 'race-session' },
  });
  const beforeLazy = fixture.operations.length;
  await $.command.run(localCommand('redact:status'));
  expect(fixture.operations.length).toBe(beforeLazy);
  await $.prompt.submit({
    text: 'SYNTHETIC_RAW',
    wait: false,
    origin: { kind: 'composer' },
  });
  const scan = fixture.requests.findLast(
    (request) => request.operation === 'sanitize',
  );
  expect(scan?.config?.rules).toEqual(saved.rules);
  expect(
    fixture.operations.filter((operation) => operation === 'load-config')
      .length,
  ).toBe(2);
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'Redacton ON',
  );
});
test('corrupt personal defaults stay visibly unavailable and withhold without raw delivery', async ($, on) => {
  const fixture = setup(on, saved, true);
  let delivered = 0;
  on('prompt.submit', () => {
    delivered++;
    return { text: 'SYNTHETIC_RAW' };
  });
  await $.session.start(start);
  const status = await $.command.run(localCommand('redact:status'));
  expect(status.text).toContain('SETTINGS_CORRUPT');
  expect(status.text).not.toContain('saved-token');
  const before = fixture.operations.length;
  await $.command.run(localCommand('redact:status'));
  expect(fixture.operations.length).toBe(before);
  const result = await $.prompt.submit({
    text: 'SYNTHETIC_RAW',
    wait: false,
    origin: { kind: 'composer' },
  });
  expect(result.drop).toBeDefined();
  expect(delivered).toBe(0);
  expect(
    fixture.requests.filter((request) => request.operation === 'sanitize')
      .length,
  ).toBe(0);
});

test('in-flight custom configuration survives session reset-rule Apply; later operations use empty custom list', async ($, on) => {
  const fixture = setup(on, saved);
  const began = deferred();
  const gate = deferred();
  let executions = 0;
  on('tool.call', async () => {
    executions++;
    if (executions === 1) {
      began.resolve();
      await gate.promise;
    }
    return {
      result: { stdout: 'SYNTHETIC_RAW', stderr: '', interrupted: false },
    };
  });
  await $.session.start(start);
  const initial = fixture.requests.find(
    (request) => request.operation === 'self-check',
  )?.config;
  const operation = $.tool.call({ tool: 'Bash', command: 'synthetic-command' });
  await began.promise;
  await $.command.run(localCommand('redact:config'));
  const ui = await $.ui.mount(pane);
  for (const key of ['reset', 'validate', 'preview', 'apply'])
    await ui.press({ key });
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    '0 custom rules',
  );
  gate.resolve();
  expect(stdoutOf(await operation)).toBe('SANITIZED');
  await $.tool.call({ tool: 'Bash', command: 'synthetic-command' });
  const scans = fixture.requests.filter(
    (request) => request.operation === 'sanitize',
  );
  expect(scans[0]?.config?.revision).toBe(initial?.revision);
  expect(scans[0]?.config?.rules).toEqual(saved.rules);
  expect(scans[1]?.config?.rules.length).toBe(0);
  expect(scans[1]?.config?.revision).not.toBe(initial?.revision);
  expect(executions).toBe(2);
  await ui.unmount();
});

test('held automatic personal load cannot replace a newer explicit session configuration', async ($, on) => {
  const began = deferred();
  const held = deferred();
  setup(on, saved, false, { began: began.resolve, wait: held.promise });
  const starting = $.session.start(start);
  await began.promise;
  await $.command.run(localCommand('redact:add-rule'));
  const ui = await $.ui.mount(pane);
  await ui.input({ key: 'rule-id', text: 'session-winner', kind: 'change' });
  await ui.input({ key: 'prefix', text: 'synthetic_', kind: 'change' });
  for (const key of ['build', 'validate', 'preview', 'apply'])
    await ui.press({ key });
  held.resolve();
  await starting;
  const status = await $.command.run(localCommand('redact:status'));
  expect(status.text).toContain('session-winner');
  expect(status.text).not.toContain('saved-token');
  expect(status.text).toContain('source session');
  await ui.unmount();
});

test('open local panel withholds accidental composer submission even OFF; explicit close restores chat', async ($, on) => {
  const fixture = setup(on);
  let delivered = 0;
  on('prompt.submit', (_$, e) => {
    delivered++;
    return { text: e.text };
  });
  await $.session.start(start);
  await $.command.run(localCommand('redactoff'));
  await $.command.run(localCommand('redact:add-rule'));
  const ui = await $.ui.mount(pane);
  const before = fixture.operations.length;
  const prompt = {
    text: 'SYNTHETIC_FORM_ACCIDENT',
    wait: false,
    origin: { kind: 'composer' },
  } as const;
  expect((await $.prompt.submit(prompt)).drop).toBe(
    'REDACTON_CLOSE_LOCAL_PANEL_BEFORE_PROMPT',
  );
  expect(delivered).toBe(0);
  expect(fixture.operations.length).toBe(before);
  await ui.press({ key: 'cancel' });
  expect((await $.prompt.submit(prompt)).text).toBe('SYNTHETIC_FORM_ACCIDENT');
  expect(delivered).toBe(1);
  expect(fixture.operations.length).toBe(before);
  await ui.unmount();
});
test('unplaced local panel never leaves ordinary composer submission blocked', async ($, on) => {
  setup(on, { schemaVersion: 1, rules: [] }, false, undefined, false);
  on('prompt.submit', (_$, e) => ({ text: e.text }));
  await $.session.start(start);
  await $.command.run(localCommand('redactoff'));
  expect((await $.command.run(localCommand('redact:config'))).text).toContain(
    'unavailable',
  );
  expect(
    (
      await $.prompt.submit({
        text: 'SYNTHETIC_CHAT',
        wait: false,
        origin: { kind: 'composer' },
      })
    ).text,
  ).toBe('SYNTHETIC_CHAT');
});

test('session reset cancels pending form validation; late receipt cannot authorize a reopened draft', async ($, on) => {
  const began = deferred();
  const held = deferred();
  setup(on, { schemaVersion: 1, rules: [] }, false, undefined, true, {
    began: began.resolve,
    wait: held.promise,
  });
  await $.session.start(start);
  await $.command.run(localCommand('redact:add-rule'));
  const oldUi = await $.ui.mount(pane);
  await oldUi.input({ key: 'rule-id', text: 'old-rule', kind: 'change' });
  await oldUi.input({ key: 'prefix', text: 'old_synthetic_', kind: 'change' });
  await oldUi.press({ key: 'build' });
  const validating = oldUi.press({ key: 'validate' });
  await began.promise;
  await $.session.end({
    reason: 'clear',
    sessionId: 'race-session',
    resume: { id: 'race-session' },
  });
  await oldUi.unmount();
  await $.command.run(localCommand('redact:add-rule'));
  const newUi = await $.ui.mount(pane);
  await newUi.input({ key: 'rule-id', text: 'new-rule', kind: 'change' });
  await newUi.input({ key: 'prefix', text: 'new_synthetic_', kind: 'change' });
  await newUi.press({ key: 'build' });
  const before = (await $.command.run(localCommand('redact:status'))).text;
  held.resolve();
  await validating;
  expect(await newUi.find({ type: 'Text', text: /editing/ })).toBeDefined();
  await newUi.press({ key: 'apply' });
  expect((await $.command.run(localCommand('redact:status'))).text).toBe(
    before,
  );
  expect(
    (await $.command.run(localCommand('redact:status'))).text,
  ).not.toContain('old-rule');
  await newUi.press({ key: 'cancel' });
  await newUi.unmount();
});
