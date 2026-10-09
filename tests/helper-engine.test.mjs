import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import * as engine from '@redact-secret/core';
import {
  ENGINE_VERSION,
  POLICY_ID,
  processRequest,
} from '../helper/dist/core.js';

const syntheticToken = 'ghp_SYNTHETICREVOKED00000000000000000000';
const request = (text) => ({
  protocolVersion: 1,
  requestId: 'engine_1',
  policyId: POLICY_ID,
  operation: 'sanitize',
  segments: [{ id: 's0', text }],
});

test('pinned real engine redacts synthetic credential and preserves adjacent Unicode', async () => {
  const result = await processRequest(
    request(`앞 ${syntheticToken} 뒤`),
    engine,
  );
  assert.equal(result.status, 'ok');
  assert.equal(result.engineVersion, ENGINE_VERSION);
  assert.equal(result.segments[0].text.includes(syntheticToken), false);
  assert.equal(result.segments[0].text.startsWith('앞 '), true);
  assert.equal(result.segments[0].text.endsWith(' 뒤'), true);
  assert.deepEqual({ ...result.findingCounts }, { github_token: 1 });
  assert.equal(
    JSON.stringify(result.findingCounts).includes(syntheticToken),
    false,
  );
});

test('pinned real engine blocks synthetic PEM and refuses lone surrogate', async () => {
  const blocked = await processRequest(
    request(
      '-----BEGIN PRIVATE KEY-----\nU1lOVEhFVElDX1JFVk9LRURfRklYVFVSRQ==\n-----END PRIVATE KEY-----',
    ),
    engine,
  );
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.errorCode, 'PRIVATE_KEY_BLOCKED');
  assert.equal(blocked.segments, undefined);
  assert.equal(
    (await processRequest(request('\ud800'), engine)).errorCode,
    'ENGINE_FAILURE',
  );
});

test('real engine finding overflow never returns partially redacted text', async () => {
  const value = request(
    Array.from({ length: 1001 }, () => syntheticToken).join('\n'),
  );
  const response = await processRequest(value, engine);
  assert.equal(response.status, 'failed');
  assert.equal(response.segments, undefined);
  assert.equal(JSON.stringify(response).includes(syntheticToken), false);
});

test('clean prebuilt helper uses packaged native artifact, and clean package without addon uses WASM', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'redacton-helper-'));
  const call = (path, value) =>
    spawnSync(process.execPath, [path], {
      input: JSON.stringify(value),
      encoding: 'utf8',
      timeout: 4000,
      cwd: dir,
    });
  try {
    await cp(resolve('helper/dist'), join(dir, 'helper'), { recursive: true });
    await mkdir(join(dir, 'node_modules/@redact-secret'), { recursive: true });
    for (const name of ['core', 'wasm'])
      await cp(
        resolve(`node_modules/@redact-secret/${name}`),
        join(dir, 'node_modules/@redact-secret', name),
        { recursive: true },
      );
    const fallback = call(
      join(dir, 'helper/index.js'),
      request(syntheticToken),
    );
    assert.equal(fallback.status, 0);
    assert.equal(fallback.stderr, '');
    const wasm = JSON.parse(fallback.stdout);
    assert.equal(wasm.status, 'ok');
    assert.equal(wasm.artifact, 'wasm');
    assert.equal(wasm.segments[0].text.includes(syntheticToken), false);
    const addonName = (
      await readdir(resolve('node_modules/@redact-secret'))
    ).find((name) =>
      name.startsWith(`node-${process.platform}-${process.arch}`),
    );
    assert.ok(addonName, 'qualification requires installed platform addon');
    await cp(
      resolve(`node_modules/@redact-secret/${addonName}`),
      join(dir, 'node_modules/@redact-secret', addonName),
      { recursive: true },
    );
    const native = JSON.parse(
      call(join(dir, 'helper/index.js'), request(syntheticToken)).stdout,
    );
    assert.equal(native.status, 'ok');
    assert.equal(native.artifact, 'addon');
    await rm(join(dir, 'node_modules/@redact-secret', addonName), {
      recursive: true,
    });
    await rm(join(dir, 'node_modules/@redact-secret/wasm'), {
      recursive: true,
    });
    const missing = call(
      join(dir, 'helper/index.js'),
      request('ordinary text'),
    );
    assert.equal(missing.stderr, '');
    assert.equal(JSON.parse(missing.stdout).errorCode, 'ENGINE_FAILURE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
