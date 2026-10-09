import { spawnSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedPlatformEnvironment } from '../qualification/host-runtime.mjs';

await import('./build-helper.mjs');
const root = new URL('../', import.meta.url);
const destination = await mkdtemp(join(tmpdir(), 'redacton-mod-tests-'));
try {
  for (const name of [
    '.claude-plugin/plugin.json',
    'hooks',
    'commands',
    'mod',
  ]) {
    await cp(new URL(name, root), join(destination, name), { recursive: true });
  }
  await mkdir(join(destination, 'helper/src'), { recursive: true });
  await cp(
    new URL('helper/src/config.ts', root),
    join(destination, 'helper/src/config.ts'),
  );
  await mkdir(join(destination, 'tests'));
  await cp(
    new URL('tests/fixtures/', root),
    join(destination, 'tests/fixtures'),
    { recursive: true },
  );
  const { readdir } = await import('node:fs/promises');
  for (const name of await readdir(new URL('tests/', root))) {
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx'))
      await cp(
        new URL(`tests/${name}`, root),
        join(destination, 'tests', name),
      );
  }
  const command =
    process.argv.includes('--validate') || process.argv.includes('--types')
      ? ['validate', '--strict', destination]
      : ['test', destination];
  const result = spawnSync(
    process.env.CLAUDE_BINARY ?? 'claude',
    ['plugin', ...command],
    {
      stdio: 'inherit',
    },
  );
  process.exitCode = result.status ?? 1;
  if (process.argv.includes('--types') && result.status === 0) {
    const config = join(destination, 'isolated-config');
    await mkdir(config);
    const env = {
      ...isolatedPlatformEnvironment(destination),
      PATH: process.env.PATH,
      HOME: destination,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CONFIG_DIR: config,
      REDACTON_SETTINGS_ROOT: join(destination, 'settings'),
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
      ANTHROPIC_API_KEY: 'qualification-only',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    };
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    // Only loading the local command generates SDK declarations; the model endpoint is disabled.
    const generated = spawnSync(
      process.env.CLAUDE_BINARY ?? 'claude',
      [
        '-p',
        '/redactoff',
        '--plugin-dir',
        destination,
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--permission-mode',
        'dontAsk',
      ],
      { cwd: destination, env, encoding: 'utf8', timeout: 30000 },
    );
    if (
      generated.status !== 0 ||
      !generated.stdout?.includes('Warning: Redacton is OFF.')
    )
      throw new Error('SDK_HOST_ACTIVATION_FAILED');
    try {
      await access(
        join(destination, '.claude-plugin/types/claude-code-tools/index.d.ts'),
      );
    } catch {
      // 2.1.295+ generate declarations only from an interactive --plugin-dir session.
      const interactive = spawnSync(
        process.env.PYTHON_BINARY ?? 'python3',
        [
          fileURLToPath(new URL('./generate-sdk.py', import.meta.url)),
          process.env.CLAUDE_BINARY ?? 'claude',
          destination,
          config,
        ],
        {
          env: { ...env, TERM: 'xterm-256color' },
          encoding: 'utf8',
          timeout: 30000,
        },
      );
      if (interactive.status !== 0)
        throw new Error('SDK_INTERACTIVE_TYPES_UNAVAILABLE');
    }
    try {
      await cp(
        join(destination, '.claude-plugin/types'),
        new URL('.claude-plugin/types', root),
        { recursive: true },
      );
    } catch {
      throw new Error('SDK_TYPES_UNAVAILABLE');
    }
  }
} finally {
  await rm(destination, { recursive: true, force: true });
}
