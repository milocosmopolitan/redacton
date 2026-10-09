import type { HookFor, On } from 'claude-code';
import { expect, test } from 'claude-code/testing';
import type { HelperRequest } from '../mod/protocol.ts';
import {
  deferred,
  localCommand,
  readRequest,
  syntheticResponse,
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
function setup(on: On, processHook: HookFor<'process.run'>) {
  on('session.start', () => ({ cwd: '/synthetic' }));
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }));
  on('session.id', () => ({ value: 'resource-session' }));
  on('command.register', (_$, e) => ({ value: { command: e.name } }));
  on('ui.log', () => ({ value: undefined }));
  on('ui.toast', () => ({ value: undefined }));
  on('process.run', processHook).catch(() => ({
    deny: 'SYNTHETIC_PROCESS_FAILURE',
  }));
}
function reply(request: HelperRequest) {
  return {
    value: {
      exitCode: 0,
      stdout: JSON.stringify(syntheticResponse(request)),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  };
}

test('five concurrent prompts dispatch at most four helpers and withhold the saturated operation', async ($, on) => {
  let active = 0,
    maximum = 0,
    sanitizes = 0;
  const fourStarted = deferred();
  const gate = deferred();
  setup(on, async (_$, e) => {
    const request = readRequest(e.init?.stdin);
    if (request.operation === 'self-check') return reply(request);
    sanitizes++;
    active++;
    maximum = Math.max(maximum, active);
    if (active === 4) fourStarted.resolve();
    await gate.promise;
    active--;
    return reply(request);
  });
  let delivered = 0;
  on('prompt.submit', (_$, e) => {
    delivered++;
    return { text: e.text };
  });
  await $.session.start(start);
  const operations = Array.from({ length: 5 }, () => $.prompt.submit(prompt));
  await fourStarted.promise;
  gate.resolve();
  const results = await Promise.all(operations);
  expect(maximum).toBe(4);
  expect(sanitizes).toBe(4);
  expect(delivered).toBe(4);
  expect(
    results.filter((result) => result.drop === 'QUEUE_SATURATED').length,
  ).toBe(1);
});

for (const fault of [
  'wrong-request',
  'duplicate-segment',
  'missing-segment',
  'unknown-status',
  'unknown-count',
  'truncated',
  'process-throw',
  'process-denied',
]) {
  test(`protected prompt is withheld for ${fault} process behavior`, async ($, on) => {
    setup(on, (_$, e) => {
      const request = readRequest(e.init?.stdin);
      if (request.operation === 'self-check') return reply(request);
      if (fault === 'process-throw') throw new Error('SYNTHETIC_TIMEOUT');
      if (fault === 'process-denied') return { deny: 'SYNTHETIC_MISSING_NODE' };
      const result = reply(request);
      const response = syntheticResponse(request);
      if (fault === 'wrong-request') response.requestId = 'unrelated';
      if (fault === 'duplicate-segment') {
        const first = response.segments?.[0];
        if (!first) throw new Error('INVALID_FIXTURE_SEGMENTS');
        response.segments?.push(first);
      }
      if (fault === 'missing-segment') response.segments = [];
      if (fault === 'unknown-status') response.status = 'partial';
      if (fault === 'unknown-count')
        response.findingCounts = { secret_hash: 1 };
      if (fault === 'truncated') result.value.isStdoutTruncated = true;
      result.value.stdout = JSON.stringify(response);
      return result;
    });
    let delivered = 0;
    on('prompt.submit', () => {
      delivered++;
      return { text: 'SYNTHETIC_RAW' };
    });
    await $.session.start(start);
    const result = await $.prompt.submit(prompt);
    expect(result.drop).toBeDefined();
    expect(delivered).toBe(0);
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_RAW');
    expect(JSON.stringify(result)).not.toContain('secret_hash');
  });
}

test('failed self-check cannot report ready or dispatch a protected original operation', async ($, on) => {
  let processes = 0,
    executed = 0,
    delivered = 0;
  setup(on, () => {
    processes++;
    return { deny: 'SYNTHETIC_MISSING_NODE' };
  });
  on('tool.call', () => {
    executed++;
    return {
      result: { stdout: 'SYNTHETIC_RAW', stderr: '', interrupted: false },
    };
  });
  on('prompt.submit', () => {
    delivered++;
    return { text: 'SYNTHETIC_RAW' };
  });
  await $.session.start(start);
  expect((await $.prompt.submit(prompt)).drop).toBe('REDACTON_UNAVAILABLE');
  expect(
    (await $.tool.call({ tool: 'Bash', command: 'synthetic-command' })).deny,
  ).toBe('REDACTON_UNAVAILABLE');
  expect(processes).toBe(1);
  expect(executed).toBe(0);
  expect(delivered).toBe(0);
});

test('repeated session.start resets OFF to ON and rechecks readiness', async ($, on) => {
  const operations: string[] = [];
  setup(on, (_$, e) => {
    const request = readRequest(e.init?.stdin);
    operations.push(request.operation);
    return reply(request);
  });
  on('prompt.submit', (_$, e) => ({ text: e.text }));
  await $.session.start(start);
  await $.command.run(localCommand('redactoff'));
  await $.session.start(start);
  expect((await $.prompt.submit(prompt)).text).toBe('SANITIZED');
  expect(operations).toEqual(['self-check', 'self-check', 'sanitize']);
});

test('session.end resume clears OFF; next prompt lazily checks readiness then sanitizes', async ($, on) => {
  const operations: string[] = [];
  setup(on, (_$, e) => {
    const request = readRequest(e.init?.stdin);
    operations.push(request.operation);
    return reply(request);
  });
  on('prompt.submit', (_$, e) => ({ text: e.text }));
  await $.session.start(start);
  await $.command.run(localCommand('redactoff'));
  await $.session.end({
    reason: 'resume',
    sessionId: 'resource-session',
    resume: { id: 'resource-session' },
  });
  expect((await $.prompt.submit(prompt)).text).toBe('SANITIZED');
  expect(operations).toEqual(['self-check', 'self-check', 'sanitize']);
});
