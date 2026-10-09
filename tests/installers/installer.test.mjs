import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
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
import { archiveZip } from '../../scripts/artifact-archive.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function environmentWithPath(path) {
  const env = { ...process.env };
  // Avoid competing Path/PATH entries in the Windows child environment block.
  for (const key of Object.keys(env))
    if (key.toLowerCase() === 'path') delete env[key];
  env[process.platform === 'win32' ? 'Path' : 'PATH'] = path;
  return env;
}
test('Candidate installation preserves existing installs across hash and readiness failures', async (t) => {
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
      let helper = `process.stdout.write(JSON.stringify({status:'ok',requestId:'install_check',engineVersion:'0.1.0-beta.14',artifact:'wasm'}))`;
      if (fail === 'rename-failure')
        helper = `require('node:fs').chmodSync(require('node:path').dirname(process.cwd()),0);${helper}`;
      else if (fail === 'hang') helper = 'setInterval(()=>{},1000)';
      else if (fail) helper = 'process.exit(1)';
      const files = {
        '.claude-plugin/plugin.json': '{"name":"redacton"}',
        'helper/dist/index.js': helper,
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
        // Windows PowerShell 5.1 targets legacy .NET ZIP path behavior. The release
        // contract uses '/' names, so generate clean fixtures with the real builder.
        writeFileSync(
          archive,
          archiveZip([
            ...Object.entries(files).map(([name, value]) => ({
              name: `redacton-0.2.0/${name}`,
              data: Buffer.from(value),
            })),
            {
              name: 'redacton-0.2.0/SHA256SUMS',
              data: readFileSync(join(root, 'SHA256SUMS')),
            },
          ]),
        );
      } else
        assert.equal(
          spawnSync('tar', ['-czf', archive, '-C', source, 'redacton-0.2.0'])
            .status,
          0,
        );
      return digest(readFileSync(archive));
    }
    function installCandidate(hash, wrapper = resolve('scripts/install.ps1')) {
      const command = windows ? ps : 'bash';
      const args = windows
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            wrapper,
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
          ...environmentWithPath(
            `${bin}${windows ? ';' : ':'}${process.env.PATH}`,
          ),
          REDACTON_INSTALL_DIR: install,
          REDACTON_RELEASE_VERSION: '0.2.0',
          REDACTON_ARCHIVE_PATH: archive,
          REDACTON_ARCHIVE_SHA256: hash,
          FIXTURE_INSTALLER_SCRIPT: resolve('scripts/install.ps1'),
          FIXTURE_MOVE_TRACE: join(dir, 'move-trace'),
        },
      });
    }
    let hash = build();
    const first = installCandidate(hash);
    assert.equal(first.status, 0, first.stderr);
    writeFileSync(join(install, 'current', 'previous-marker'), 'preserve');
    await t.test('missing Node preserves current', () => {
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
            ...environmentWithPath(isolated),
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
    });
    await t.test('wrong checksum preserves current', () => {
      assert.notEqual(installCandidate('0'.repeat(64)).status, 0);
      assert.equal(
        readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
        'preserve',
      );
    });
    for (const [name, type, duplicate] of [
      ['redacton-0.2.0/../escape', '0', false],
      ['redacton-0.2.0/link', '2', false],
      ['redacton-0.2.0/repeated', '0', true],
    ]) {
      await t.test(
        type === '2'
          ? 'links are rejected'
          : duplicate
            ? 'duplicates are rejected'
            : 'traversal is rejected',
        () => {
          if (windows) {
            rmSync(archive, { force: true });
            const result = spawnSync(
              ps,
              [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `$ErrorActionPreference='Stop'
try {
 Add-Type -AssemblyName System.IO.Compression
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $z=[IO.Compression.ZipFile]::Open($env:FIXTURE_ARCHIVE,[IO.Compression.ZipArchiveMode]::Create)
 try {
  $e=$z.CreateEntry($env:FIXTURE_NAME)
  if($env:FIXTURE_TYPE -eq '2'){$e.ExternalAttributes=1073741824 -bor 536870912}
  if($env:FIXTURE_DUP -eq 'true'){$null=$z.CreateEntry($env:FIXTURE_NAME)}
 } finally {$z.Dispose()}
} catch {[Console]::Error.WriteLine('FIXTURE_ZIP_BUILD_FAILED'); exit 1}`,
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
          else assert.match(bad.stderr, /INSTALL_ARCHIVE_INSPECTION/);
          assert.equal(
            readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
            'preserve',
          );
        },
      );
    }
    await t.test('corrupt archive preserves current', () => {
      writeFileSync(archive, 'not an archive');
      assert.notEqual(
        installCandidate(digest(readFileSync(archive))).status,
        0,
      );
      assert.equal(
        readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
        'preserve',
      );
    });
    await t.test('readiness failure preserves current', () => {
      hash = build(true);
      assert.notEqual(installCandidate(hash).status, 0);
      assert.equal(
        readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
        'preserve',
      );
    });
    if (!windows && process.getuid?.() !== 0) {
      await t.test('Unix activation rollback restores current', () => {
        hash = build('rename-failure');
        const failedSwitch = installCandidate(hash);
        // A real permission failure after current is moved exercises restoration.
        assert.notEqual(failedSwitch.status, 0);
        assert.equal(
          readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
          'preserve',
        );
        for (const name of readdirSync(install))
          if (name.startsWith('.install.'))
            chmodSync(join(install, name), 0o700);
      });
    }
    if (windows) {
      await t.test('Windows activation rollback restores current', () => {
        const wrapper = join(dir, 'activation-failure.ps1');
        writeFileSync(
          wrapper,
          String.raw`param([string]$ReleaseVersion, [string]$ArchiveSha256, [string]$ArchivePath, [string]$InstallDirectory)
try { Import-Module Microsoft.PowerShell.Management -ErrorAction Stop } catch { [Console]::Error.WriteLine('FIXTURE_MOVE_PROXY_SETUP_FAILED'); exit 1 }
function Move-Item {
  [CmdletBinding()]
  param([string]$LiteralPath, [string]$Destination)
  $sourceLeaf = [IO.Path]::GetFileName($LiteralPath)
  $destinationLeaf = [IO.Path]::GetFileName($Destination)
  $sourceParent = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($LiteralPath))
  if ($sourceLeaf -eq 'redacton-0.2.0' -and $sourceParent.StartsWith('.install-') -and $destinationLeaf -eq 'current') {
    [IO.File]::AppendAllText($env:FIXTURE_MOVE_TRACE, 'inject' + [Environment]::NewLine)
    throw 'SYNTHETIC_ACTIVATION_FAILURE'
  }
  Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
  if ($sourceLeaf -eq 'current' -and $destinationLeaf.StartsWith('.previous-')) { [IO.File]::AppendAllText($env:FIXTURE_MOVE_TRACE, 'old-rename' + [Environment]::NewLine) }
  if ($sourceLeaf.StartsWith('.previous-') -and $destinationLeaf -eq 'current') { [IO.File]::AppendAllText($env:FIXTURE_MOVE_TRACE, 'restore' + [Environment]::NewLine) }
}
. $env:FIXTURE_INSTALLER_SCRIPT -ReleaseVersion $ReleaseVersion -ArchiveSha256 $ArchiveSha256 -ArchivePath $ArchivePath -InstallDirectory $InstallDirectory
exit $LASTEXITCODE
`,
        );
        hash = build();
        const failedSwitch = installCandidate(hash, wrapper);
        assert.match(failedSwitch.stderr, /INSTALL_ACTIVATION/);
        assert.ok(
          existsSync(join(dir, 'move-trace')),
          'FIXTURE_MOVE_TRACE_MISSING',
        );
        const finiteMoveTrace = readFileSync(join(dir, 'move-trace'), 'utf8')
          .trim()
          .split(/\r?\n/)
          .map((value) =>
            ['old-rename', 'inject', 'restore'].includes(value)
              ? value
              : 'UNKNOWN',
          );
        assert.deepEqual(finiteMoveTrace, ['old-rename', 'inject', 'restore']);
        assert.equal(
          readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
          'preserve',
        );
        assert.equal(
          readdirSync(install).some((name) => name.startsWith('.previous-')),
          false,
        );
        assert.notEqual(
          failedSwitch.status,
          0,
          'Wrapper must preserve production installer exit status',
        );
      });
    }
    await t.test('readiness timeout preserves current', () => {
      hash = build('hang');
      const hang = installCandidate(hash);
      assert.notEqual(hang.status, 0);
      assert.equal(
        hang.error,
        undefined,
        'Installer must enforce its own readiness timeout',
      );
      if (windows) assert.match(hang.stderr, /INSTALL_SELF_CHECK/);
      assert.equal(
        readFileSync(join(install, 'current', 'previous-marker'), 'utf8'),
        'preserve',
      );
    });
    await t.test('repeat installation succeeds', () => {
      hash = build();
      assert.equal(installCandidate(hash).status, 0);
      assert.equal(
        readFileSync(
          join(install, 'current', '.claude-plugin/plugin.json'),
          'utf8',
        ),
        '{"name":"redacton"}',
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
