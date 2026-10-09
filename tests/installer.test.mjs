import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
test('Candidate installation preserves existing installs across hash and readiness failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'redacton installer 한글 '));
  try {
    const source = join(dir, 'source'),
      root = join(source, 'redacton-0.2.0');
    const bin = join(dir, 'bin'),
      install = join(dir, 'installed 한글');
    mkdirSync(join(root, 'helper/dist'), { recursive: true });
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    mkdirSync(bin);
    const windows = process.platform === 'win32';
    writeFileSync(
      join(bin, windows ? 'claude.cmd' : 'claude'),
      windows ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n',
    );
    if (!windows) chmodSync(join(bin, 'claude'), 0o755);
    const archive = join(dir, windows ? 'candidate.zip' : 'candidate.tar.gz');
    const ps = 'powershell.exe';
    function build(fail = false) {
      const files = {
        '.claude-plugin/plugin.json': '{"name":"redacton"}',
        'helper/dist/index.js': fail
          ? fail === 'rename-failure'
            ? `require('node:fs').chmodSync(require('node:path').dirname(process.cwd()),0);process.stdout.write(JSON.stringify({status:'ok',requestId:'install_check',engineVersion:'0.1.0-beta.14',artifact:'wasm'}))`
            : 'process.exit(1)'
          : `process.stdout.write(JSON.stringify({status:'ok',requestId:'install_check',engineVersion:'0.1.0-beta.14',artifact:'wasm'}))`,
      };
      for (const [name, value] of Object.entries(files))
        writeFileSync(join(root, name), value);
      writeFileSync(
        join(root, 'SHA256SUMS'),
        `${Object.entries(files)
          .map(([name, value]) => `${digest(value)}  ${name}`)
          .join('\n')}\n`,
      );
      if (windows) {
        rmSync(archive, { force: true });
        const result = spawnSync(
          ps,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:FIXTURE_SOURCE,$env:FIXTURE_ARCHIVE)',
          ],
          {
            env: {
              ...process.env,
              FIXTURE_SOURCE: source,
              FIXTURE_ARCHIVE: archive,
            },
            encoding: 'utf8',
          },
        );
        assert.equal(result.status, 0, result.stderr);
      } else
        assert.equal(
          spawnSync('tar', ['-czf', archive, '-C', source, 'redacton-0.2.0'])
            .status,
          0,
        );
      return digest(readFileSync(archive));
    }
    function installCandidate(hash) {
      const command = windows ? ps : 'bash';
      const args = windows
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            resolve('scripts/install.ps1'),
            '-ReleaseVersion',
            '0.2.0',
            '-ArchiveSha256',
            hash,
            '-ArchivePath',
            archive,
            '-InstallDirectory',
            install,
          ]
        : [resolve('scripts/install.sh')];
      return spawnSync(command, args, {
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          PATH: `${bin}${windows ? ';' : ':'}${process.env.PATH}`,
          REDACTON_INSTALL_DIR: install,
          REDACTON_RELEASE_VERSION: '0.2.0',
          REDACTON_ARCHIVE_PATH: archive,
          REDACTON_ARCHIVE_SHA256: hash,
        },
      });
    }
    let hash = build();
    const first = installCandidate(hash);
    assert.equal(first.status, 0, first.stderr);
    writeFileSync(join(install, 'current', 'previous-marker'), 'preserve');
    const isolated = join(dir, 'missing-node');
    mkdirSync(isolated);
    if (!windows) symlinkSync('/usr/bin/uname', join(isolated, 'uname'));
    const missingNode = spawnSync(
      windows
        ? join(
            process.env.SystemRoot,
            'System32/WindowsPowerShell/v1.0/powershell.exe',
          )
        : '/bin/bash',
      windows
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            resolve('scripts/install.ps1'),
            '-ReleaseVersion',
            '0.2.0',
            '-ArchiveSha256',
            hash,
            '-ArchivePath',
            archive,
            '-InstallDirectory',
            install,
          ]
        : [resolve('scripts/install.sh')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: isolated,
          REDACTON_RELEASE_VERSION: '0.2.0',
          REDACTON_ARCHIVE_SHA256: hash,
          REDACTON_ARCHIVE_PATH: archive,
          REDACTON_INSTALL_DIR: install,
        },
      },
    );
    assert.notEqual(missingNode.status, 0);
    assert.match(missingNode.stderr, /Node/);
    assert.equal(
      readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
      'preserve',
    );
    assert.notEqual(installCandidate('0'.repeat(64)).status, 0);
    assert.equal(
      readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
      'preserve',
    );
    for (const [name, type, duplicate] of [
      ['redacton-0.2.0/../escape', '0', false],
      ['redacton-0.2.0/link', '2', false],
      ['redacton-0.2.0/repeated', '0', true],
    ]) {
      if (windows) {
        rmSync(archive, { force: true });
        const result = spawnSync(
          ps,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open($env:FIXTURE_ARCHIVE,[IO.Compression.ZipArchiveMode]::Create); try {$e=$z.CreateEntry($env:FIXTURE_NAME); if($env:FIXTURE_TYPE -eq '2'){$e.ExternalAttributes=1073741824 -bor 536870912}; if($env:FIXTURE_DUP -eq 'true'){$null=$z.CreateEntry($env:FIXTURE_NAME)}} finally {$z.Dispose()}",
          ],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              FIXTURE_ARCHIVE: archive,
              FIXTURE_NAME: name,
              FIXTURE_TYPE: type,
              FIXTURE_DUP: String(duplicate),
            },
          },
        );
        assert.equal(result.status, 0, result.stderr);
      } else {
        const header = Buffer.alloc(512);
        header.write(name);
        header.write('0000644\0', 100);
        header.write('0000000\0', 108);
        header.write('0000000\0', 116);
        header.write('00000000000\0', 124);
        header.write('00000000000\0', 136);
        header.fill(32, 148, 156);
        header.write(type, 156);
        header.write('outside', 157);
        header.write('ustar\0', 257);
        const sum = header.reduce((a, b) => a + b, 0);
        header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
        writeFileSync(
          archive,
          gzipSync(
            Buffer.concat([
              header,
              ...(duplicate ? [header] : []),
              Buffer.alloc(1024),
            ]),
          ),
        );
      }
      const bad = installCandidate(digest(readFileSync(archive)));
      assert.notEqual(bad.status, 0);
      if (!windows)
        assert.match(
          bad.stderr,
          /unsafe path|link or special file|duplicate or case-colliding/,
        );
      assert.equal(
        readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
        'preserve',
      );
    }
    writeFileSync(archive, 'not an archive');
    assert.notEqual(installCandidate(digest(readFileSync(archive))).status, 0);
    assert.equal(
      readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
      'preserve',
    );
    hash = build(true);
    assert.notEqual(installCandidate(hash).status, 0);
    assert.equal(
      readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
      'preserve',
    );
    if (!windows && process.getuid?.() !== 0) {
      hash = build('rename-failure');
      const failedSwitch = installCandidate(hash);
      // A real permission failure after current is moved exercises restoration.
      assert.notEqual(failedSwitch.status, 0);
      assert.equal(
        readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
        'preserve',
      );
      for (const name of readdirSync(install))
        if (name.startsWith('.install.')) chmodSync(join(install, name), 0o700);
    }
    hash = build();
    assert.equal(installCandidate(hash).status, 0);
    assert.equal(
      readFileSync(
        join(install, 'current', '.claude-plugin/plugin.json'),
        'utf8',
      ),
      '{"name":"redacton"}',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
