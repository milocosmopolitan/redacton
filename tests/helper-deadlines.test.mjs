import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LIMITS, POLICY_ID, requestDeadlineMs } from '../helper/dist/core.js';

const settings = {
  protocolVersion: 2,
  requestId: 'deadline-settings',
  operation: 'load-config',
  policyId: POLICY_ID,
  storage: { scope: 'personal', approved: true },
};
const selfCheck = {
  protocolVersion: 1,
  requestId: 'deadline-check',
  operation: 'self-check',
  policyId: POLICY_ID,
};
test('only complete validated storage routes gain the finite settings deadline', () => {
  assert.equal(LIMITS.timeoutMs, 2000);
  assert.equal(LIMITS.settingsTimeoutMs, 5000);
  const expected = {
    expectedIdentity: '0'.repeat(64),
    expectedRevision: 'absent',
    expectedDocument: { schemaVersion: 1, rules: [] },
  };
  for (const valid of [
    settings,
    { ...settings, operation: 'import-config' },
    {
      ...settings,
      operation: 'save-config',
      storage: {
        ...settings.storage,
        ...expected,
        document: { schemaVersion: 1, rules: [] },
      },
    },
    {
      ...settings,
      operation: 'reset-config',
      storage: { ...settings.storage, ...expected },
    },
    {
      ...settings,
      operation: 'export-config',
      storage: {
        ...settings.storage,
        expectedIdentity: expected.expectedIdentity,
        document: { schemaVersion: 1, rules: [] },
      },
    },
  ])
    assert.equal(requestDeadlineMs(valid), 5000);
  for (const invalid of [
    selfCheck,
    { ...settings, extra: true },
    { ...settings, protocolVersion: 1 },
    { ...settings, policyId: 'unknown' },
    { ...settings, requestId: 'invalid id' },
    { ...settings, storage: { scope: 'personal', approved: 'true' } },
    {
      ...settings,
      storage: { scope: 'project', approved: true, projectRoot: 'relative' },
    },
    {
      ...settings,
      operation: 'save-config',
      storage: {
        scope: 'personal',
        approved: true,
        expectedIdentity: '0'.repeat(64),
        expectedRevision: 'absent',
        expectedDocument: { schemaVersion: 1, rules: [] },
        document: { schemaVersion: 1, rules: [{ kind: 'arbitrary-code' }] },
      },
    },
  ])
    assert.equal(requestDeadlineMs(invalid), 2000);
});
async function child(request, initializationMs, inputDelayMs = 0) {
  const root = await mkdtemp(join(tmpdir(), 'redacton-deadline-'));
  let processChild;
  try {
    await cp(new URL('../helper/dist', import.meta.url), join(root, 'helper'), {
      recursive: true,
    });
    const helperPath = join(root, 'helper/index.js');
    const helper = await readFile(helperPath, 'utf8');
    const bootstrap = 'const startedAt = performance.now();';
    assert.equal(helper.includes(bootstrap), true);
    // Synchronize with the copied helper clock, not variable Node startup time.
    await writeFile(
      helperPath,
      helper.replace(
        bootstrap,
        `${bootstrap}\nprocess.send('BOOTSTRAP_READY');`,
      ),
    );
    await mkdir(join(root, 'node_modules/@redact-secret/core'), {
      recursive: true,
    });
    await writeFile(
      join(root, 'node_modules/@redact-secret/core/package.json'),
      JSON.stringify({
        name: '@redact-secret/core',
        type: 'module',
        exports: './index.js',
      }),
    );
    await writeFile(
      join(root, 'node_modules/@redact-secret/core/index.js'),
      `export const VERSION='0.1.0-beta.14'; export const artifact=()=> 'addon'; export const initialize=async()=>new Promise(resolve=>setTimeout(resolve,${initializationMs}));export const scanAndRedact=text=>({text,findings:[]});`,
    );
    processChild = spawn(process.execPath, [join(root, 'helper/index.js')], {
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        NODE_PATH: '',
        REDACTON_SETTINGS_ROOT: join(root, 'settings'),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '',
      stderr = '';
    processChild.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    processChild.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const ready = new Promise((resolveReady, rejectReady) => {
      processChild.once('message', resolveReady);
      processChild.once('error', rejectReady);
      processChild.once('exit', () =>
        rejectReady(new Error('BOOTSTRAP_UNAVAILABLE')),
      );
    });
    const finished = new Promise((resolve, reject) => {
      processChild.once('exit', resolve);
      processChild.once('error', reject);
    });
    const timer = setTimeout(() => processChild.kill('SIGKILL'), 8000);
    assert.equal(await ready, 'BOOTSTRAP_READY');
    const payload = JSON.stringify(request);
    processChild.stdin.on('error', () => {});
    if (inputDelayMs) {
      processChild.stdin.write(payload.slice(0, payload.length - 1));
      await new Promise((resolve) => setTimeout(resolve, inputDelayMs));
      if (processChild.exitCode === null)
        processChild.stdin.end(payload.slice(-1));
    } else processChild.stdin.end(payload);
    const code = await finished;
    clearTimeout(timer);
    assert.equal(code, 0);
    assert.equal(stderr, '');
    return JSON.parse(stdout);
  } finally {
    if (processChild?.exitCode === null) processChild.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
}
test('slow initialization succeeds for validated settings but self-check still times out at two seconds', async () => {
  const [saved, scan] = await Promise.all([
    child(settings, 2300),
    child(selfCheck, 2300),
  ]);
  assert.equal(saved.status, 'ok');
  assert.equal(saved.settings.scope, 'personal');
  assert.equal(scan.status, 'failed');
  assert.equal(scan.errorCode, 'TIMEOUT');
  assert.equal(scan.segments, undefined);
});
test('settings deadline includes prior input time rather than restarting a five-second timer', async () => {
  const result = await child(settings, 4500, 1000);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'TIMEOUT');
  assert.equal(result.settings, undefined);
});
test('incomplete stdin cannot obtain the settings extension from its operation name', async () => {
  const result = await child(settings, 0, 2300);
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'TIMEOUT');
  assert.equal(result.settings, undefined);
});
