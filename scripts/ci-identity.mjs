import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { release } from 'node:os';

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (commit.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(commit.stdout))
  throw new Error('SOURCE_ID_UNAVAILABLE');
const pkg = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const report = process.report.getReport();
const kernelVersion = release().match(/^\d{1,5}(?:\.\d{1,5}){1,3}/)?.[0];
const libcVersion = report.header.glibcVersionRuntime;
if (
  !kernelVersion ||
  (libcVersion !== undefined && !/^\d{1,3}\.\d{1,3}$/.test(libcVersion))
)
  throw new Error('RUNTIME_IDENTITY_UNAVAILABLE');
if (process.platform === 'linux') {
  const [major, minor] = (libcVersion ?? '').split('.').map(Number);
  if (!libcVersion || major < 2 || (major === 2 && minor < 31))
    throw new Error('GLIBC_BASELINE_REQUIRED');
}
console.log(
  JSON.stringify({
    schemaVersion: 1,
    sourceSha: commit.stdout.trim(),
    version: pkg.version,
    engine: pkg.dependencies['@redact-secret/core'],
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    kernelVersion,
    libcVersion: libcVersion ?? null,
    libc: report.header.glibcVersionRuntime
      ? 'glibc'
      : process.platform === 'linux'
        ? 'other'
        : 'not-applicable',
    classification: 'deterministic-checks-only',
  }),
);
