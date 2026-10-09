import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { archiveZip } from '../../scripts/artifact-archive.mjs';

test('Native Windows prerequisites, drive paths, long paths and printed launch argv', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const temporary = mkdtempSync(join(tmpdir(), "redacton contract 한글 ' "));
  try {
    const bin = join(temporary, 'bin');
    mkdirSync(bin);
    const receipt = join(temporary, 'launch.json');
    // A script host records argv without a model request or changing execution policy.
    writeFileSync(
      join(bin, 'claude.ps1'),
      '[IO.File]::WriteAllText($env:FIXTURE_LAUNCH_RECEIPT,(ConvertTo-Json -Compress -InputObject @($args)))',
    );
    const helper =
      "process.stdout.write(JSON.stringify({status:'ok',requestId:'install_check',engineVersion:'0.1.0-beta.14',artifact:'wasm'}))";
    const files = {
      '.claude-plugin/plugin.json': '{"name":"redacton"}',
      'helper/dist/index.js': helper,
    };
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const manifest = `${Object.entries(files)
      .map(([name, data]) => `${hash(data)}  ${name}`)
      .join('\n')}\n`;
    const bytes = archiveZip(
      [...Object.entries(files), ['SHA256SUMS', manifest]].map(
        ([name, data]) => ({
          name: `redacton-0.2.0/${name}`,
          data: Buffer.from(data),
        }),
      ),
    );
    const archive = join(temporary, 'candidate.zip');
    writeFileSync(archive, bytes);
    const ps = join(
      process.env.SystemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const env = { ...process.env, FIXTURE_LAUNCH_RECEIPT: receipt };
    for (const key of Object.keys(env))
      if (key.toLowerCase() === 'path') delete env[key];
    env.Path = `${bin};${dirname(process.execPath)}`;
    function install(directory, environment = env) {
      return spawnSync(
        ps,
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          resolve('scripts/install.ps1'),
          '-ReleaseVersion',
          '0.2.0',
          '-ArchiveSha256',
          hash(bytes),
          '-ArchivePath',
          archive,
          '-InstallDirectory',
          directory,
        ],
        { encoding: 'utf8', timeout: 20000, env: environment },
      );
    }
    const directory = join(temporary, 'data');
    const first = install(directory);
    assert.equal(first.status, 0, 'WINDOWS_CONTRACT_BASELINE_FAILED');
    writeFileSync(join(directory, 'current', 'previous-marker'), 'preserve');
    await t.test(
      'missing Claude reports the prerequisite and preserves current',
      () => {
        const result = install(directory, {
          ...env,
          Path: dirname(process.execPath),
        });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /INSTALL_CLAUDE_LOOKUP/);
        assert.match(result.stderr, /Node\/Claude prerequisites/);
        assert.equal(
          readFileSync(join(directory, 'current', 'previous-marker'), 'utf8'),
          'preserve',
        );
      },
    );
    await t.test(
      'printed command preserves drive, space, Unicode and apostrophe argv',
      () => {
        assert.match(directory, /^[A-Za-z]:\\/);
        const command = first.stdout
          .split(/\r?\n/)
          .find((line) => line.startsWith('claude --plugin-dir '));
        assert.ok(command, 'WINDOWS_LAUNCH_COMMAND_MISSING');
        const result = spawnSync(
          ps,
          ['-NoProfile', '-NonInteractive', '-Command', command],
          { encoding: 'utf8', timeout: 10000, env },
        );
        assert.equal(result.status, 0, 'WINDOWS_LAUNCH_COMMAND_FAILED');
        assert.deepEqual(JSON.parse(readFileSync(receipt, 'utf8')), [
          '--plugin-dir',
          join(directory, 'current'),
        ]);
      },
    );
    await t.test(
      'oversized archive destination is rejected before replacing current',
      () => {
        // Keep staging creation below legacy limits, then exceed the archive's
        // explicit 240-character destination boundary during inspection.
        const longDirectory = join(
          temporary,
          'L'.repeat(Math.max(1, 170 - temporary.length - 1)),
        );
        mkdirSync(join(longDirectory, 'current'), { recursive: true });
        writeFileSync(
          join(longDirectory, 'current', 'previous-marker'),
          'preserve',
        );
        const result = install(longDirectory);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /INSTALL_ARCHIVE_INSPECTION/);
        assert.match(result.stderr, /short path/);
        assert.equal(
          readFileSync(
            join(longDirectory, 'current', 'previous-marker'),
            'utf8',
          ),
          'preserve',
        );
      },
    );
    await t.test(
      'synthetic HTTP download corruption reaches the real checksum gate',
      async () => {
        let requests = 0;
        const server = createServer((_request, response) => {
          requests++;
          response.end('corrupt download fixture');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
          const wrapper = join(temporary, 'corrupt-download.ps1');
          writeFileSync(
            wrapper,
            `param([string]$ReleaseVersion,[string]$ArchiveSha256,[string]$InstallDirectory)
try { Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop } catch { [Console]::Error.WriteLine('FIXTURE_DOWNLOAD_PROXY_SETUP_FAILED'); exit 1 }
function Invoke-WebRequest {
 param([string]$Uri,[string]$OutFile,[switch]$UseBasicParsing,[int]$TimeoutSec)
 if ($Uri -ne 'https://github.com/milocosmopolitan/redacton/releases/download/v0.2.0/redacton-0.2.0.zip') { throw 'FIXTURE_UNEXPECTED_DOWNLOAD' }
 $client = [Net.WebClient]::new()
 try { $client.DownloadFile($env:FIXTURE_DOWNLOAD_URI,$OutFile) } finally { $client.Dispose() }
}
. $env:FIXTURE_INSTALLER_SCRIPT -ReleaseVersion $ReleaseVersion -ArchiveSha256 $ArchiveSha256 -InstallDirectory $InstallDirectory
exit $LASTEXITCODE
`,
          );
          const result = await new Promise((complete, reject) => {
            const child = spawn(
              ps,
              [
                '-NoProfile',
                '-NonInteractive',
                '-File',
                wrapper,
                '-ReleaseVersion',
                '0.2.0',
                '-ArchiveSha256',
                hash(bytes),
                '-InstallDirectory',
                directory,
              ],
              {
                env: {
                  ...env,
                  FIXTURE_INSTALLER_SCRIPT: resolve('scripts/install.ps1'),
                  FIXTURE_DOWNLOAD_URI: `http://127.0.0.1:${server.address().port}/archive`,
                },
                timeout: 20000,
              },
            );
            let stderr = '';
            child.stdout.resume();
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (chunk) => {
              stderr += chunk;
            });
            child.once('error', reject);
            child.once('close', (code) => complete({ code, stderr }));
          });
          assert.equal(requests, 1);
          assert.notEqual(result.code, 0);
          assert.match(result.stderr, /INSTALL_ARCHIVE_CHECKSUM_MATCH/);
          assert.equal(
            readFileSync(join(directory, 'current', 'previous-marker'), 'utf8'),
            'preserve',
          );
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      },
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('Unix synthetic HTTP download corruption reaches the real checksum gate', {
  skip: process.platform === 'win32',
  timeout: 20000,
}, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'redacton download 한글 '));
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end('corrupt download fixture');
  });
  try {
    const realCurl = spawnSync('/bin/sh', ['-c', 'command -v curl'], {
      encoding: 'utf8',
    });
    assert.equal(realCurl.status, 0, 'FIXTURE_REAL_CURL_MISSING');
    const bin = join(temporary, 'bin');
    const directory = join(temporary, 'data');
    mkdirSync(bin);
    mkdirSync(join(directory, 'current'), { recursive: true });
    writeFileSync(join(directory, 'current', 'previous-marker'), 'preserve');
    writeFileSync(join(bin, 'claude'), '#!/bin/sh\nexit 0\n');
    writeFileSync(
      join(bin, 'curl'),
      `#!/bin/sh
set -eu
seen=0
want_output=0
output=''
for argument do
 if [ "$want_output" = 1 ]; then output=$argument; want_output=0; continue; fi
 case "$argument" in
  https://github.com/milocosmopolitan/redacton/releases/download/v0.2.0/redacton-0.2.0.tar.gz) seen=1 ;;
  -o) want_output=1 ;;
 esac
done
[ "$seen" = 1 ] && [ -n "$output" ] || exit 65
exec "$FIXTURE_REAL_CURL" --fail --silent --show-error --max-time 5 "$FIXTURE_DOWNLOAD_URI" -o "$output"
`,
    );
    chmodSync(join(bin, 'claude'), 0o755);
    chmodSync(join(bin, 'curl'), 0o755);
    await new Promise((complete) => server.listen(0, '127.0.0.1', complete));
    const expected = createHash('sha256')
      .update('reviewed archive fixture')
      .digest('hex');
    const result = await new Promise((complete, reject) => {
      const child = spawn('/bin/bash', [resolve('scripts/install.sh')], {
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${bin}:${dirname(process.execPath)}:${process.env.PATH}`,
          REDACTON_INSTALL_DIR: directory,
          REDACTON_RELEASE_VERSION: '0.2.0',
          REDACTON_ARCHIVE_SHA256: expected,
          REDACTON_ARCHIVE_PATH: '',
          FIXTURE_REAL_CURL: realCurl.stdout.trim(),
          FIXTURE_DOWNLOAD_URI: `http://127.0.0.1:${server.address().port}/archive`,
        },
      });
      let stderr = '';
      child.stdout.resume();
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(0, 65536);
      });
      child.once('error', reject);
      child.once('close', (code) => complete({ code, stderr }));
    });
    assert.equal(requests, 1);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Download verification failed/);
    assert.equal(
      readFileSync(join(directory, 'current', 'previous-marker'), 'utf8'),
      'preserve',
    );
  } finally {
    if (server.listening)
      await new Promise((complete) => server.close(complete));
    rmSync(temporary, { recursive: true, force: true });
  }
});
