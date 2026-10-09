import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  claudeBinary,
  hostVersion,
  isolatedPlatformEnvironment,
} from './host-runtime.mjs';

const root = resolve(process.env.REDACTON_PLUGIN_ROOT ?? '.');
const dir = await mkdtemp(join(tmpdir(), 'redacton-env-probe-'));
try {
  const companion = join(dir, 'companion');
  await mkdir(join(companion, '.claude-plugin'), { recursive: true });
  await mkdir(join(companion, 'hooks'));
  await writeFile(
    join(companion, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: 'environment-probe', version: '0.0.0' }),
  );
  await writeFile(
    join(companion, 'hooks/hooks.json'),
    JSON.stringify({ modules: ['./register.ts'] }),
  );
  await writeFile(
    join(companion, 'hooks/register.ts'),
    `
export function register(on) {
 on('session.start', async ($, e, next) => {
  await $.command.register({ name: 'environmentprobe', description: 'Synthetic environment boundary' });
  return next(e);
 });
 on('command.run', { command: 'environmentprobe' }, async ($) => {
  const result = await $.process.run(['node', '-e', "console.log(JSON.stringify({inherited:process.env.REDACTON_ENV_SYNTHETIC==='inherited',optionsCleared:process.env.NODE_OPTIONS==='',pathCleared:process.env.NODE_PATH===''}))"],
   { env: { NODE_OPTIONS: '', NODE_PATH: '' }, timeoutMs: 2000 });
  let value; try { value=JSON.parse(result.stdout); } catch {}
  return { text: result.exitCode===0 && value?.inherited && value?.optionsCleared && value?.pathCleared ? 'ENVIRONMENT_OVERLAY_VERIFIED' : 'ENVIRONMENT_PROBE_FAILED' };
 });
}
`,
  );
  const preload = join(dir, 'preload.mjs');
  await writeFile(
    preload,
    "process.stderr.write('SYNTHETIC_PRELOAD_REFUSAL');process.exit(19);\n",
  );
  const env = {
    ...isolatedPlatformEnvironment(dir),
    PATH: process.env.PATH,
    HOME: dir,
    CLAUDE_CONFIG_DIR: join(dir, 'config'),
    REDACTON_SETTINGS_ROOT: join(dir, 'settings'),
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
    ANTHROPIC_API_KEY: 'qualification-only',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    REDACTON_ENV_SYNTHETIC: 'inherited',
    NODE_OPTIONS: `--import=${JSON.stringify(preload)}`,
    NODE_PATH: join(dir, 'untrusted-module-path'),
  };
  const rows = [];
  for (const command of ['/environmentprobe', '/redacton']) {
    const result = spawnSync(
      claudeBinary,
      [
        '-p',
        command,
        '--plugin-dir',
        companion,
        '--plugin-dir',
        root,
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--permission-mode',
        'dontAsk',
      ],
      { env, cwd: dir, encoding: 'utf8', timeout: 20000 },
    );
    const passed =
      result.status === 0 &&
      result.stdout.includes(
        command === '/environmentprobe'
          ? 'ENVIRONMENT_OVERLAY_VERIFIED'
          : 'Protect ready',
      );
    rows.push({
      command,
      passed,
      preloadDiagnosticObserved: result.stderr.includes(
        'SYNTHETIC_PRELOAD_REFUSAL',
      ),
    });
  }
  const passed = rows.every(
    (row) => row.passed && !row.preloadDiagnosticObserved,
  );
  console.log(
    JSON.stringify({
      hostVersion,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      inheritedSyntheticVariable: rows[0].passed,
      startupOptionsNeutralized: passed,
      realSettingsAndSelfCheckReady: rows[1].passed,
      credentialEnvironmentDumped: false,
      rows,
      passed,
    }),
  );
  if (!passed) process.exitCode = 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
