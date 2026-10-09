import { cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const test = `${root}tests/boundary.test.ts`;
try {
  await cp(`${root}tests/boundary.fixture.ts`, test);
  const result = spawnSync('rtk', ['proxy', 'claude', 'plugin', 'test', root], { stdio: 'inherit', timeout: 30000 });
  process.exitCode = result.status ?? 1;
} finally { await rm(test, { force: true }); }
