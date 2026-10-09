import type { On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import {
  deferred,
  localCommand,
  readRequest,
  syntheticResponse,
  syntheticStorageReply,
} from './fixtures/host.ts';

const start = {
  surface: 'terminal',
  isInteractive: true,
  cwd: '/synthetic',
} as const;
const prompt = {
  text: 'SYNTHETIC_RAW',
  wait: false,
  origin: { kind: 'composer' },
} as const;
const saved = {
  schemaVersion: 1,
  rules: [
    {
      kind: 'token',
      id: 'recovered-rule',
      prefix: 'synthetic_',
      alphabet: 'alnum',
      run: { kind: 'exact', length: 16 },
      specificity: 'contextual',
      validator: 'none',
      action: 'redact',
    },
  ],
} as const;
function fixture(on: On) {
  const control = {
    settingsFault: '',
    scanFault: '',
    loads: 0,
    checks: 0,
    scans: 0,
    delivered: 0,
    gate: null as ReturnType<typeof deferred> | null,
    began: null as ReturnType<typeof deferred> | null,
    revisions: [] as string[],
    scanGate: null as ReturnType<typeof deferred> | null,
    scanBegan: null as ReturnType<typeof deferred> | null,
  };
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.id', () => ({ value: 'recovery-session' }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  on('ui.close', () => ({ value: undefined }));
  on('prompt.submit', (_$, e) => {
    control.delivered++;
    return { text: e.text };
  });
  on('process.run', async (_$, e) => {
    const storage = syntheticStorageReply(
      e.init?.stdin,
      saved,
      '12345678-1234-1234-1234-123456789abc',
    );
    if (storage) {
      expect(e.init?.timeoutMs).toBe(5000);
      control.loads++;
      if (control.gate) {
        control.began?.resolve();
        await control.gate.promise;
      }
      if (control.settingsFault === 'process')
        return { deny: 'SYNTHETIC_PROCESS_FAILURE' };
      if (control.settingsFault) {
        const base = JSON.parse(storage.value.stdout);
        storage.value.stdout = JSON.stringify({
          protocolVersion: 2,
          requestId: base.requestId,
          status: 'failed',
          engineVersion: base.engineVersion,
          policyId: base.policyId,
          errorCode: control.settingsFault,
        });
      }
      return storage;
    }
    const request = readRequest(e.init?.stdin);
    expect(e.init?.timeoutMs).toBe(2000);
    if (request.operation === 'self-check') control.checks++;
    if (request.operation === 'sanitize') {
      control.scans++;
      control.revisions.push(request.config?.revision ?? '');
    }
    const capturedFault = control.scanFault;
    if (request.operation === 'sanitize' && control.scanGate) {
      const gate = control.scanGate;
      control.scanGate = null;
      control.scanBegan?.resolve();
      await gate.promise;
    }
    const response =
      request.operation === 'sanitize' && capturedFault
        ? {
            protocolVersion: 2,
            requestId: request.requestId,
            configRevision: request.config?.revision,
            engineVersion: '0.1.0-beta.14',
            policyId: 'credentials-alpha1',
            status: 'failed',
            errorCode: capturedFault,
          }
        : syntheticResponse(request);
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
  return control;
}
for (const code of ['SETTINGS_BUSY', 'TIMEOUT', 'process']) {
  test(`explicit recovery restores exact approved rules after first-load ${code}`, async ($, on) => {
    const f = fixture(on);
    f.settingsFault = code;
    await $.session.start(start);
    expect((await $.prompt.submit(prompt)).drop).toBe('REDACTON_UNAVAILABLE');
    expect(f.delivered).toBe(0);
    expect(f.checks).toBe(0);
    f.settingsFault = '';
    expect((await $.command.run(localCommand('redacton'))).text).toContain(
      'Protect ready',
    );
    const status = await $.command.run(localCommand('redact:status'));
    expect(status.text).toContain('recovered-rule');
    await $.prompt.submit(prompt);
    expect(f.delivered).toBe(1);
    expect(f.loads).toBe(2);
    expect(f.checks).toBe(1);
    expect(status.text).toContain(f.revisions[0] ?? 'NO_REVISION');
  });
}
test('concurrent explicit retries coalesce and OFF cancels stale activation without helper dispatch', async ($, on) => {
  const f = fixture(on);
  f.settingsFault = 'SETTINGS_BUSY';
  await $.session.start(start);
  f.settingsFault = '';
  f.gate = deferred();
  f.began = deferred();
  const first = $.command.run(localCommand('redacton'));
  await f.began.promise;
  const second = $.command.run(localCommand('redacton'));
  expect((await $.prompt.submit(prompt)).drop).toBe('REDACTON_UNAVAILABLE');
  expect(f.delivered).toBe(0);
  await $.command.run(localCommand('redactoff'));
  const calls = f.loads + f.checks + f.scans;
  f.gate.resolve();
  await Promise.all([first, second]);
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'Redacton OFF',
  );
  expect(f.checks).toBe(0);
  expect(f.loads).toBe(2);
  await $.prompt.submit(prompt);
  expect(f.loads + f.checks + f.scans).toBe(calls);
  f.gate = null;
  expect((await $.command.run(localCommand('redacton'))).text).toContain(
    'Protect ready',
  );
});
test('corrupt settings give actionable local scope remediation and never implicitly retry', async ($, on) => {
  const f = fixture(on);
  f.settingsFault = 'SETTINGS_CORRUPT';
  await $.session.start(start);
  expect((await $.command.run(localCommand('redacton'))).text).toContain(
    'explicitly remove that scope file',
  );
  await $.prompt.submit(prompt);
  await $.prompt.submit(prompt);
  expect(f.loads).toBe(2);
  expect(f.delivered).toBe(0);
  expect(f.checks).toBe(0);
});
for (const code of [
  'FINDING_LIMIT',
  'INPUT_LIMIT',
  'OUTPUT_LIMIT',
  'PRIVATE_KEY_BLOCKED',
  'RULE_BLOCKED',
]) {
  test(`${code} withholds only its event and subsequent supported event succeeds`, async ($, on) => {
    const f = fixture(on);
    await $.session.start(start);
    f.scanFault = code;
    expect((await $.prompt.submit(prompt)).drop).toBe(code);
    expect((await $.command.run(localCommand('redact:status'))).text).toContain(
      'Protect ready',
    );
    expect((await $.command.run(localCommand('redact:status'))).text).toContain(
      code,
    );
    f.scanFault = '';
    expect((await $.prompt.submit(prompt)).text).toBe('SANITIZED');
    expect(f.delivered).toBe(1);
    expect(f.checks).toBe(1);
  });
}
for (const code of [
  'ENGINE_FAILURE',
  'ENGINE_VERSION',
  'ENGINE_UNAVAILABLE',
  'ENGINE_RESPONSE',
  'INVALID_CONFIG',
  'POLICY_FAILURE',
  'TIMEOUT',
]) {
  test(`${code} invalidates scanner health until explicit bounded self-check`, async ($, on) => {
    const f = fixture(on);
    await $.session.start(start);
    f.scanFault = code;
    expect((await $.prompt.submit(prompt)).drop).toBe(code);
    f.scanFault = '';
    expect((await $.prompt.submit(prompt)).drop).toBe('REDACTON_UNAVAILABLE');
    expect(f.delivered).toBe(0);
    await $.command.run(localCommand('redacton'));
    expect((await $.prompt.submit(prompt)).text).toBe('SANITIZED');
    expect(f.checks).toBe(2);
  });
}

test('session reset during held recovery rejects stale approved activation and readiness writes', async ($, on) => {
  const f = fixture(on);
  f.settingsFault = 'SETTINGS_BUSY';
  await $.session.start(start);
  f.settingsFault = '';
  f.gate = deferred();
  f.began = deferred();
  const recovery = $.command.run(localCommand('redacton'));
  await f.began.promise;
  await $.session.end({
    sessionId: 'recovery-session',
    reason: 'clear',
    resume: { id: 'recovery-session' },
  });
  f.gate.resolve();
  await recovery;
  f.gate = null;
  const status = await $.command.run(localCommand('redact:status'));
  expect(status.text).toContain('0 custom rules');
  expect(status.text).toContain('Protect loading');
  await $.prompt.submit(prompt);
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'recovered-rule',
  );
});
test('old scanner failure cannot poison a completed self-check recovery', async ($, on) => {
  const f = fixture(on);
  await $.session.start(start);
  f.scanFault = 'ENGINE_FAILURE';
  const gate = deferred();
  f.scanGate = gate;
  f.scanBegan = deferred();
  const old = $.prompt.submit(prompt);
  await f.scanBegan.promise;
  f.scanFault = '';
  await $.command.run(localCommand('redacton'));
  gate.resolve();
  expect((await old).drop).toBe('ENGINE_FAILURE');
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'Protect ready',
  );
  expect((await $.prompt.submit(prompt)).text).toBe('SANITIZED');
});
test('concurrent successful scan cannot clear another operation systemic failure', async ($, on) => {
  const f = fixture(on);
  await $.session.start(start);
  const gate = deferred();
  f.scanGate = gate;
  f.scanBegan = deferred();
  const good = $.prompt.submit(prompt);
  await f.scanBegan.promise;
  f.scanFault = 'ENGINE_FAILURE';
  expect((await $.prompt.submit(prompt)).drop).toBe('ENGINE_FAILURE');
  gate.resolve();
  expect((await good).text).toBe('SANITIZED');
  expect((await $.command.run(localCommand('redact:status'))).text).toContain(
    'Protect unavailable',
  );
});
