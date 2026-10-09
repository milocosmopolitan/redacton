import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
if (commit.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(commit.stdout))
  throw new Error('SOURCE_ID_UNAVAILABLE');
const pkg = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const report = process.report.getReport();
console.log(
  JSON.stringify({
    schemaVersion: 1,
    sourceSha: commit.stdout.trim(),
    version: pkg.version,
    engine: pkg.dependencies['@redact-secret/core'],
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    libc: report.header.glibcVersionRuntime
      ? 'glibc'
      : process.platform === 'linux'
        ? 'other'
        : 'not-applicable',
    classification: 'deterministic-checks-only',
  }),
);
