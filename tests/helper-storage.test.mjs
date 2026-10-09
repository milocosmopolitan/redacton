import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs, {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as engine from '@redact-secret/core';
import { CANONICAL_TYPES, POLICY_ID } from '../helper/dist/core.js';
import { SettingsStore } from '../helper/dist/storage.js';

await engine.initialize();
const empty = { schemaVersion: 1, rules: [] };
const document = {
  schemaVersion: 1,
  rules: [
    {
      kind: 'token',
      id: 'corp-token',
      action: 'redact',
      prefix: 'ZXQ_',
      alphabet: 'alnum',
      run: { kind: 'exact', length: 20 },
      specificity: 'contextual',
      validator: 'none',
    },
  ],
};
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'redacton-settings-'));
  try {
    await mkdir(join(root, 'project'));
    await run(root, new SettingsStore(join(root, 'personal')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const load = (store, scope = 'personal', root) =>
  store.load(scope, root, engine, CANONICAL_TYPES);
const save = (
  store,
  expected,
  doc = document,
  scope = 'personal',
  root,
  approved = true,
) => store.save(scope, root, approved, expected, doc, engine, CANONICAL_TYPES);

test('absent scope identities are stable/private and unapproved project reads never write repository files', async () =>
  fixture(async (root, store) => {
    const [a, b] = await Promise.all([load(store), load(store)]);
    assert.equal(a.revision, 'absent');
    assert.equal(a.identity, b.identity);
    assert.deepEqual(a.document, empty);
    const project = await load(store, 'project', join(root, 'project'));
    assert.notEqual(project.identity, a.identity);
    assert.equal(project.revision, 'absent');
    assert.deepEqual(await readdir(join(root, 'project')), []);
    assert.equal(JSON.stringify(project).includes(root), false);
    await assert.rejects(
      save(store, project, document, 'project', join(root, 'project'), false),
      { message: 'PROJECT_TRUST_REQUIRED' },
    );
    assert.deepEqual(await readdir(join(root, 'project')), []);
  }));

test('atomic CAS persistence survives reload, rejects stale/replayed body and resets exact scope only', async () =>
  fixture(async (root, store) => {
    const initial = await load(store);
    const saved = await save(store, initial);
    assert.notEqual(saved.revision, 'absent');
    assert.deepEqual(await load(store), saved);
    if (process.platform !== 'win32')
      assert.equal(
        (await stat(join(root, 'personal/settings.json'))).mode & 0o777,
        0o600,
      );
    await assert.rejects(save(store, initial), {
      message: 'SETTINGS_CONFLICT',
    });
    const onDisk = JSON.parse(
      await readFile(join(root, 'personal/settings.json'), 'utf8'),
    );
    onDisk.document = empty;
    await writeFile(
      join(root, 'personal/settings.json'),
      JSON.stringify(onDisk),
    );
    await assert.rejects(save(store, saved), { message: 'SETTINGS_CONFLICT' });
    const changed = await load(store);
    const reset = await save(store, changed, empty);
    assert.deepEqual(reset.document, empty);
    assert.notEqual(reset.revision, changed.revision);
    assert.equal(reset.identity, changed.identity);
    const project = await load(store, 'project', join(root, 'project'));
    assert.equal(project.revision, 'absent');
    assert.deepEqual((await readdir(join(root, 'personal'))).sort(), [
      '.identity',
      'settings.json',
    ]);
  }));

test('concurrent writers have one winner; active locks block safely and dead owners recover', async () =>
  fixture(async (root, store) => {
    const initial = await load(store);
    const writes = await Promise.allSettled([
      save(store, initial),
      save(store, initial),
    ]);
    assert.equal(writes.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(writes.filter((x) => x.status === 'rejected').length, 1);
    assert.deepEqual((await load(store)).document, document);
    const lock = join(root, 'personal/.settings.lock');
    await writeFile(
      lock,
      JSON.stringify({
        pid: process.pid,
        nonce: '11111111-1111-4111-8111-111111111111',
      }),
    );
    const current = await load(store);
    await assert.rejects(save(store, current), { message: 'SETTINGS_BUSY' });
    await rm(lock, { recursive: true });
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(dead.status, 0);
    await writeFile(
      lock,
      JSON.stringify({
        pid: dead.pid,
        nonce: '22222222-2222-4222-8222-222222222222',
      }),
    );
    assert.equal((await save(store, current, empty)).document.rules.length, 0);
    assert.deepEqual((await readdir(join(root, 'personal'))).sort(), [
      '.identity',
      'settings.json',
    ]);
  }));

test('corrupt, oversized, unknown versions, symlinks and invalid core rules never claim active settings', async () =>
  fixture(async (root, store) => {
    const initial = await load(store);
    await save(store, initial);
    const path = join(root, 'personal/settings.json');
    const original = await readFile(path, 'utf8');
    for (const value of [
      '{',
      'x'.repeat(65537),
      JSON.stringify({ ...JSON.parse(original), schemaVersion: 2 }),
      JSON.stringify({
        ...JSON.parse(original),
        document: {
          schemaVersion: 1,
          rules: [{ ...document.rules[0], id: 'generic-token' }],
        },
      }),
    ]) {
      await writeFile(path, value);
      await assert.rejects(load(store), { message: 'SETTINGS_CORRUPT' });
    }
    await rm(path);
    await writeFile(join(root, 'other.json'), original);
    await symlink(join(root, 'other.json'), path);
    await assert.rejects(load(store), { message: 'SETTINGS_CORRUPT' });
    await rm(path);
    await writeFile(path, original);
    const current = await load(store);
    await assert.rejects(
      save(store, current, {
        schemaVersion: 1,
        rules: [{ ...document.rules[0], action: 'allow' }],
      }),
      { message: 'INVALID_CONFIG' },
    );
    assert.equal(await readFile(path, 'utf8'), original);
    assert.deepEqual((await readdir(join(root, 'personal'))).sort(), [
      '.identity',
      'settings.json',
    ]);
  }));

test('real helper persistence uses stdin and isolated namespace, returns bounded scope-only receipts', async () =>
  fixture(async (root) => {
    const call = (operation, storage) => {
      const result = spawnSync(process.execPath, ['helper/dist/index.js'], {
        input: JSON.stringify({
          protocolVersion: 2,
          requestId: 'storage-test',
          operation,
          policyId: POLICY_ID,
          storage,
        }),
        env: {
          ...process.env,
          REDACTON_SETTINGS_ROOT: join(root, 'cli-personal'),
        },
        encoding: 'utf8',
        timeout: 3000,
      });
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout.includes(root), false);
      return JSON.parse(result.stdout);
    };
    const loaded = call('load-config', { scope: 'personal', approved: true });
    assert.equal(loaded.status, 'ok');
    assert.equal(loaded.settings.revision, 'absent');
    const expected = {
      expectedIdentity: loaded.settings.identity,
      expectedRevision: loaded.settings.revision,
      expectedDocument: loaded.settings.document,
    };
    const saved = call('save-config', {
      scope: 'personal',
      approved: true,
      ...expected,
      document,
    });
    assert.equal(saved.status, 'ok');
    assert.deepEqual(saved.settings.document, document);
    const stale = call('save-config', {
      scope: 'personal',
      approved: true,
      ...expected,
      document,
    });
    assert.equal(stale.errorCode, 'SETTINGS_CONFLICT');
    assert.equal(stale.settings, undefined);
    const reset = call('reset-config', {
      scope: 'personal',
      approved: true,
      expectedIdentity: saved.settings.identity,
      expectedRevision: saved.settings.revision,
      expectedDocument: saved.settings.document,
    });
    assert.equal(reset.status, 'ok');
    assert.deepEqual(reset.settings.document, empty);
  }));

test('portable fixed-scope transfers contain declarative document only and import never activates or trusts project', async () =>
  fixture(async (root, store) => {
    const initial = await load(store);
    const exported = await store.export(
      'personal',
      undefined,
      true,
      document,
      engine,
      CANONICAL_TYPES,
      initial.identity,
    );
    assert.equal(exported.identity, initial.identity);
    const path = join(root, 'personal/transfer.json');
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), document);
    if (process.platform !== 'win32')
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await load(store)).revision, 'absent');
    await mkdir(join(root, 'project/.redacton'));
    await writeFile(
      join(root, 'project/.redacton/transfer.json'),
      await readFile(path),
    );
    const imported = await store.import(
      'project',
      join(root, 'project'),
      engine,
      CANONICAL_TYPES,
      initial.identity,
    );
    assert.deepEqual(imported.document, document);
    assert.notEqual(imported.identity, exported.identity);
    assert.equal(
      (await load(store, 'project', join(root, 'project'))).revision,
      'absent',
    );
    await assert.rejects(
      store.export(
        'project',
        join(root, 'project'),
        false,
        document,
        engine,
        CANONICAL_TYPES,
        initial.identity,
      ),
      { message: 'PROJECT_TRUST_REQUIRED' },
    );
    for (const value of [
      '{',
      'x'.repeat(65537),
      JSON.stringify({ ...document, off: true }),
      JSON.stringify({ ...document, history: ['not allowed'] }),
    ]) {
      await writeFile(path, value);
      await assert.rejects(
        store.import('personal', undefined, engine, CANONICAL_TYPES),
        { message: 'INVALID_CONFIG' },
      );
    }
    await rm(path);
    await writeFile(join(root, 'external.json'), JSON.stringify(document));
    await symlink(join(root, 'external.json'), path);
    await assert.rejects(
      store.import('personal', undefined, engine, CANONICAL_TYPES),
      { message: 'INVALID_CONFIG' },
    );
    await assert.rejects(
      store.export(
        'personal',
        undefined,
        true,
        document,
        engine,
        CANONICAL_TYPES,
        initial.identity,
      ),
      { message: 'SETTINGS_CORRUPT' },
    );
  }));

test('multiple real processes contending to recover one dead lease retain exactly one CAS winner', async () =>
  fixture(async (root, store) => {
    const initial = await load(store);
    const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(dead.status, 0);
    await writeFile(
      join(root, 'personal/.settings.lock'),
      JSON.stringify({
        pid: dead.pid,
        nonce: '33333333-3333-4333-8333-333333333333',
      }),
    );
    const input = JSON.stringify({
      protocolVersion: 2,
      requestId: 'recovery-test',
      operation: 'save-config',
      policyId: POLICY_ID,
      storage: {
        scope: 'personal',
        approved: true,
        expectedIdentity: initial.identity,
        expectedRevision: initial.revision,
        expectedDocument: initial.document,
        document,
      },
    });
    const children = Array.from(
      { length: 8 },
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(process.execPath, ['helper/dist/index.js'], {
            env: {
              ...process.env,
              REDACTON_SETTINGS_ROOT: join(root, 'personal'),
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let output = '',
            error = '';
          child.stdout.on('data', (bytes) => (output += bytes));
          child.stderr.on('data', (bytes) => (error += bytes));
          child.on('error', reject);
          child.on('close', (exit) => {
            try {
              assert.equal(exit, 0);
              assert.equal(error, '');
              resolve(JSON.parse(output));
            } catch (failure) {
              reject(failure);
            }
          });
          child.stdin.end(input);
        }),
    );
    const responses = await Promise.all(children);
    assert.equal(
      responses.filter((response) => response.status === 'ok').length,
      1,
    );
    assert.ok(
      responses
        .filter((response) => response.status === 'failed')
        .every((response) =>
          [
            'SETTINGS_BUSY',
            'SETTINGS_CONFLICT',
            'SETTINGS_UNAVAILABLE',
          ].includes(response.errorCode),
        ),
    );
    assert.deepEqual((await load(store)).document, document);
    assert.deepEqual((await readdir(join(root, 'personal'))).sort(), [
      '.identity',
      'settings.json',
    ]);
  }));

test('export cannot reuse approved identity for a different project location', async () =>
  fixture(async (root, store) => {
    const original = await load(store, 'project', join(root, 'project'));
    await mkdir(join(root, 'other-project'));
    await assert.rejects(
      store.export(
        'project',
        join(root, 'other-project'),
        true,
        document,
        engine,
        CANONICAL_TYPES,
        original.identity,
      ),
      { message: 'SETTINGS_CONFLICT' },
    );
    assert.deepEqual(await readdir(join(root, 'other-project')), []);
    const personal = await load(store);
    await assert.rejects(
      store.export(
        'personal',
        undefined,
        true,
        document,
        engine,
        CANONICAL_TYPES,
        original.identity,
      ),
      { message: 'SETTINGS_CONFLICT' },
    );
    assert.deepEqual((await readdir(join(root, 'personal'))).sort(), [
      '.identity',
    ]);
    assert.notEqual(personal.identity, original.identity);
  }));

test('recognized credential literal cannot be saved, exported or imported as configuration', async () =>
  fixture(async (root, store) => {
    const current = await load(store);
    const unsafe = {
      schemaVersion: 1,
      rules: [
        {
          ...document.rules[0],
          prefix: 'ghp_SYNTHETICREVOKED00000000000000000000',
        },
      ],
    };
    await assert.rejects(save(store, current, unsafe), {
      message: 'INVALID_CONFIG',
    });
    await assert.rejects(
      store.export(
        'personal',
        undefined,
        true,
        unsafe,
        engine,
        CANONICAL_TYPES,
        current.identity,
      ),
      { message: 'INVALID_CONFIG' },
    );
    assert.deepEqual((await readdir(join(root, 'personal'))).sort(), [
      '.identity',
    ]);
    await writeFile(
      join(root, 'personal', 'transfer.json'),
      JSON.stringify(unsafe),
    );
    await assert.rejects(
      store.import('personal', undefined, engine, CANONICAL_TYPES),
      { message: 'INVALID_CONFIG' },
    );
    assert.equal((await load(store)).revision, 'absent');
  }));

test('replacing a checked settings file before open never loads the replacement', async () =>
  fixture(async (root, store) => {
    const initial = await load(store);
    const saved = await save(store, initial);
    const target = await fs.realpath(join(root, 'personal/settings.json'));
    const original = await readFile(target, 'utf8');
    const replacement = join(root, 'replacement.json');
    await writeFile(replacement, original);
    const originalOpen = fs.open;
    let swapped = false;
    fs.open = async (path, ...args) => {
      if (path === target && !swapped) {
        swapped = true;
        await fs.rename(target, join(root, 'old.json'));
        await fs.rename(replacement, target);
      }
      return originalOpen(path, ...args);
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(load(store), { message: 'SETTINGS_CORRUPT' });
      assert.equal(swapped, true);
    } finally {
      fs.open = originalOpen;
      syncBuiltinESMExports();
    }
    assert.deepEqual(await load(store), saved);
  }));

test('replacing a checked settings file with a link is rejected even without nofollow', async () =>
  fixture(async (root, store) => {
    const initial = await load(store);
    await save(store, initial);
    const target = await fs.realpath(join(root, 'personal/settings.json'));
    const moved = join(root, 'moved.json');
    const originalOpen = fs.open;
    let swapped = false;
    let reads = 0;
    fs.open = async (path, ...args) => {
      if (path === target && !swapped) {
        swapped = true;
        await fs.rename(target, moved);
        await symlink(moved, target);
      }
      if (path === target && typeof args[0] === 'number')
        args[0] &= ~(constants.O_NOFOLLOW ?? 0);
      const handle = await originalOpen(path, ...args);
      if (path === target) {
        const read = handle.read.bind(handle);
        handle.read = (...readArgs) => {
          reads++;
          return read(...readArgs);
        };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(load(store), { message: 'SETTINGS_CORRUPT' });
      assert.equal(swapped, true);
      assert.equal(reads, 0);
    } finally {
      fs.open = originalOpen;
      syncBuiltinESMExports();
    }
  }));
