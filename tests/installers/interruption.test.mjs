import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { archiveTar, archiveZip } from '../../scripts/artifact-archive.mjs';

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

test('External interruption during readiness preserves current and permits retry', {
  timeout: 45000,
}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'redacton interrupted 한글 '));
  const windows = process.platform === 'win32';
  const install = join(dir, 'installed 한글');
  const current = join(install, 'current');
  const marker = join(dir, 'readiness-started');
  const bin = join(dir, 'bin');
  const archive = join(dir, windows ? 'candidate.zip' : 'candidate.tar.gz');
  let child;
  let stopped = false;
  let childClosed = false;
  try {
    mkdirSync(current, { recursive: true });
    mkdirSync(bin);
    writeFileSync(join(current, 'previous-marker'), 'preserve');
    const claude = join(bin, windows ? 'claude.cmd' : 'claude');
    writeFileSync(claude, windows ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
    if (!windows) chmodSync(claude, 0o755);
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.toLowerCase() === 'path') delete env[key];
    env[windows ? 'Path' : 'PATH'] =
      `${bin}${windows ? ';' : ':'}${process.env.PATH}`;
    Object.assign(env, {
      REDACTON_INSTALL_DIR: install,
      REDACTON_RELEASE_VERSION: '0.2.0',
      REDACTON_ARCHIVE_PATH: archive,
      FIXTURE_READINESS_MARKER: marker,
    });
    const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
    function build(interrupted) {
      const files = {
        '.claude-plugin/plugin.json': '{"name":"redacton"}',
        'helper/dist/index.js': interrupted
          ? "require('node:fs').writeFileSync(process.env.FIXTURE_READINESS_MARKER,String(process.pid));setInterval(()=>{},1000)"
          : "process.stdout.write(JSON.stringify({status:'ok',requestId:'install_check',engineVersion:'0.1.0-beta.14',artifact:'wasm'}))",
      };
      const entries = Object.entries(files).map(([name, data]) => ({
        name: `redacton-0.2.0/${name}`,
        data: Buffer.from(data),
      }));
      entries.push({
        name: 'redacton-0.2.0/SHA256SUMS',
        data: Buffer.from(
          Object.entries(files)
            .map(([name, data]) => `${digest(data)}  ${name}\n`)
            .join(''),
        ),
      });
      const bytes = windows ? archiveZip(entries) : archiveTar(entries);
      writeFileSync(archive, bytes);
      env.REDACTON_ARCHIVE_SHA256 = digest(bytes);
    }
    function invocation() {
      return windows
        ? [
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-File',
              resolve('scripts/install.ps1'),
              '-ReleaseVersion',
              '0.2.0',
              '-ArchiveSha256',
              env.REDACTON_ARCHIVE_SHA256,
              '-ArchivePath',
              archive,
              '-InstallDirectory',
              install,
            ],
          ]
        : ['bash', [resolve('scripts/install.sh')]];
    }
    function stopOwnedTree() {
      if (!child || stopped) return;
      // Only this test's child PID/group is targeted, never an executable name.
      if (windows) {
        const result = spawnSync(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          { timeout: 5000, stdio: 'ignore' },
        );
        assert.equal(
          result.status,
          0,
          'Owned installer tree termination failed',
        );
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
      stopped = true;
    }
    build(true);
    const [command, args] = invocation();
    child = spawn(command, args, { env, detached: !windows, stdio: 'ignore' });
    const closed = new Promise((resolveClose) => {
      child.once('error', () => resolveClose({ error: true }));
      child.once('close', (code, signal) => {
        childClosed = true;
        resolveClose({ code, signal });
      });
    });
    const deadline = Date.now() + 25000;
    while (
      !existsSync(marker) &&
      child.exitCode === null &&
      child.signalCode === null &&
      Date.now() < deadline
    )
      await delay(20);
    assert.ok(existsSync(marker), 'Installer never entered actual readiness');
    const readinessPid = Number(readFileSync(marker, 'utf8'));
    assert.ok(Number.isSafeInteger(readinessPid) && readinessPid > 0);
    assert.equal(
      process.kill(readinessPid, 0),
      true,
      'Readiness child must be alive at interruption',
    );
    assert.equal(child.exitCode, null, 'Installer exited before interruption');
    assert.equal(child.signalCode, null);
    assert.equal(
      readFileSync(join(current, 'previous-marker'), 'utf8'),
      'preserve',
    );
    stopOwnedTree();
    const outcome = await Promise.race([
      closed,
      delay(6000, undefined, { ref: false }).then(() => {
        throw new Error('Interrupted installer did not exit');
      }),
    ]);
    assert.equal(outcome.error, undefined, 'Installer process failed to start');
    assert.ok(
      outcome.code !== 0 || outcome.signal !== null,
      'Interrupted installer must not report success',
    );
    assert.equal(
      readFileSync(join(current, 'previous-marker'), 'utf8'),
      'preserve',
    );
    assert.equal(
      existsSync(join(current, 'helper')),
      false,
      'Candidate activated after interruption',
    );
    // Hard Windows termination may leave staging; a retry must still be safe.
    build(false);
    const [retryCommand, retryArgs] = invocation();
    const retry = spawnSync(retryCommand, retryArgs, {
      env,
      timeout: 15000,
      stdio: 'ignore',
    });
    assert.equal(retry.status, 0, 'Retry after interruption failed');
    assert.equal(
      readFileSync(join(current, '.claude-plugin/plugin.json'), 'utf8'),
      '{"name":"redacton"}',
    );
  } finally {
    if (child?.pid && (!stopped || !childClosed)) {
      if (windows)
        spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          timeout: 5000,
          stdio: 'ignore',
        });
      else killGroup(child.pid, 'SIGKILL');
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
