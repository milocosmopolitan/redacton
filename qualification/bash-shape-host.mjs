import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claudeBinary,
  hostVersion,
  isolatedPlatformEnvironment,
} from './host-runtime.mjs';

// Deliberately unprotected synthetic shape probe. Never supply user input.
const directory = await mkdtemp(join(tmpdir(), 'redacton-bash-shape-'));
const shapePath = join(directory, 'shape.json');
try {
  await mkdir(join(directory, '.claude-plugin'));
  await mkdir(join(directory, 'hooks'));
  await mkdir(join(directory, 'config'));
  await writeFile(
    join(directory, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'shape-probe', version: '0.0.0' }),
  );
  await writeFile(
    join(directory, 'hooks/hooks.json'),
    JSON.stringify({ modules: ['./probe.ts'] }),
  );
  await writeFile(
    join(directory, 'hooks/probe.ts'),
    `
function describe(value: unknown, nested = false): unknown {
 if (value === undefined) return { kind: 'undefined' };
 if (value === null) return { kind: 'null' };
 if (typeof value !== 'object') return { kind: typeof value };
 const result: Record<string, unknown> = {};
 for (const key of Reflect.ownKeys(value)) {
  if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) continue;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  result[key] = !descriptor || !('value' in descriptor) ? { kind: 'accessor' }
   : !nested && key === 'result' ? describe(descriptor.value, true)
   : descriptor.value === undefined ? { kind: 'undefined' }
   : descriptor.value === null ? { kind: 'null' } : { kind: typeof descriptor.value };
 }
 return result;
}
export function register(on) {
 on('session.start', async ($, e, next) => {
  await $.command.register({ name: 'redacton', description: 'Synthetic shape preflight' });
  return next(e);
 });
 on('command.run', { command: 'redacton' }, () => ({ text: 'Redacton ON. SHAPE_ONLY_UNPROTECTED' }));
 on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
  const result = await next(e);
  await $.fs.write(${JSON.stringify(shapePath)}, JSON.stringify(describe(result)));
  return result;
 });
}
`,
  );
  const env = {
    ...isolatedPlatformEnvironment(directory),
    PATH: process.env.PATH,
    HOME: directory,
    CLAUDE_CONFIG_DIR: join(directory, 'config'),
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
    ANTHROPIC_API_KEY: 'qualification-only',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    TERM: 'xterm-256color',
  };
  const generated = spawnSync(
    process.env.PYTHON_BINARY ?? 'python3',
    [
      fileURLToPath(new URL('../scripts/generate-sdk.py', import.meta.url)),
      claudeBinary,
      directory,
      join(directory, 'config'),
    ],
    { env, encoding: 'utf8', timeout: 30000 },
  );
  if (generated.status !== 0) throw new Error('SHAPE_SDK_GENERATION_FAILED');
  const sdk = {};
  for (const name of ['claude-code', 'claude-code-tools']) {
    const bytes = await readFile(
      join(directory, '.claude-plugin/types', name, 'index.d.ts'),
    );
    sdk[name] = { sha256: createHash('sha256').update(bytes).digest('hex') };
    if (name === 'claude-code-tools') {
      const body = bytes.toString();
      const bash = body.slice(body.lastIndexOf('    Bash: {'));
      sdk[name].knownAliasesDeclared = Object.fromEntries(
        ['rawOutputPath', 'structuredContent'].map((key) => [
          key,
          bash.includes(`${key}?:`),
        ]),
      );
    }
  }
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('./integration-host.mjs', import.meta.url)),
      'bash',
      '--plugin-root',
      directory,
    ],
    {
      env: { ...process.env, CLAUDE_BINARY: claudeBinary },
      encoding: 'utf8',
      timeout: 65000,
    },
  );
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  if (
    !summary.pluginLoaded ||
    !summary.completed ||
    summary.requests !== 2 ||
    summary.toolResultCount !== 1 ||
    !summary.rawInToolResults
  )
    throw new Error('SHAPE_TOOL_NOT_OBSERVED');
  const shape = JSON.parse(await readFile(shapePath, 'utf8'));
  const report = {
    schemaVersion: 1,
    hostVersion,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    sdk,
    shape,
    probe: {
      syntheticOnly: true,
      protection: 'intentionally absent',
      modelRequests: summary.requests,
      originalArgumentsIntact: summary.originalArgumentsIntact,
    },
  };
  await mkdir(resolve('qualification/results'), { recursive: true });
  await writeFile(
    resolve(`qualification/results/bash-shape-${hostVersion}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const keep = process.argv.indexOf('--sdk-destination');
  if (keep >= 0)
    await cp(
      join(directory, '.claude-plugin/types'),
      resolve(process.argv[keep + 1]),
      { recursive: true },
    );
  console.log(JSON.stringify(report));
} finally {
  await rm(directory, { recursive: true, force: true });
}
