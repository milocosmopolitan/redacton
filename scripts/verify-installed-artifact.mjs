import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// This verifies the real built package locally, independently of synthetic rollback fixtures.
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const windows = process.platform === 'win32';
const archiveName = `redacton-${version}.${windows ? 'zip' : 'tar.gz'}`;
const archive = resolve('artifacts', archiveName);
const checksums = await readFile('artifacts/SHA256SUMS', 'utf8');
const expected = checksums
  .split('\n')
  .find((line) => line.endsWith(`  ${archiveName}`))
  ?.split('  ')[0];
assert.match(expected ?? '', /^[a-f0-9]{64}$/);
assert.equal(
  createHash('sha256')
    .update(await readFile(archive))
    .digest('hex'),
  expected,
);
const temporary = await mkdtemp(join(tmpdir(), 'redacton real install 한글 '));
const directory = join(temporary, 'application data');
try {
  const fixtureClaude = process.argv.includes('--fixture-claude');
  let installerPath = process.env.PATH;
  if (fixtureClaude) {
    const bin = join(temporary, 'fixture-bin');
    await mkdir(bin);
    const stub = join(bin, windows ? 'claude.cmd' : 'claude');
    await writeFile(stub, windows ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
    if (!windows) await chmod(stub, 0o755);
    installerPath = `${bin}${windows ? ';' : ':'}${installerPath}`;
  }
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (key.toLowerCase() === 'path') delete environment[key];
  environment[windows ? 'Path' : 'PATH'] = installerPath;
  const command = windows ? 'powershell.exe' : 'bash';
  const args = windows
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        resolve('scripts/install.ps1'),
        '-ReleaseVersion',
        version,
        '-ArchiveSha256',
        expected,
        '-ArchivePath',
        archive,
        '-InstallDirectory',
        directory,
      ]
    : [resolve('scripts/install.sh')];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...environment,
        REDACTON_RELEASE_VERSION: version,
        REDACTON_ARCHIVE_SHA256: expected,
        REDACTON_ARCHIVE_PATH: archive,
        REDACTON_INSTALL_DIR: directory,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const installed = JSON.parse(
      await readFile(join(directory, 'current', 'package.json'), 'utf8'),
    );
    assert.equal(installed.version, version);
    assert.equal(installed.redactonArtifact.prebuilt, true);
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      check: 'real-artifact-clean-and-repeat-install',
      version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      hostQualification: 'not-inferred',
      claudePrerequisite: fixtureClaude
        ? 'fixture-command-only'
        : 'installed-command',
    }),
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
